import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SharedPropagationConditions from "./SharedPropagationConditions";

export function DetachedPropagationSurface() {
  const [transitioning, setTransitioning] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const transition = async (command: "dock_detached_window" | "close_propagation_window") => {
    if (busy.current) return;
    busy.current = true; setTransitioning(true); setError("");
    try { await invoke(command); }
    catch (cause) { if (mounted.current) { busy.current = false; setTransitioning(false); setError(`Propagation remains open. ${cause instanceof Error ? cause.message : String(cause)}`); } }
  };
  return <div className="app live"><main aria-label="Detached Propagation"><section className="live-station">
    <header className="live-station-head"><div><h2>Propagation</h2><p>Shared public conditions · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_propagation_desk").catch(cause => { if (mounted.current) setError(`Could not show Desk: ${String(cause)}`); }); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_propagation_window")}>Close Propagation</button>
      </div></header>
    <p>Opening this window reads retained conditions only. Refresh propagation explicitly to request shared public data; the source service keeps its ten-minute cache. These reports do not predict or verify your radio path.</p>
    <SharedPropagationConditions includeWeather={false} />
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
