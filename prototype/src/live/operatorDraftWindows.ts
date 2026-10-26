import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { prepareCanvasClose } from "./canvasClose";
import { prepareOperatingModuleEditor } from "../operatingModulePreparation";

export async function openDetachedQSO() {
  if (!isTauri()) throw new Error("Undocking requires the desktop application.");
  await invoke("open_detached_map", { kind: "log-qso" });
}

export type DraftUpdateFailure = "read" | "subscription";
type ErrorSetter = (value: string | ((current: string) => string)) => void;
/** Clear only this reader's warning, never a newer error from another action.
 * A recovered read cannot repair a failed subscription: keep that warning. */
export function ownDraftUpdateWarnings(setError: ErrorSetter) {
  let readWarning: string | null = null, subscriptionWarning: string | null = null;
  return {
    failed(message: string, kind: DraftUpdateFailure = "read") {
      if (kind === "read") readWarning = message;
      else subscriptionWarning = message;
      setError(message);
    },
    recovered() {
      const owned = readWarning; readWarning = null;
      if (owned) setError(current => current === owned ? subscriptionWarning ?? "" : current);
    },
    subscribed() {
      const owned = subscriptionWarning; subscriptionWarning = null;
      if (owned) setError(current => current === owned ? readWarning ?? "" : current);
    },
  };
}

/** Wake events carry no draft or authority. Subscribe before reading; recover
 * on focus and a bounded poll for native power changes/missed notifications. */
export function connectOperatorDraftChanges(refresh: () => Promise<void | boolean>,
  failed: (message: string, kind?: DraftUpdateFailure) => void, recovered: () => void = () => {}, subscribed: () => void = () => {}) {
  let active = true, ready = false, running = false, again = false;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const read = async () => {
    if (!active || !ready) return;
    if (running) { again = true; return; }
    running = true;
    try { if (await refresh() === true && active) recovered(); }
    catch (cause) { if (active) failed(cause instanceof Error ? cause.message : "Shared draft updates unavailable.", "read"); }
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
      stop = dispose; subscribed(); start();
    }).catch(() => {
      if (!active) return;
      failed("Live draft notifications are unavailable; periodic refresh remains active.", "subscription");
      start();
    });
  } else start();
  return () => {
    active = false; clearTimeout(timer); clearInterval(poll);
    stop?.(); window.removeEventListener("focus", schedule);
  };
}

export function protectOperatorDraftClose(blocked: () => boolean, explain: () => void, failed: (message: string) => void,
  closingChanged: (closing: boolean) => void = () => {}, closeCommand: "close_qso_window" | "close_main_window" = "close_qso_window") {
  if (!isTauri()) return () => {};
  let active = true, closing = false, stop: (() => void) | undefined;
  const stopCanvas = closeCommand === "close_qso_window" ? prepareCanvasClose(() => closing || blocked(), explain, failed) : () => {};
  const stopModule = closeCommand === "close_qso_window" ? prepareOperatingModuleEditor(() => closing || blocked(), explain) : () => {};
  void getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => {
    if (!active || closing) return;
    if (blocked()) { explain(); return; }
    closing = true; closingChanged(true);
    void invoke(closeCommand).catch(() => {
      if (active) {
        closing = false; closingChanged(false);
        failed(closeCommand === "close_main_window" ? "Could not close the Desk. Try again after resolving the draft." : "Could not close Log QSO. Try again after resolving the draft.");
      }
    });
  }).then(dispose => { if (active) stop = dispose; else dispose(); })
    .catch(() => { if (active) failed("Close protection is unavailable. Resolve draft changes before closing this window."); });
  return () => { active = false; stop?.(); stopCanvas(); stopModule(); };
}
