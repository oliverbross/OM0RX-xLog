import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import RotorCompass from "./RotorCompass";
import { connectRotorTelemetry } from "./rotorTelemetry";
import { rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
import { useAutoRotor } from "./useAutoRotor";
import "./DetachedTaskSurface.css";

/** Retained observations and the existing native automatic-rotor controller.
 * No configuration, direct device reads or independent motion owner. */
export function DetachedRotorSurface() {
  const [snapshot, setSnapshot] = useState<RotorSnapshot | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const automatic = useAutoRotor(), [autoError, setAutoError] = useState(""), [stopError, setStopError] = useState("");
  const [arming, setArming] = useState(false), [stopping, setStopping] = useState(false);
  const latest = useRef({ snapshot, available }); latest.current = { snapshot, available };
  const active = useRef(true), armingRef = useRef(false), stoppingRef = useRef(false);
  useEffect(() => {
    active.current = true;
    const dispose = connectRotorTelemetry(value => { setSnapshot(value); setAvailable(true); }, () => setAvailable(false));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { active.current = false; dispose?.(); clearInterval(timer); };
  }, []);
  const rotor = rotorProjection(snapshot);
  const validBearing = typeof rotor.azimuth === "number" && Number.isFinite(rotor.azimuth) && rotor.azimuth >= 0 && rotor.azimuth <= 360;
  const age = typeof rotor.observed_at === "number" ? clock / 1000 - rotor.observed_at : Infinity;
  const current = available && rotor.connected === true && validBearing && age >= -1 && age <= 5;
  const armed = automatic.state?.armed === true;
  const canArm = current && !!snapshot?.owner && !!automatic.state && !automatic.error;
  const changeAutomatic = async (enabled: boolean) => {
    const retained = latest.current, observed = rotorProjection(retained.snapshot);
    const observedAge = typeof observed.observed_at === "number" ? Date.now() / 1000 - observed.observed_at : Infinity;
    if (enabled && (armingRef.current || !automatic.state || automatic.error || !retained.available || !retained.snapshot?.owner ||
      !observed.connected || !Number.isFinite(observed.azimuth) || observed.azimuth < 0 || observed.azimuth > 360 || !Number.isFinite(observedAge) || observedAge < -1 || observedAge > 5)) return;
    if (enabled) { armingRef.current = true; setArming(true); }
    setAutoError("");
    try { await automatic.set(enabled, enabled ? retained.snapshot : undefined); }
    catch (cause) { if (active.current) setAutoError(cause instanceof Error ? cause.message : "Automatic rotor control failed."); }
    finally { if (enabled) { armingRef.current = false; if (active.current) setArming(false); } }
  };
  const stopCurrent = async () => {
    const owner = latest.current.snapshot?.owner;
    if (!owner || stoppingRef.current) return;
    stoppingRef.current = true; setStopping(true); setStopError("");
    try {
      const reply: any = await invoke("monitor_rotor_stop", { owner });
      if (reply?.ok !== true || !validRotorSnapshot(reply.result))
        throw new Error(reply?.error?.message || "Rotor Stop was not acknowledged. Check the observed state before trying again.");
    } catch (cause) {
      if (active.current) setStopError(cause instanceof Error ? cause.message : "Rotor Stop outcome is unknown. Check the observed state before trying again.");
    } finally {
      stoppingRef.current = false; if (active.current) setStopping(false);
    }
  };
  return <div className="app live detached-task-app detached-rotor-app"><main aria-label="Detached Rotor"><section className="detached-rotor-observation" aria-label="Rotor state">
    <p role="status">{current ? "Current observed bearing" : snapshot ? "Position unavailable or stale" : "No rotor observation available"}</p>
    <div className="detached-rotor-visual"><RotorCompass connected={current} azimuth={rotor.azimuth} path="SP" />
    <div className="live-station-readback"><div><span>{current ? "Observed bearing" : "Retained bearing"}</span>
      <strong>{validBearing ? `${rotor.azimuth.toFixed(1)}°` : "Unavailable"}</strong></div></div></div>
    <div className="detached-rotor-details"><div className="live-actions detached-rotor-actions">
      <label title="Follow the resolved callsign using the native rotor. Selected spots wait for confirmed radio tuning. Stop or reconnect disables automatic turns.">
        <input type="checkbox" aria-label="Auto rotor" checked={armed} disabled={!armed && (!canArm || arming)}
          onChange={event => { void changeAutomatic(event.target.checked); }} />{automatic.state ? "Auto rotor" : "Auto rotor unavailable"}</label>
      <button type="button" aria-label="Turn automatic rotor off" title="Disarm future automatic turns."
        onClick={() => { void changeAutomatic(false); }}>Off</button>
      <button type="button" aria-label="Stop rotor" disabled={!snapshot?.owner || stopping}
        title="Stop the current move through the native rotor owner. No move is replayed."
        onClick={() => { void stopCurrent(); }}>{stopping ? "Stopping…" : "Stop"}</button>
    </div>
    {(stopError || autoError || automatic.error) && <p className="live-error" role="alert">{stopError || autoError || automatic.error}</p>}
    <dl><dt>Rotor</dt><dd>{snapshot?.owner ? String(rotor.name) : "No retained owner"}</dd>
      <dt>Connection</dt><dd>{available ? String(rotor.status) : "Unavailable or stale"}</dd>
      <dt>Generation</dt><dd>{snapshot?.generation ?? "Unavailable"}</dd>
      <dt>Position observed</dt><dd>{typeof rotor.observed_at === "number" && Number.isFinite(rotor.observed_at) ? new Date(rotor.observed_at * 1000).toLocaleTimeString() : "Unavailable"}</dd>
    </dl></div>
  </section></main></div>;
}
