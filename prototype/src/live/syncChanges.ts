import { listen } from "@tauri-apps/api/event";
type Adapter = { listen: (name: string, wake: () => void) => Promise<() => void> };
/** Native summary owner supplies refresh wakes. No renderer interval, raw
 * summary event, worker fallback or synchronization action is introduced. */
export function connectSyncChanges(refresh: () => void, failed: (message: string) => void,
  adapter: Adapter = { listen: (name, wake) => listen(name, wake) }) {
  let active = true, notificationWarningShown = false;
  const stops: (() => void)[] = [];
  const wake = () => { if (active) refresh(); };
  window.addEventListener("focus", wake);
  // Initial state must never wait for event subscription promises. A stalled
  // native listener previously left the whole Sync screen in "Reading..."
  // forever and disabled setup, scheduling and manual synchronization.
  refresh();
  for (const name of ["xlog:sync-changed", "xlog:logbook-changed", "xlog:settings-changed"]) {
    void adapter.listen(name, wake).then(stop => { if (active) stops.push(stop); else stop(); }).catch(() => {
      if (active && !notificationWarningShown) {
        notificationWarningShown = true;
        failed("Some Sync notifications are unavailable. Refocus this window to reload; no renderer polling fallback is running.");
      }
    });
  }
  return () => { active = false; stops.forEach(stop => stop()); window.removeEventListener("focus", wake); };
}
