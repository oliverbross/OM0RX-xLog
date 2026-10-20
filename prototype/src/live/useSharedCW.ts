import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SharedCWSession, sharedCWProfile } from "./sharedCWSession";
import { macroForKey } from "./cwMacros";

export function useSharedCW(contextKey: string, suspended = false, nativeFocusOwner = false) {
  const [controller] = useState(() => new SharedCWSession());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const previousContext = useRef(contextKey);
  const suspendedRef = useRef(suspended); suspendedRef.current = suspended;
  const nativeFocusOwnerRef = useRef(nativeFocusOwner); nativeFocusOwnerRef.current = nativeFocusOwner;
  useEffect(() => { if (previousContext.current !== contextKey) { previousContext.current = contextKey; void controller.release(); } }, [controller, contextKey]);
  useEffect(() => {
    controller.activate();
    let reading = false;
    const poll = () => { if (!reading && !suspendedRef.current) { reading = true; void controller.refresh().finally(() => { reading = false; }); } };
    const keydown = (event: KeyboardEvent) => {
      if (nativeFocusOwnerRef.current || suspendedRef.current || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') || !document.hasFocus() || document.visibilityState !== "visible") return;
      const current = controller.getSnapshot(), macro = macroForKey(event, sharedCWProfile(current));
      if (macro && current.armed) { event.preventDefault(); void controller.send(macro); }
    };
    // A detached contest Entry owns native focus while Setup hosts its controller.
    // Native window events revoke that Entry lease on blur or destruction.
    const disarm = () => { if (!nativeFocusOwnerRef.current) void controller.release(); };
    const visibility = () => { if (document.visibilityState !== "visible") disarm(); };
    poll(); const timer = setInterval(poll, 750);
    window.addEventListener("keydown", keydown); window.addEventListener("blur", disarm); document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(timer); window.removeEventListener("keydown", keydown); window.removeEventListener("blur", disarm); document.removeEventListener("visibilitychange", visibility); controller.dispose(); };
  }, [controller]);
  return { controller, state, profile: sharedCWProfile(state), context: state.canonical?.context ?? {}, provider: state.canonical?.provider ?? "direct_agent" };
}
