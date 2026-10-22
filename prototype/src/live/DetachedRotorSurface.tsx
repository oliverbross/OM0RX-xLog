import { useEffect, useRef, useState } from "react";
import RotorCompass from "./RotorCompass";
import { connectRotorTelemetry } from "./rotorTelemetry";
import { rotorProjection, type RotorSnapshot } from "./rotorControl";
import { useAutoRotor } from "./useAutoRotor";
import { ManualRotorControl } from "./ManualRotorControl";
import { rotorCommandParams, validRotorSnapshot } from "./rotorControl";
import { workerRequest } from "../worker";
import { serviceErrorMessage } from "./startupReadRecovery";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestRotorTarget,
  type ContestRotorTarget, type ContestSurfaceContext } from "../contesting/contestSurfaceNative";
import "./DetachedTaskSurface.css";

/** Retained observations and the existing native automatic-rotor controller.
 * No configuration, direct device reads or independent motion owner. */
export function DetachedRotorSurface() {
  const [snapshot, setSnapshot] = useState<RotorSnapshot | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const automatic = useAutoRotor(), [autoError, setAutoError] = useState("");
  const [arming, setArming] = useState(false);
  const latest = useRef({ snapshot, available }); latest.current = { snapshot, available };
  const active = useRef(true), armingRef = useRef(false);
  const contestContext = (() => {
    if (new URLSearchParams(window.location.search).get("scope") !== "contesting") return null;
    try { const { panelID, ...context } = contestSurfaceContextFromSearch(window.location.search); return panelID === "rotor" ? context : null; }
    catch { return null; }
  })() as ContestSurfaceContext | null;
  const [contestTarget, setContestTarget] = useState<ContestRotorTarget | null>(null);
  useEffect(() => {
    if (!contestContext) { setContestTarget(null); return; }
    let mounted = true, stop: (() => void) | undefined;
    const refresh = async () => { try { const value = await readContestRotorTarget(contestContext); if (mounted) setContestTarget(value); }
      catch { if (mounted) setContestTarget(null); } };
    void refresh(); void onContestSurfaceWake(() => void refresh()).then(dispose => { if (mounted) stop = dispose; else dispose(); });
    return () => { mounted = false; stop?.(); };
  }, [contestContext?.operatingContext, contestContext?.sessionID, contestContext?.workspaceGeneration]);
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
    catch (cause) { if (active.current) setAutoError(serviceErrorMessage(cause) || "Automatic rotor control failed. Check the rotor connection and try again."); }
    finally { if (enabled) { armingRef.current = false; if (active.current) setArming(false); } }
  };
  const parkCurrent = async (captured: RotorSnapshot) => {
    const reply = await workerRequest("rotor_park", rotorCommandParams(captured));
    if (!validRotorSnapshot(reply.result) || reply.result.owner !== captured.owner || reply.result.state !== "active" ||
        reply.result.backend_available === false || reply.result.generation < captured.generation)
      throw new Error("Rotor Park acknowledgement could not be verified. Check the observed state before trying again.");
  };
  const target = contestTarget?.available && contestTarget.callsign ? {
    callsign: contestTarget.callsign, shortPathBearing: contestTarget.shortPathBearing, longPathBearing: contestTarget.longPathBearing,
  } : null;
  const automaticControls = <><div className="live-actions detached-rotor-actions">
      <label title="Follow the resolved callsign using the native rotor. Selected spots wait for confirmed radio tuning. Stop or reconnect disables automatic turns.">
        <input type="checkbox" aria-label="Auto rotor" checked={armed} disabled={!armed && (!canArm || arming)}
          onChange={event => { void changeAutomatic(event.target.checked); }} />{automatic.state ? "Auto rotor" : "Auto rotor unavailable"}</label>
      <button type="button" aria-label="Turn automatic rotor off" title="Disarm future automatic turns."
        onClick={() => { void changeAutomatic(false); }}>Off</button>
    </div>
    {(autoError || automatic.error) && <p className="live-error" role="alert">{autoError || automatic.error}</p>}</>;
  const manualControls = <ManualRotorControl observation={{ available: current, snapshot }} target={target}
      onManual={() => automatic.state?.armed ? changeAutomatic(false) : undefined}
      onPark={parkCurrent} hideHeading contestLayout={!!contestContext} />;
  return <div className="app live detached-task-app detached-rotor-app"><main aria-label="Detached Rotor"><section
    className={`detached-rotor-observation${contestContext ? " is-contest-rotor" : ""}`} aria-label="Rotor state">
    {contestContext && <div className="detached-rotor-details">{manualControls}</div>}
    <div className="detached-rotor-visual"><RotorCompass connected={current} azimuth={rotor.azimuth}
      target={contestContext ? target?.shortPathBearing : undefined} path="SP"
      readout={contestContext ? { call: target?.callsign ?? "NO TARGET", status: current ? "Observed rotor bearing" : "Rotor telemetry unavailable" } : undefined} />
    {!contestContext && <div className="live-station-readback"><div><span role="status">{current ? "Observed bearing" : snapshot ? "Position unavailable or stale" : "No rotor observation available"}</span>
      <strong>{validBearing ? `${rotor.azimuth.toFixed(1)}°` : "Unavailable"}</strong></div></div>}</div>
    {contestContext ? <div className="detached-rotor-secondary">{automaticControls}</div> : <div className="detached-rotor-details">{automaticControls}{manualControls}</div>}
  </section></main></div>;
}
