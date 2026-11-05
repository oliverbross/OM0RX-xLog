import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SharedCWSession, sharedCWContext, sharedCWProfile } from "./sharedCWSession";
import { macroForKey } from "./cwMacros";

export function useSharedCW(contextKey: string, suspended = false, nativeFocusOwner = false) {
  const [controller] = useState(() => new SharedCWSession());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const previousContext = useRef(contextKey);
  const suspendedRef = useRef(suspended); suspendedRef.current = suspended;
  const nativeFocusOwnerRef = useRef(nativeFocusOwner); nativeFocusOwnerRef.current = nativeFocusOwner;
  const resumePolling = useRef(() => {});
  useEffect(() => { if (previousContext.current !== contextKey) { previousContext.current = contextKey; void controller.release(); } }, [controller, contextKey]);
  useEffect(() => { resumePolling.current(); }, [suspended]);
  useEffect(() => {
    controller.activate();
    let reading = false, active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!active || suspendedRef.current) return;
      const current = controller.getSnapshot();
      const holder = current.client === controller.client && current.lease !== null;
      if (document.visibilityState !== "visible" && !holder) return;
      // Keep visible context fresh and lease supervision below native's 3s
      // expiry, including a hidden Setup controller for a native Entry holder.
      timer = setTimeout(poll, 750);
    };
    const poll = () => {
      clearTimeout(timer);
      if (!active || suspendedRef.current) { schedule(); return; }
      if (reading) return;
      reading = true;
      void controller.refresh().finally(() => { reading = false; schedule(); });
    };
    resumePolling.current = () => { if (document.visibilityState === "visible" && !suspendedRef.current) poll(); else schedule(); };
    const unsubscribe = controller.subscribe(schedule);
    const keydown = (event: KeyboardEvent) => {
      if (nativeFocusOwnerRef.current || suspendedRef.current || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') || !document.hasFocus() || document.visibilityState !== "visible") return;
      const current = controller.getSnapshot(), macro = macroForKey(event, sharedCWProfile(current));
      if (macro && current.armed) { event.preventDefault(); void controller.send(macro); }
    };
    // A detached contest Entry owns native focus while Setup hosts its controller.
    // Native window events revoke that Entry lease on blur or destruction.
    const disarm = () => { if (!nativeFocusOwnerRef.current) void controller.release(); };
    const visibility = () => { if (document.visibilityState !== "visible") { disarm(); schedule(); } else resumePolling.current(); };
    resumePolling.current();
    window.addEventListener("keydown", keydown); window.addEventListener("blur", disarm); window.addEventListener("focus", resumePolling.current); document.addEventListener("visibilitychange", visibility);
    const focus = resumePolling.current;
    return () => { active = false; clearTimeout(timer); unsubscribe(); resumePolling.current = () => {}; window.removeEventListener("keydown", keydown); window.removeEventListener("blur", disarm); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); controller.dispose(); };
  }, [controller]);
  return { controller, state, profile: sharedCWProfile(state), context: sharedCWContext(state), provider: state.canonical?.provider ?? "direct_agent" };
}
