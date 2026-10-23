import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import RotorCompass from "./RotorCompass";
import { connectRotorTelemetry } from "./rotorTelemetry";
import { rotorProjection, type RotorSnapshot } from "./rotorControl";
import { useAutoRotor } from "./useAutoRotor";
import { ManualRotorControl } from "./ManualRotorControl";
import { manualRotorGotoSession } from "./manualRotorGoto";
import { rotorCommandParams, validRotorSnapshot } from "./rotorControl";
import { workerRequest } from "../worker";
import { serviceErrorMessage } from "./startupReadRecovery";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestRotorTarget, reportContestSurfaceDiagnostic,
  type ContestRotorTarget, type ContestSurfaceContext } from "../contesting/contestSurfaceNative";
import "./DetachedTaskSurface.css";

/** Retained observations and the existing native automatic-rotor controller.
 * No configuration, direct device reads or independent motion owner. */
export function DetachedRotorSurface() {
  const [snapshot, setSnapshot] = useState<RotorSnapshot | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const automatic = useAutoRotor(), [autoError, setAutoError] = useState("");
  const manualSession = manualRotorGotoSession(), manualState = useSyncExternalStore(manualSession.subscribe, manualSession.getSnapshot);
  const [compassError, setCompassError] = useState("");
  const [arming, setArming] = useState(false);
  const latest = useRef({ snapshot, available }); latest.current = { snapshot, available };
  const active = useRef(true), armingRef = useRef(false);
  const contestContext = (() => {
    if (new URLSearchParams(window.location.search).get("scope") !== "contesting") return null;
    try { const { panelID, ...context } = contestSurfaceContextFromSearch(window.location.search); return panelID === "rotor" ? context : null; }
    catch { return null; }
  })() as ContestSurfaceContext | null;
  const [contestTarget, setContestTarget] = useState<ContestRotorTarget | null>(null);
  const reportContestMessage = useCallback((message: string, error: boolean) => {
    if (!contestContext || !message.trim()) return;
    void reportContestSurfaceDiagnostic(contestContext, error ? "error" : "notice", message.trim().slice(0, 512)).catch(() => {});
  }, [contestContext?.operatingContext, contestContext?.sessionID, contestContext?.workspaceGeneration]);
  const reportedAutomaticError = useRef(""), reportedCompassError = useRef("");
  useEffect(() => {
    const message = autoError || automatic.error;
    if (!contestContext || !message || reportedAutomaticError.current === message) return;
    reportedAutomaticError.current = message; reportContestMessage(message, true);
  }, [autoError, automatic.error, contestContext, reportContestMessage]);
  useEffect(() => {
    if (!contestContext || !compassError || reportedCompassError.current === compassError) return;
    reportedCompassError.current = compassError; reportContestMessage(compassError, true);
  }, [compassError, contestContext, reportContestMessage]);
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
  const turnFromCompass = async (bearing: number) => {
    const retained = latest.current, observed = rotorProjection(retained.snapshot);
    const observedAge = typeof observed.observed_at === "number" ? Date.now() / 1000 - observed.observed_at : Infinity;
    if (!contestContext || !retained.available || !retained.snapshot?.owner || !observed.connected ||
        !Number.isFinite(observed.azimuth) || observed.azimuth < 0 || observed.azimuth > 360 ||
        !Number.isFinite(observedAge) || observedAge < -1 || observedAge > 5) {
      setCompassError("Refresh the connected rotor observation before selecting a compass bearing."); return;
    }
    setCompassError("");
    try {
      if (automatic.state?.armed) await changeAutomatic(false);
      await manualSession.goto(retained.snapshot.owner, retained.snapshot.generation, bearing, `Compass ${Math.round(bearing)} deg`);
    } catch (cause) {
      setCompassError(serviceErrorMessage(cause) || "Compass rotor outcome is unknown. Check the retained receipt and observed bearing.");
    }
  };
  const target = contestTarget?.available && contestTarget.callsign ? {
    callsign: contestTarget.callsign, shortPathBearing: contestTarget.shortPathBearing, longPathBearing: contestTarget.longPathBearing,
  } : null;
  const automaticControls = <><div className="live-actions detached-rotor-actions">
      <label title={automatic.state ? "Follow the resolved callsign using the native rotor. Selected spots wait for confirmed radio tuning. Stop or reconnect disables automatic turns."
        : "Auto rotor requires an available retained controller and current connected rotor observation."}>
        <input type="checkbox" aria-label="Auto rotor" checked={armed} disabled={!armed && (!canArm || arming)}
          onChange={event => { void changeAutomatic(event.target.checked); }} />Auto rotor</label>
      <button type="button" aria-label="Turn automatic rotor off" title="Disarm future automatic turns."
        onClick={() => { void changeAutomatic(false); }}>Off</button>
    </div>
    {!contestContext && (autoError || automatic.error) && <p className="live-error" role="alert">{autoError || automatic.error}</p>}</>;
  const manualControls = <ManualRotorControl observation={{ available: current, snapshot }} target={target} session={manualSession}
      onManual={() => automatic.state?.armed ? changeAutomatic(false) : undefined}
      onPark={parkCurrent} hideHeading contestLayout={!!contestContext} onFeedback={contestContext ? reportContestMessage : undefined} />;
  const visual = <div className="detached-rotor-visual"><RotorCompass connected={current} azimuth={rotor.azimuth}
    target={contestContext ? target?.shortPathBearing : undefined} path="SP"
    onBearingSelect={contestContext ? bearing => void turnFromCompass(bearing) : undefined}
    bearingSelectionDisabled={!current || manualState.busy || !!manualState.pending}
    readout={contestContext ? { call: target?.callsign ?? "NO TARGET", status: current ? "Observed rotor bearing" : "Rotor telemetry unavailable" } : undefined} />
    {!contestContext && compassError && <p className="live-error" role="alert">{compassError}</p>}
    {!contestContext && <div className="live-station-readback"><div><span role="status">{current ? "Observed bearing" : snapshot ? "Position unavailable or stale" : "No rotor observation available"}</span>
      <strong>{validBearing ? `${rotor.azimuth.toFixed(1)}°` : "Unavailable"}</strong></div></div>}</div>;
  return <div className="app live detached-task-app detached-rotor-app"><main aria-label="Detached Rotor"><section
    className={`detached-rotor-observation${contestContext ? " is-contest-rotor" : ""}`} aria-label="Rotor state">
    {contestContext ? <>{visual}<div className="detached-rotor-details">{manualControls}</div>
      <div className="detached-rotor-secondary">{automaticControls}</div></>
      : <>{visual}<div className="detached-rotor-details">{automaticControls}{manualControls}</div></>}
  </section></main></div>;
}
