// Isolated packaged acceptance only. No automatic path in normal app launches.
import { invoke } from "@tauri-apps/api/core";
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
  await waitState(kind, "Dock back closure", state => state.open === false);
  return { instanceID, probeRevision: probe.revision, closed: true };
}

/** Called by the child after publishing its initial report. Dock is its real UI action. */
export async function serveDetachedLifecycle(report: Json, clickDock: () => Promise<void>, editorStep?: (action: string) => Promise<Json>) {
  let revision = 0;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const step = await invoke<Json | null>("acceptance_window_step", {});
    if (step && Number.isSafeInteger(step.revision) && step.revision > revision) {
      revision = step.revision;
      if (step.action === "probe") {
        report.details.phaseRevision = revision;
        await invoke("acceptance_monitor", { report });
      } else if (step.action === "dock") { await clickDock(); return; }
      else if (editorStep && report.details.surface === "logbook" && ["editor_prepare", "editor_probe", "editor_cancel"].includes(step.action)) {
        report.details.workspaceDraft = { action: step.action, ...await editorStep(step.action) };
        report.details.phaseRevision = revision;
        await invoke("acceptance_monitor", { report });
      }
      else throw new Error("Unexpected native window test step");
    }
    await pause();
  }
  throw new Error("Detached window lifecycle coordinator timed out");
}
