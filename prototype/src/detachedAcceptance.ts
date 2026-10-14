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
  await waitState(kind, "singleton readback", state => {
    const observed = state.report?.details?.instanceID;
    if (state.open === true && typeof observed === "string" && observed !== instanceID)
      throw new Error(`${kind} reopening replaced its renderer`);
    return state.open === true && observed === instanceID;
  });
  await leaveScreen();
  await invoke("acceptance_close_window", { kind });
  await waitState(kind, "native closure", state => state.open === false);
  return { instanceID, closed: true };
}
