import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Preparation is a veto only. Actual close still rechecks the existing guard,
 * so typing after this acknowledgement cannot bypass unsaved-input protection. */
export function prepareCanvasClose(blocked: () => boolean, explain: () => void, failed: (message: string) => void) {
  let active = true, stop: (() => void) | undefined;
  void Promise.resolve(listen<{ request: string }>("xlog:canvas-close-prepare", event => {
    if (!active || typeof event.payload?.request !== "string") return;
    let ready = false;
    try { ready = !blocked(); } catch { /* Fail closed if editor state cannot be read. */ }
    if (!ready) explain();
    void invoke("workspace_canvas_close_ack", { request: event.payload.request, ready })
      .catch(() => { if (active) failed("Retry Canvas close."); });
  })).then(dispose => { if (active) stop = dispose; else dispose?.(); })
    .catch(() => { if (active) failed("Reload editor before Canvas."); });
  return () => { active = false; stop?.(); };
}
