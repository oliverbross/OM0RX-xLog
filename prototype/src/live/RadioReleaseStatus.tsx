import { useEffect, useState, useSyncExternalStore } from "react";
import { radioReleaseSession, type RadioReleaseSession } from "./radioRelease";
import { listen } from "@tauri-apps/api/event";
import { nativeStationSelection } from "./stationSelection";

export function RadioReleaseStatus({ session = radioReleaseSession() }: { session?: RadioReleaseSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), [error, setError] = useState("");
  useEffect(() => {
    if (session === radioReleaseSession() && !nativeStationSelection()) return;
    let active = true; let stop: (() => void) | undefined;
    const refresh = () => { void session.refresh().catch(cause => { if (active) setError(String(cause)); }); };
    refresh(); void listen("xlog:radio-release", refresh).then(unlisten => { if (active) stop = unlisten; else unlisten(); }).catch(() => {});
    return () => { active = false; stop?.(); };
  }, [session]);
  const recover = (action: () => Promise<void>) => { setError(""); void action().catch(cause => setError(cause instanceof Error ? cause.message : "Radio Cancel receipt unavailable.")); };
  return <section aria-label="Radio Cancel receipts">{state.message && <p role="status">{state.message}</p>}{error && <p role="alert">{error}</p>}
    {state.pending.map(id => <div key={id}><span>Retained Cancel {id.slice(0, 8)}</span>
      <button type="button" onClick={() => recover(() => session.check(id))}>Check Cancel receipt</button>
      {state.operations.some(receipt => receipt.operation_id === id && receipt.status === "unknown") && <button type="button" onClick={() => recover(() => session.review(id))}>I have reviewed observed radio state</button>}
    </div>)}
  </section>;
}
