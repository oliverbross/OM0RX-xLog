import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import RotorCompass from "./RotorCompass";
import { connectRotorTelemetry } from "./rotorTelemetry";
import { rotorProjection, type RotorSnapshot } from "./rotorControl";

/** Read-only subscriber to the application's existing native rotor owner.
 * No configuration, command fallback, device reads or renderer poller. */
export function DetachedRotorSurface() {
  const [snapshot, setSnapshot] = useState<RotorSnapshot | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now()), [error, setError] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const mounted = useRef(false), busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const dispose = connectRotorTelemetry(value => { setSnapshot(value); setAvailable(true); }, () => setAvailable(false));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { mounted.current = false; dispose?.(); clearInterval(timer); };
  }, []);
  const transition = async (command: "dock_detached_window" | "close_rotor_window") => {
    if (busy.current) return;
    busy.current = true; setTransitioning(true); setError("");
    try { await invoke(command); }
    catch (cause) {
      if (mounted.current) { busy.current = false; setTransitioning(false); setError(`Rotor remains open. ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
  };
  const rotor = rotorProjection(snapshot);
  const validBearing = typeof rotor.azimuth === "number" && Number.isFinite(rotor.azimuth) && rotor.azimuth >= 0 && rotor.azimuth <= 360;
  const age = typeof rotor.observed_at === "number" ? clock / 1000 - rotor.observed_at : Infinity;
  const current = available && rotor.connected === true && validBearing && age >= -1 && age <= 5;
  return <div className="app live"><main aria-label="Detached Rotor"><section className="live-station">
    <header className="live-station-head"><div><h2>Rotor observations</h2><p>Read only · existing native telemetry · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_rotor_desk").catch(cause => { if (mounted.current) setError(`Could not show Desk: ${String(cause)}`); }); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_rotor_window")}>Close Rotor</button>
      </div></header>
    <p>Connection setup, turning and Stop remain in Desk or Station Monitor. Opening or closing this observation window never changes rotor motion.</p>
    <p role="status">{current ? "Current observed bearing" : snapshot ? "Position unavailable or stale · retained values are display only" : "No retained rotor observation available. Connect a rotor in Desk; this window does not start device polling."}</p>
    <RotorCompass connected={current} azimuth={rotor.azimuth} path="SP" />
    <div className="live-station-readback"><div><span>{current ? "Observed bearing" : "Retained bearing"}</span>
      <strong>{validBearing ? `${rotor.azimuth.toFixed(1)}°` : "Unavailable"}</strong></div></div>
    <dl><dt>Rotor</dt><dd>{snapshot?.owner ? String(rotor.name) : "No retained owner"}</dd>
      <dt>Connection</dt><dd>{available ? String(rotor.status) : "Unavailable or stale"}</dd>
      <dt>Generation</dt><dd>{snapshot?.generation ?? "Unavailable"}</dd>
      <dt>Position observed</dt><dd>{typeof rotor.observed_at === "number" && Number.isFinite(rotor.observed_at) ? new Date(rotor.observed_at * 1000).toLocaleTimeString() : "Unavailable"}</dd>
    </dl>
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
