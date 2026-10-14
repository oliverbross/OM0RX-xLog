import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CWDesk from "./CWDesk";
import { useSharedCW } from "./useSharedCW";

/** A renderer of the existing native CW owner, not another station controller.
 * Opening only reads saved context. Arm/send require fresh native admission. */
export function DetachedCWSurface() {
  const [transitioning, setTransitioning] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), mounted = useRef(false);
  const { controller, state, profile, context, provider } = useSharedCW("cw-child", transitioning);
  const transition = useCallback(async (command: "close_cw_window" | "dock_detached_window") => {
    if (busy.current) return;
    busy.current = true; setTransitioning(true); setError("");
    try { await invoke(command); }
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
    if (isTauri()) void getCurrentWindow().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, () => { void transition("close_cw_window"); })
      .then(dispose => { if (active) unlisten = dispose; else dispose(); })
      .catch(() => { if (active) setError("Native close notifications are unavailable. Use Close CW; the native output guard remains active."); });
    return () => { active = false; mounted.current = false; unlisten?.(); };
  }, [transition]);
  const controls = {
    arm: () => busy.current ? Promise.resolve() : controller.arm(),
    send: (...args: Parameters<typeof controller.send>) => busy.current ? Promise.resolve() : controller.send(...args),
    stop: controller.stop,
    acknowledgeStopped: () => { if (!busy.current) controller.acknowledgeStopped(); },
  };
  return <div className="app live"><main aria-label="Detached CW"><section className="live-station">
    <header className="live-station-head"><div><h2>CW</h2><p>Shared saved macros and new-QSO context · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_cw_desk").catch(cause => setError(`Could not show Desk: ${String(cause)}`)); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_cw_window")}>Close CW</button>
      </div></header>
    <p>Arm explicitly in the focused window. Focus loss releases its lease. Stop is shared; an unconfirmed output guard prevents Close or Dock.</p>
    <CWDesk profile={profile} context={context} controller={controls}
      state={{ ...state, pending: state.pending || transitioning || !state.canonical }} radioProvider={provider} />
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
