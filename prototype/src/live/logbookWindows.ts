import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function openDetachedLogbook() {
  if (!isTauri()) throw new Error("Undocking requires the desktop application.");
  await invoke("open_detached_map", { kind: "logbook" });
}

/** Notifications carry no contact data or authority. Read after subscribing and
 * on focus too, so a missed startup/background notification cannot strand a view. */
export function connectLogbookChanges(changed: () => void, failed: (message: string) => void) {
  if (!isTauri()) return () => {};
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const schedule = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; if (active) changed(); }, 120);
  };
  window.addEventListener("focus", schedule);
  void listen("xlog:logbook-changed", schedule).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; schedule();
  }).catch(() => { if (active) failed("Live logbook refresh is unavailable. Refocus this window to reload the logbook."); });
  return () => { active = false; clearTimeout(timer); stop?.(); window.removeEventListener("focus", schedule); };
}

export function protectLogbookClose(blocked: () => boolean, explain: () => void, failed: (message: string) => void) {
  if (!isTauri()) return () => {};
  let active = true, stop: (() => void) | undefined;
  // Registering this native close event defers the default close. Unlike the
  // convenience onCloseRequested API, use a command which can destroy only
  // the caller's Logbook, not the generic cross-window destroy permission.
  void getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => {
    if (!active) return;
    if (blocked()) { explain(); return; }
    void invoke("close_logbook_window").catch(() => { if (active) failed("Could not close Logbook. Try again or use Quit to exit the application."); });
  }).then(dispose => { if (active) stop = dispose; else dispose(); })
    .catch(() => { if (active) failed("Close protection is unavailable. Finish contact changes before closing this window."); });
  return () => { active = false; stop?.(); };
}
