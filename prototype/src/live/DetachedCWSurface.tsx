import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CWDesk from "./CWDesk";
import { useSharedCW } from "./useSharedCW";
import "./DetachedTaskSurface.css";

/** A renderer of the existing native CW owner, not another station controller.
 * Opening only reads saved context. Arm/send require fresh native admission. */
export function DetachedCWSurface() {
  const [transitioning, setTransitioning] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), mounted = useRef(false);
  const { controller, state, profile, context, provider } = useSharedCW("cw-child", transitioning);
  const transition = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setTransitioning(true); setError("");
    try { await invoke("close_cw_window"); }
    catch (cause) {
      if (mounted.current) {
        setError(`CW remains open. ${cause instanceof Error ? cause.message : String(cause)} Use Stop and resolve the output guard before retrying.`);
        busy.current = false; setTransitioning(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true, unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => { void transition(); })
      .then(dispose => { if (active) unlisten = dispose; else dispose(); })
      .catch(() => { if (active) setError("Native close notifications are unavailable. Use Stop before closing; the native output guard remains active."); });
    return () => { active = false; mounted.current = false; unlisten?.(); };
  }, [transition]);
  const controls = {
    arm: () => busy.current ? Promise.resolve() : controller.arm(),
    send: (...args: Parameters<typeof controller.send>) => busy.current ? Promise.resolve() : controller.send(...args),
    stop: controller.stop,
    acknowledgeStopped: () => { if (!busy.current) controller.acknowledgeStopped(); },
  };
  return <div className="app live detached-task-app detached-cw-app"><main aria-label="Detached CW"><section className="detached-cw-controls" aria-label="CW session">
    <CWDesk profile={profile} context={context} controller={controls}
      state={{ ...state, pending: state.pending || transitioning || !state.canonical }} radioProvider={provider} />
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
