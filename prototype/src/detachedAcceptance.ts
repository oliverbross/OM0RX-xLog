// Isolated packaged acceptance only. No automatic path in normal app launches.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
type Json = Record<string, any>;
type Kind = "logbook" | "awards";
const pause = () => new Promise(resolve => setTimeout(resolve, 50));

async function waitState(kind: Kind, label: string, accepts: (state: Json) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await invoke<Json>("acceptance_window_state", { kind });
    if (state.report?.status === "failed") throw new Error(state.report.error || `${kind} window failed`);
    if (accepts(state)) return state;
    await pause();
  }
  throw new Error(`Timed out: ${kind} ${label}`);
}

/** Reopening must retain the actual responding renderer, not just its label. */
export async function verifyDetachedLifecycle(kind: Kind, initial: Json, leaveScreen: () => Promise<void>) {
  const instanceID = initial?.details?.instanceID;
  if (typeof instanceID !== "string" || !instanceID) throw new Error(`${kind} did not identify its renderer`);
  await invoke("acceptance_open_window", { kind });
  const probe = await invoke<Json>("acceptance_window_step", { kind, action: "probe" });
  if (!Number.isSafeInteger(probe?.revision) || probe.revision < 1) throw new Error("Invalid native probe step");
  const observed = await waitState(kind, "singleton readback", state => state.open === true && state.report?.details?.phaseRevision === probe.revision);
  if (observed.report.details.instanceID !== instanceID) throw new Error(`${kind} reopening replaced its renderer`);
  await leaveScreen();
  await invoke("acceptance_window_step", { kind, action: "dock" });
  await waitState(kind, "native closure", state => state.open === false);
  return { instanceID, probeRevision: probe.revision, closed: true };
}

/** Called by the child after publishing its initial report. The isolated test
 * uses the real native close/dock command without adding test-only UI chrome. */
export async function serveDetachedLifecycle(report: Json, closeChild: () => Promise<void>, editorStep?: (action: string) => Promise<Json>) {
  let revision = 0;
  const deadline = Date.now() + 60_000;
  const pending: Json[] = [];
  let wake: (() => void) | null = null;
  const stop = await listen<Json>("xlog:acceptance-window-step", event => {
    pending.push(event.payload);
    wake?.(); wake = null;
  });
  try {
    // Readiness is visible to the parent only after this listener exists.
    await invoke("acceptance_monitor", { report });
    while (Date.now() < deadline) {
      if (!pending.length) await Promise.race([
        new Promise<void>(resolve => { wake = resolve; }),
        pause(),
      ]);
      const step = pending.shift() ?? null;
      if (!step) continue;
    if (step && Number.isSafeInteger(step.revision) && step.revision > revision) {
      revision = step.revision;
      if (step.action === "probe") {
        report.details.phaseRevision = revision;
        await invoke("acceptance_monitor", { report });
      } else if (step.action === "dock") { await closeChild(); return; }
      else if (editorStep && report.details.surface === "logbook" && ["editor_prepare", "editor_probe", "editor_cancel"].includes(step.action)) {
        report.details.workspaceDraft = { action: step.action, ...await editorStep(step.action) };
        report.details.phaseRevision = revision;
        await invoke("acceptance_monitor", { report });
      }
      else throw new Error("Unexpected native window test step");
    }
    }
  } finally {
    stop();
  }
  throw new Error("Detached window lifecycle coordinator timed out");
}
