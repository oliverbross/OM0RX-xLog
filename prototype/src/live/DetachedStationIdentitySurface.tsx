import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectStationIdentity, type IdentityProjection } from "./stationIdentity";
const shown = (value: string | undefined) => value?.trim() || "Not configured";

export function DetachedStationIdentitySurface() {
  const [projection, setProjection] = useState<IdentityProjection | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState(""), [transitionError, setTransitionError] = useState(""), [transitioning, setTransitioning] = useState(false);
  const mounted = useRef(false), busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const dispose = connectStationIdentity(value => { setProjection(value); setVerified(true); setError(""); },
      message => { setVerified(false); setError(message); }, () => setVerified(false));
    return () => { mounted.current = false; dispose(); };
  }, []);
  const transition = async (command: "dock_detached_window" | "close_station_identity_window") => {
    if (busy.current) return;
    busy.current = true; setTransitioning(true); setTransitionError("");
    try { await invoke(command); }
    catch (cause) { if (mounted.current) { busy.current = false; setTransitioning(false); setTransitionError(`Station Identity remains open. ${cause instanceof Error ? cause.message : String(cause)}`); } }
  };
  const identity = projection?.snapshot, current = verified && projection?.available === true;
  return <div className="app live"><main aria-label="Detached Station Identity"><section className="live-station">
    <header className="live-station-head"><div><h2>Station Identity</h2><p>Saved non-secret settings · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_station_identity_desk").catch(cause => { if (mounted.current) setTransitionError(`Could not show Desk: ${String(cause)}`); }); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_station_identity_window")}>Close Identity</button>
      </div></header>
    <p role="status">{current ? "Verified saved identity" : identity ? "Saved identity unavailable or changing · retained values only" : "No saved identity has been observed. Open Desk or Settings to load canonical saved settings."}</p>
    <p>This read-only window never reads Settings, initializes defaults or connects a service. Saved identity is not confirmation of the connected radio or RF readiness.</p>
    <div className="live-station-readback"><div><span>{current ? "Saved station callsign" : "Retained station callsign"}</span><strong>{shown(identity?.station_call)}</strong></div></div>
    <dl><dt>Operator callsign</dt><dd>{shown(identity?.operator_call)}</dd><dt>Grid</dt><dd>{shown(identity?.grid)}</dd>
      <dt>Location</dt><dd>{shown(identity?.location)}</dd><dt>Logbook mode</dt><dd>{identity?.logbook_mode === "local" ? "Standalone local logbook" : identity?.logbook_mode === "wavelog" ? "Wavelog-linked logbook" : "Unavailable"}</dd>
      <dt>Saved settings revision</dt><dd>{identity?.settings_revision ?? "Unavailable"}</dd>
      <dt>Workspace generation</dt><dd>{identity?.workspace_generation ?? "Unavailable"}</dd>
      <dt>Workspace service generation</dt><dd>{identity?.worker_generation ?? "Unavailable"}</dd>
    </dl>
    {error && <p role="alert">{error}</p>}{transitionError && <p role="alert">{transitionError}</p>}
  </section></main></div>;
}
