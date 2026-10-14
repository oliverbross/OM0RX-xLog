import { listen } from "@tauri-apps/api/event";
type Adapter = { listen: (name: string, wake: () => void) => Promise<() => void> };
/** Native summary owner supplies refresh wakes. No renderer interval, raw
 * summary event, worker fallback or synchronization action is introduced. */
export function connectSyncChanges(refresh: () => void, failed: (message: string) => void,
  adapter: Adapter = { listen: (name, wake) => listen(name, wake) }) {
  let active = true, ready = false;
  const stops: (() => void)[] = [];
  const wake = () => { if (active && ready) refresh(); };
  window.addEventListener("focus", wake);
  void Promise.allSettled(["xlog:sync-changed", "xlog:logbook-changed", "xlog:settings-changed"].map(name => adapter.listen(name, wake))).then(results => {
    for (const result of results) if (result.status === "fulfilled") { if (active) stops.push(result.value); else result.value(); }
    if (!active) return;
    ready = true;
    if (results.some(result => result.status === "rejected")) failed("Some Sync notifications are unavailable. Refocus this window to reload; no renderer polling fallback is running.");
    refresh();
  });
  return () => { active = false; stops.forEach(stop => stop()); window.removeEventListener("focus", wake); };
}
