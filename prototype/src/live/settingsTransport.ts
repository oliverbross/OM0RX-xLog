import { workerRequest } from "../worker";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function requestSettings(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}

/** Wake-only invalidation. Every surface reloads and validates the authoritative
 * snapshot; no settings or command authority travels in the event payload. */
export function connectSettingsChanges(changed: () => void | Promise<void>, failed: (message: string) => void) {
  if (!isTauri()) return () => {};
  let active = true, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
  const reload = async () => {
    if (!active) return;
    try { await changed(); }
    catch (cause) {
      if (active) failed(cause instanceof Error ? cause.message : "Settings could not be reloaded.");
    }
  };
  const schedule = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void reload(); }, 50);
  };
  window.addEventListener("focus", schedule);
  void listen("xlog:settings-changed", schedule).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; schedule();
  }).catch(() => { if (active) failed("Live Settings updates are unavailable. Refocus this window to reload."); });
  return () => { active = false; clearTimeout(timer); stop?.(); window.removeEventListener("focus", schedule); };
}
