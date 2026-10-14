import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SharedCWSession, sharedCWProfile } from "./sharedCWSession";
import { macroForKey } from "./cwMacros";

export function useSharedCW(contextKey: string) {
  const [controller] = useState(() => new SharedCWSession());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const previousContext = useRef(contextKey);
  useEffect(() => { if (previousContext.current !== contextKey) { previousContext.current = contextKey; void controller.stop(); } }, [controller, contextKey]);
  useEffect(() => {
    controller.activate();
    let reading = false;
    const poll = () => { if (!reading) { reading = true; void controller.refresh().finally(() => { reading = false; }); } };
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') || !document.hasFocus() || document.visibilityState !== "visible") return;
      const current = controller.getSnapshot(), macro = macroForKey(event, sharedCWProfile(current));
      if (macro && current.armed) { event.preventDefault(); void controller.send(macro); }
    };
    const disarm = () => { void controller.stop(); };
    const visibility = () => { if (document.visibilityState !== "visible") disarm(); };
    poll(); const timer = setInterval(poll, 750);
    window.addEventListener("keydown", keydown); window.addEventListener("blur", disarm); document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(timer); window.removeEventListener("keydown", keydown); window.removeEventListener("blur", disarm); document.removeEventListener("visibilitychange", visibility); controller.dispose(); };
  }, [controller]);
  return { controller, state, profile: sharedCWProfile(state), context: state.canonical?.context ?? {}, provider: state.canonical?.provider ?? "direct_agent" };
}
