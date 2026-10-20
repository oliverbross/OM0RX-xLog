import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { manualRotorGotoSession, type ManualRotorGotoSession } from "./manualRotorGoto";
import { nativeRotorStop } from "./nativeRotorStop";
import { rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
import type { MonitorContext } from "./monitorContext";

export function ManualRotorStatus({ session = manualRotorGotoSession(), onResolved }: { session?: ManualRotorGotoSession; onResolved?: (operationId: string) => void }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [error, setError] = useState("");
  const recover = async (action: () => Promise<void>, fallback: string) => {
    const operation = session.getSnapshot().pending; setError("");
    try { await action(); if (operation && !session.getSnapshot().pending) onResolved?.(operation); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
  };
  return <>{state.pending && <div className="live-actions"><button disabled={state.busy} onClick={() => void recover(() => session.check(), "Manual rotor receipt unavailable.")}>Check rotor receipt</button>
    {state.reviewable && <button disabled={state.busy} onClick={() => void recover(() => session.review(), "Manual rotor review could not be retained.")}>Acknowledge unknown turn</button>}</div>}
    {error && <p className="live-station-error" role="alert">{error}</p>}{state.message && <p role="status">{state.message}</p>}</>;
}

type RotorObservation = { available: boolean; snapshot: RotorSnapshot | null };
export function ManualRotorControl({ context, observation, session = manualRotorGotoSession(), onManual, onPark, hideHeading = false }: {
  context?: MonitorContext | null; observation?: RotorObservation; session?: ManualRotorGotoSession;
  onManual?: () => void | Promise<void>; onPark?: (snapshot: RotorSnapshot) => Promise<void>; hideHeading?: boolean;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [bearing, setBearing] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean; gotoOperation?: string } | null>(null);
  const [stopping, setStopping] = useState(false), [parking, setParking] = useState(false), stoppingRef = useRef(false), parkingRef = useRef(false);
  const retained = observation ?? context?.rotor;
  const rotor = validRotorSnapshot(retained?.snapshot) ? retained!.snapshot : null;
  const connected = !!rotor?.owner && rotorProjection(rotor).connected && retained?.available === true;
  const turn = async (event: FormEvent) => {
    event.preventDefault(); const target = Number(bearing); setFeedback(null);
    if (!rotor?.owner || !connected || !Number.isFinite(target) || target < 0 || target > 360) {
      setFeedback({ message: "Refresh a connected rotor and enter a bearing from 0° to 360°.", error: true }); return;
    }
    try { await onManual?.(); await session.goto(rotor.owner, rotor.generation, target); }
    catch (cause) { setFeedback({ message: cause instanceof Error ? cause.message : "Manual rotor Goto failed.", error: true,
      gotoOperation: session.getSnapshot().pending ?? undefined }); }
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
  return <section className="live-station-card" aria-label="Manual rotor Goto">{!hideHeading && <h3>Manual rotor Goto</h3>}
    <form className="live-station-inline" onSubmit={event => void turn(event)}><label>Bearing °<input aria-label="Manual rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label>
      <button disabled={state.busy || !!state.pending || !connected || !bearing.trim()}>Turn rotor</button>
      <button type="button" aria-label="Stop rotor" disabled={!rotor?.owner || stopping} onClick={() => void stop()}>{stopping ? "Stopping…" : "Stop"}</button>
      {rotor?.owner === "hamlib" && onPark && <button type="button" aria-label="Park rotor" disabled={!connected || parking}
        onClick={() => void park()}>{parking ? "Parking…" : "Park"}</button>}</form>
    {feedback && <p className={feedback.error ? "live-station-error" : undefined} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    <ManualRotorStatus session={session} onResolved={operation => setFeedback(current => current?.gotoOperation === operation ? null : current)} />
  </section>;
}
