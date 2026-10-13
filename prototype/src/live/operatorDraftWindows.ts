import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function openDetachedQSO() {
  if (!isTauri()) throw new Error("Undocking requires the desktop application.");
  await invoke("open_detached_map", { kind: "log-qso" });
}

/** Wake events carry no draft or authority. Subscribe before reading; recover
 * on focus and a bounded poll for native power changes/missed notifications. */
export function connectOperatorDraftChanges(refresh: () => Promise<void>, failed: (message: string) => void) {
  let active = true, ready = false, running = false, again = false;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const read = async () => {
    if (!active || !ready) return;
    if (running) { again = true; return; }
    running = true;
    try { await refresh(); }
    catch (cause) { if (active) failed(cause instanceof Error ? cause.message : "Shared draft updates unavailable."); }
    finally {
      running = false;
      if (active && again) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    if (!active) return;
    if (!ready) { again = true; return; }
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void read(); }, 120);
  };
  const start = () => {
    if (!active) return;
    ready = true; again = false;
    void read();
    // Polling already has a bounded cadence; do not add the event debounce to it.
    poll = setInterval(() => { void read(); }, 1500);
  };
  window.addEventListener("focus", schedule);
  if (isTauri()) {
    void listen("xlog:operator-draft-changed", schedule).then(dispose => {
      if (!active) { dispose(); return; }
      stop = dispose; start();
    }).catch(() => {
      if (!active) return;
      failed("Live draft notifications are unavailable; periodic refresh remains active.");
      start();
    });
  } else start();
  return () => {
    active = false; clearTimeout(timer); clearInterval(poll);
    stop?.(); window.removeEventListener("focus", schedule);
  };
}

export function protectOperatorDraftClose(blocked: () => boolean, explain: () => void, failed: (message: string) => void,
  closingChanged: (closing: boolean) => void = () => {}) {
  if (!isTauri()) return () => {};
  let active = true, closing = false, stop: (() => void) | undefined;
  void getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => {
    if (!active || closing) return;
    if (blocked()) { explain(); return; }
    closing = true; closingChanged(true);
    void invoke("close_qso_window").catch(() => {
      if (active) {
        closing = false; closingChanged(false);
        failed("Could not close Log QSO. Try again after resolving the draft.");
      }
    });
  }).then(dispose => { if (active) stop = dispose; else dispose(); })
    .catch(() => { if (active) failed("Close protection is unavailable. Resolve draft changes before closing this window."); });
  return () => { active = false; stop?.(); };
}
