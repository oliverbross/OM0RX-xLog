import { useState, useSyncExternalStore, type FormEvent } from "react";
import { manualRotorGotoSession, type ManualRotorGotoSession } from "./manualRotorGoto";
import { rotorProjection, validRotorSnapshot } from "./rotorControl";
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

export function ManualRotorControl({ context, session = manualRotorGotoSession() }: { context: MonitorContext | null; session?: ManualRotorGotoSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [bearing, setBearing] = useState(""), [error, setError] = useState("");
  const rotor = validRotorSnapshot(context?.rotor?.snapshot) ? context!.rotor.snapshot : null;
  const connected = !!rotor?.owner && rotorProjection(rotor).connected && context?.rotor?.available === true;
  const turn = async (event: FormEvent) => {
    event.preventDefault(); const target = Number(bearing); setError("");
    if (!rotor?.owner || !connected || !Number.isFinite(target) || target < 0 || target > 360) { setError("Refresh a connected rotor and enter a bearing from 0° to 360°."); return; }
    try { await session.goto(rotor.owner, rotor.generation, target); } catch (cause) { setError(cause instanceof Error ? cause.message : "Manual rotor Goto failed."); }
  };
  return <section className="live-station-card" aria-label="Manual rotor Goto"><h3>Manual rotor Goto</h3>
    <form className="live-station-inline" onSubmit={event => void turn(event)}><label>Bearing °<input aria-label="Manual rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label>
      <button disabled={state.busy || !!state.pending || !connected || !bearing.trim()}>Turn rotor</button></form>
    {error && <p className="live-station-error" role="alert">{error}</p>}<ManualRotorStatus session={session} onResolved={() => setError("")} />
  </section>;
}
