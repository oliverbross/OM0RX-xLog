import { useState, useSyncExternalStore } from "react";
import { manualTuneSession, type ManualTuneSession } from "./manualTune";
import type { StationProvider } from "../worker";
import type { MonitorContext } from "./monitorContext";

export function ManualTuneStatus({ session = manualTuneSession() }: { session?: ManualTuneSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [error, setError] = useState("");
  return <>{state.message && <p role="status">{state.message}</p>}{error && <p role="alert">{error}</p>}
    {state.pending && <button type="button" disabled={state.busy} onClick={() => void session.check().catch(cause => setError(cause instanceof Error ? cause.message : "Manual tune receipt unavailable."))}>Check manual tune receipt</button>}
    {state.reviewable && <button type="button" disabled={state.busy} onClick={() => { try { session.review(); } catch { setError("Manual tune review could not be retained."); } }}>I have reviewed observed radio state</button>}</>;
}
export function ManualSimplexTune({ provider, context, session = manualTuneSession() }: { provider: StationProvider; context?: MonitorContext | null; session?: ManualTuneSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [frequency, setFrequency] = useState(""), [mode, setMode] = useState("USB"), [error, setError] = useState("");
  const hz = /^\d+(?:\.\d{1,6})?$/.test(frequency) ? Math.round(Number(frequency) * 1e6) : 0;
  return <section aria-label="Shared manual simplex tune"><h3>Manual simplex tune</h3>
    <label>Simplex frequency MHz<input aria-label="Simplex frequency MHz" inputMode="decimal" value={frequency} onChange={event => setFrequency(event.target.value)} /></label>
    <label>Simplex mode<select aria-label="Simplex mode" value={mode} onChange={event => setMode(event.target.value)}>{["USB", "LSB", "SSB", "CW", "CWR", "AM", "FM", "RTTY", "RTTYR", "FT8", "FT4", "DIGU", "DIGL"].map(value => <option key={value}>{value}</option>)}</select></label>
    <button type="button" disabled={state.busy || !!state.pending || !!context?.acceptance || hz < 100_000 || hz > 1_000_000_000} onClick={() => {
      setError(""); void session.tune(provider, hz, mode, context).catch(cause => setError(cause instanceof Error ? cause.message : "Manual tune was not confirmed."));
    }}>Tune simplex</button>
    {error && <p role="alert">{error}</p>}<ManualTuneStatus session={session} />
  </section>;
}
