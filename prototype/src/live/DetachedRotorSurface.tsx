import { useEffect, useState } from "react";
import RotorCompass from "./RotorCompass";
import { connectRotorTelemetry } from "./rotorTelemetry";
import { rotorProjection, type RotorSnapshot } from "./rotorControl";
import "./DetachedTaskSurface.css";

/** Read-only subscriber to the application's existing native rotor owner.
 * No configuration, command fallback, device reads or renderer poller. */
export function DetachedRotorSurface() {
  const [snapshot, setSnapshot] = useState<RotorSnapshot | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const dispose = connectRotorTelemetry(value => { setSnapshot(value); setAvailable(true); }, () => setAvailable(false));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { dispose?.(); clearInterval(timer); };
  }, []);
  const rotor = rotorProjection(snapshot);
  const validBearing = typeof rotor.azimuth === "number" && Number.isFinite(rotor.azimuth) && rotor.azimuth >= 0 && rotor.azimuth <= 360;
  const age = typeof rotor.observed_at === "number" ? clock / 1000 - rotor.observed_at : Infinity;
  const current = available && rotor.connected === true && validBearing && age >= -1 && age <= 5;
  return <div className="app live detached-task-app detached-rotor-app"><main aria-label="Detached Rotor"><section className="detached-rotor-observation" aria-label="Rotor state">
    <p role="status">{current ? "Current observed bearing" : snapshot ? "Position unavailable or stale" : "No rotor observation available"}</p>
    <RotorCompass connected={current} azimuth={rotor.azimuth} path="SP" />
    <div className="live-station-readback"><div><span>{current ? "Observed bearing" : "Retained bearing"}</span>
      <strong>{validBearing ? `${rotor.azimuth.toFixed(1)}°` : "Unavailable"}</strong></div></div>
    <dl><dt>Rotor</dt><dd>{snapshot?.owner ? String(rotor.name) : "No retained owner"}</dd>
      <dt>Connection</dt><dd>{available ? String(rotor.status) : "Unavailable or stale"}</dd>
      <dt>Generation</dt><dd>{snapshot?.generation ?? "Unavailable"}</dd>
      <dt>Position observed</dt><dd>{typeof rotor.observed_at === "number" && Number.isFinite(rotor.observed_at) ? new Date(rotor.observed_at * 1000).toLocaleTimeString() : "Unavailable"}</dd>
    </dl>
  </section></main></div>;
}
