import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { workerRequest } from "../worker";

export async function requestRotorConfiguration(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}

/** Wake-only invalidation; configuration values and command authority never
 * travel in the event payload. */
export function connectRotorConfigurationChanges(changed: () => void, failed: (message: string) => void) {
  if (!isTauri()) return () => {};
  let active = true, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
  const schedule = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; if (active) changed(); }, 50);
  };
  window.addEventListener("focus", schedule);
  void listen("xlog:rotor-configuration-changed", schedule).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; schedule();
  }).catch(() => { if (active) failed("Live rotor configuration updates are unavailable. Refocus this window to reload."); });
  return () => { active = false; clearTimeout(timer); stop?.(); window.removeEventListener("focus", schedule); };
}
