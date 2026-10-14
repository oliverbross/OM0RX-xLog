import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectAntenna, type AntennaSnapshot } from "./antennaSession";
import { DeskAntenna } from "./StationEquipment";
export function DetachedAntennaSurface() {
  const [projection, setProjection] = useState<AntennaSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState(""), [transitionError, setTransitionError] = useState(""), [transitioning, setTransitioning] = useState(false);
  const mounted = useRef(false), busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const dispose = connectAntenna(value => { setProjection(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return () => { mounted.current = false; dispose(); };
  }, []);
  const transition = async (command: "dock_detached_window" | "close_antenna_window") => {
    if (busy.current) return; busy.current = true; setTransitioning(true); setTransitionError("");
    try { await invoke(command); }
    catch (cause) { if (mounted.current) { busy.current = false; setTransitioning(false); setTransitionError(`Antenna remains open. ${String(cause)}`); } }
  };
  const profile = projection?.snapshot, current = verified && projection?.available === true;
  return <div className="app live"><main aria-label="Detached Antenna"><section className="live-station">
    <header className="live-station-head"><div><h2>Antenna reference</h2><p>Saved fixed-antenna profile · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_antenna_desk").catch(cause => { if (mounted.current) setTransitionError(`Could not show Desk: ${String(cause)}`); }); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_antenna_window")}>Close Antenna</button>
      </div></header>
    <p role="status">{current ? "Verified saved profile — no telemetry" : profile ? "Saved profile unavailable or changing — retained reference only" : "No saved antenna profile observed. Open Desk or Settings to load canonical saved settings."}</p>
    <p>This reference never selects an antenna, controls a switch or confirms matching or RF readiness. Edit the saved equipment profile in Settings.</p>
    {profile?.display === "antenna" ? <DeskAntenna profile={profile} /> : profile ? <p>Fixed antenna display is not selected in saved settings. No antenna installation is inferred.</p> : null}
    {profile && <dl><dt>Saved settings revision</dt><dd>{profile.settings_revision}</dd><dt>Workspace generation</dt><dd>{profile.workspace_generation}</dd></dl>}
    {error && <p role="alert">{error}</p>}{transitionError && <p role="alert">{transitionError}</p>}
  </section></main></div>;
}
