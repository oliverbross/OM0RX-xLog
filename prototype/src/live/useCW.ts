import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CWController, type CWRequest } from "./cwController";
import { defaultCWProfile, macroForKey, validateCWProfile, type CWContext } from "./cwMacros";

export function useCW(request: CWRequest, value: unknown, provider: string, context: CWContext, contextKey: string) {
  const currentRequest = useRef(request); currentRequest.current = request;
  const currentContext = useRef(context); currentContext.current = context;
  const [controller] = useState(() => new CWController((method, params) => currentRequest.current(method, params)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const key = JSON.stringify(value ?? defaultCWProfile);
  useEffect(() => { controller.configure(value, provider); }, [controller, key, provider]);
  useEffect(() => { void controller.stop(); }, [controller, contextKey]);
  useEffect(() => {
    let profile;
    try { profile = validateCWProfile(value ?? defaultCWProfile); } catch { return; }
    const saved = profile;
    const keydown = (event: KeyboardEvent) => {
      // A modal elsewhere in the DOM also suspends shortcuts, not only events
      // whose target happens to sit inside that dialog.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') || !document.hasFocus() || document.visibilityState !== "visible") return;
      const macro = macroForKey(event, saved);
      if (macro && controller.getSnapshot().armed) { event.preventDefault(); void controller.send(macro, currentContext.current); }
    };
    const disarm = () => { void controller.stop(); };
    const visibility = () => { if (document.visibilityState !== "visible") disarm(); };
    window.addEventListener("keydown", keydown); window.addEventListener("blur", disarm); document.addEventListener("visibilitychange", visibility);
    const tick = setInterval(() => controller.tick(), 250);
    let reading = false;
    const poll = () => { if (!reading) { reading = true; void controller.pollWinKeyer().finally(() => { reading = false; }); } };
    const pollIfConfigured = () => { if (saved.output === "winkeyer" || controller.getSnapshot().winkeyer?.generation > 0) poll(); };
    pollIfConfigured(); const timer = setInterval(pollIfConfigured, 1_000);
    return () => { clearInterval(tick); clearInterval(timer); window.removeEventListener("keydown", keydown); window.removeEventListener("blur", disarm); document.removeEventListener("visibilitychange", visibility); disarm(); };
  }, [controller, key]);
  return { controller, state };
}
