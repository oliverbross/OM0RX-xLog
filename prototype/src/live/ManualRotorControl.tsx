import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { manualRotorGotoSession, type ManualRotorGotoSession } from "./manualRotorGoto";
import { nativeRotorStop } from "./nativeRotorStop";
import { rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
import type { MonitorContext } from "./monitorContext";

export function ManualRotorStatus({ session = manualRotorGotoSession(), onResolved, showMessages = true, onMessage }: {
  session?: ManualRotorGotoSession; onResolved?: (operationId: string) => void; showMessages?: boolean;
  onMessage?: (message: string, error: boolean) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [error, setError] = useState("");
  useEffect(() => { if (error) onMessage?.(error, true); }, [error, onMessage]);
  useEffect(() => { if (state.message) onMessage?.(state.message, false); }, [state.message, onMessage]);
  const recover = async (action: () => Promise<void>, fallback: string) => {
    const operation = session.getSnapshot().pending; setError("");
    try { await action(); if (operation && !session.getSnapshot().pending) onResolved?.(operation); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
  };
  return <>{state.pending && <div className="live-actions"><button disabled={state.busy} onClick={() => void recover(() => session.check(), "Manual rotor receipt unavailable.")}>Check rotor receipt</button>
    {state.reviewable && <button disabled={state.busy} onClick={() => void recover(() => session.review(), "Manual rotor review could not be retained.")}>Acknowledge unknown turn</button>}</div>}
    {showMessages && error && <p className="live-station-error" role="alert">{error}</p>}
    {showMessages && state.message && <p role="status">{state.message}</p>}</>;
}

type RotorObservation = { available: boolean; snapshot: RotorSnapshot | null };
export function ManualRotorControl({ context, observation, session = manualRotorGotoSession(), target, onManual, onPark, hideHeading = false,
  contestLayout = false, onFeedback }: {
  context?: MonitorContext | null; observation?: RotorObservation; session?: ManualRotorGotoSession;
  target?: { callsign: string; shortPathBearing: number | null; longPathBearing: number | null } | null;
  onManual?: () => void | Promise<void>; onPark?: (snapshot: RotorSnapshot) => Promise<void>; hideHeading?: boolean; contestLayout?: boolean;
  onFeedback?: (message: string, error: boolean) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [bearing, setBearing] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean; gotoOperation?: string } | null>(null);
  useEffect(() => { if (feedback) onFeedback?.(feedback.message, feedback.error); }, [feedback, onFeedback]);
  const [stopping, setStopping] = useState(false), [parking, setParking] = useState(false), stoppingRef = useRef(false), parkingRef = useRef(false);
  const retained = observation ?? context?.rotor;
  const rotor = validRotorSnapshot(retained?.snapshot) ? retained!.snapshot : null;
  const connected = !!rotor?.owner && rotorProjection(rotor).connected && retained?.available === true;
  const move = async (target: number, label: string) => {
    setFeedback(null);
    if (!rotor?.owner || !connected || !Number.isFinite(target) || target < 0 || target > 360) {
      setFeedback({ message: "Refresh a connected rotor and use a bearing from 0° to 360°.", error: true }); return;
    }
    try { await onManual?.(); await session.goto(rotor.owner, rotor.generation, target, label); }
    catch (cause) { setFeedback({ message: cause instanceof Error ? cause.message : "Manual rotor Goto failed.", error: true,
      gotoOperation: session.getSnapshot().pending ?? undefined }); }
  };
  const turn = async (event: FormEvent) => {
    event.preventDefault(); await move(Number(bearing), "Manual bearing");
  };
  const park = async () => {
    if (!rotor?.owner || rotor.owner !== "hamlib" || !connected || !onPark || parkingRef.current) return;
    parkingRef.current = true; setParking(true); setFeedback(null);
    try {
      await onManual?.(); await onPark(rotor);
      setFeedback({ message: "Rotor Park acknowledged; watch the observed state.", error: false });
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : "Rotor Park outcome is unknown. Check the observed state before trying again.", error: true });
    } finally { parkingRef.current = false; setParking(false); }
  };
  const stop = async () => {
    const owner = rotor?.owner;
    if (!owner || stoppingRef.current) return;
    stoppingRef.current = true; setStopping(true); setFeedback(null);
    try {
      await nativeRotorStop(owner);
      setFeedback({ message: "Rotor Stop acknowledged; watch the observed state.", error: false });
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : "Rotor Stop outcome is unknown. Check the observed state before trying again.", error: true });
    } finally {
      stoppingRef.current = false; setStopping(false);
    }
  };
  const stopButton = <button type="button" aria-label="Stop rotor" disabled={!rotor?.owner || stopping} onClick={() => void stop()}>{stopping ? "Stopping…" : "Stop"}</button>;
  const parkButton = <button type="button" aria-label="Park rotor" disabled={rotor?.owner !== "hamlib" || !onPark || !connected || parking}
    title={rotor?.owner === "hamlib" ? "Park the connected rotor." : "Park is available for Hamlib rotors."}
    onClick={() => void park()}>{parking ? "Parking…" : "Park"}</button>;
  return <section className={`live-station-card${contestLayout ? " contest-rotor-command-deck" : ""}`} aria-label="Manual rotor Goto">{!hideHeading && <h3>Manual rotor Goto</h3>}
    {contestLayout ? <><div className="contest-rotor-primary-actions" aria-label="Rotor commands">
      {stopButton}<button type="button" aria-label="Move rotor to contest target" disabled={state.busy || !!state.pending || !connected || target?.shortPathBearing == null}
        onClick={() => target?.shortPathBearing != null && void move(target.shortPathBearing, `${target.callsign} SP`)}>Move</button>{parkButton}
    </div><div className="contest-rotor-cardinals" aria-label="Cardinal bearings">
      {([['N', 0], ['S', 180], ['W', 270], ['E', 90]] as const).map(([label, degrees]) => <button type="button" key={label}
        aria-label={`Turn rotor ${label} ${degrees} degrees`} disabled={state.busy || !!state.pending || !connected}
        onClick={() => void move(degrees, `${label} cardinal`)}>{label}</button>)}
    </div><details className="contest-rotor-manual"><summary>Manual bearing &amp; long path</summary>
      <form className="live-station-inline" onSubmit={event => void turn(event)}><label>Bearing °<input aria-label="Manual rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label>
        <button disabled={state.busy || !!state.pending || !connected || !bearing.trim()}>Turn to bearing</button>
        {target?.longPathBearing != null && <button type="button" disabled={state.busy || !!state.pending || !connected}
          onClick={() => void move(target.longPathBearing!, `${target.callsign} LP`)}>Move LP</button>}
      </form></details></> : <form className="live-station-inline" onSubmit={event => void turn(event)}><label>Bearing °<input aria-label="Manual rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label>
      <button disabled={state.busy || !!state.pending || !connected || !bearing.trim()}>Turn rotor</button>
      {target?.shortPathBearing != null && <button type="button" disabled={state.busy || !!state.pending || !connected}
        onClick={() => void move(target.shortPathBearing!, `${target.callsign} SP`)}>Move SP</button>}
      {target?.longPathBearing != null && <button type="button" disabled={state.busy || !!state.pending || !connected}
        onClick={() => void move(target.longPathBearing!, `${target.callsign} LP`)}>Move LP</button>}
      {stopButton}
      {rotor?.owner === "hamlib" && onPark && <button type="button" aria-label="Park rotor" disabled={!connected || parking}
        onClick={() => void park()}>{parking ? "Parking…" : "Park"}</button>}</form>}
    {feedback && (!contestLayout || !onFeedback) && <p className={feedback.error ? "live-station-error" : undefined}
      role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    <ManualRotorStatus session={session} onResolved={operation => setFeedback(current => current?.gotoOperation === operation ? null : current)}
      showMessages={!contestLayout || !onFeedback} onMessage={onFeedback} />
  </section>;
}
