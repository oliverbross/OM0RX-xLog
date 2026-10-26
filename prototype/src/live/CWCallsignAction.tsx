import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CWDecodeSnapshot, CWDecodeTrack } from "./cwDecode";

export type CWCallsignOutcome = { operationId: string; phase: "preparing" | "draft_applied" | "confirmed" | "blocked" | "failed" | "uncertain"; reservationActive: boolean; error?: string };
export type CWCallsignRequest = (params: Record<string, unknown>) => Promise<unknown>;
export const requestCWCallsign: CWCallsignRequest = params => invoke("cw_callsign_request", { params });
const key = "xlog.cw.pending-callsign";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) && value !== "00000000-0000-0000-0000-000000000000";
export function parseCWCallsignOutcome(value: any, operation: string): CWCallsignOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.operationId !== operation || !uuid(operation) ||
    !["preparing", "draft_applied", "confirmed", "blocked", "failed", "uncertain"].includes(value.phase) || typeof value.reservationActive !== "boolean" ||
    Object.keys(value).some(field => !["operationId", "phase", "reservationActive", "error"].includes(field)) ||
    value.error !== undefined && (typeof value.error !== "string" || value.error.length > 4096))
    throw new Error("The callsign outcome could not be verified. Check the original action before trying again.");
  return value;
}
function retainedOperation(): string | null {
  try {
    const value = sessionStorage.getItem(key);
    return value === null ? null : uuid(value) ? value : "unverified";
  } catch { return "unverified"; }
}
/** An explicit click creates one identity. Lost acknowledgements retain it;
 * checking an outcome never resubmits the callsign or any station effect. */
export function CWCallsignAction({ signal, snapshot, request = requestCWCallsign }: {
  signal?: CWDecodeTrack; snapshot: CWDecodeSnapshot; request?: CWCallsignRequest;
}) {
  const operation = useRef<string | null>(retainedOperation());
  const inFlight = useRef(false);
  const [pending, setPending] = useState(operation.current), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CWCallsignOutcome | null>(null), [error, setError] = useState("");
  const eligible = snapshot.featureEnabled === true && snapshot.state === "running" && ["normal_logging", "contesting"].includes(snapshot.operatingModule ?? "") &&
    uuid(snapshot.operatingContext) && !!signal?.selection?.activation && !signal.ambiguous;
  const run = async (check: boolean) => {
    if (inFlight.current || (!check && (!eligible || operation.current)) || check && !uuid(operation.current)) return;
    const id = check ? operation.current! : crypto.randomUUID();
    try { sessionStorage.setItem(key, id); } catch { setError("The action identity could not be retained. Callsign loading is unavailable."); return; }
    operation.current = id; setPending(id); inFlight.current = true; setBusy(true); setError(""); setOutcome(null);
    try {
      const selection = signal?.selection;
      const params = check ? { action: "reconcile", operationId: id } : { action: "apply", operationId: id,
        sourceEpoch: selection!.activation!.sourceEpoch, spotId: selection!.reference.trackID, spotVersion: selection!.activation!.spotVersion,
        operatingModule:snapshot.operatingModule,operatingContext:snapshot.operatingContext };
      const next = parseCWCallsignOutcome(await request(params), id); setOutcome(next);
      if (["confirmed", "blocked", "failed"].includes(next.phase) && !next.reservationActive) {
        sessionStorage.removeItem(key); operation.current = null; setPending(null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Callsign loading could not be confirmed. Check the original action."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="cw-decode-callsign" aria-label="CW callsign loading">
    <div className="cw-decode-actions"><button type="button" disabled={!eligible || busy || !!pending} onClick={() => void run(false)}
      title="Load the observed callsign into the active logging entry, preserving its frequency, mode and operator text.">Use callsign{signal?.selection ? ` ${signal.selection.callsign}` : ""}</button>
      {pending && <button type="button" disabled={busy || !uuid(pending)} onClick={() => void run(true)}>Check original action</button>}</div>
    {!snapshot.operatingModule && <p>Callsign loading requires an active logging module.</p>}
    {pending && <p role="status">{busy ? "Checking callsign loading…" : "The previous action needs a verified outcome before another callsign can be loaded."}</p>}
    {pending === "unverified" && <p role="alert">The retained callsign identity cannot be read. Review Main Logging before further callsign loading.</p>}
    {outcome?.phase === "confirmed" && <p role="status">Callsign loaded into the logging entry. Frequency and mode are retained.</p>}
    {outcome && outcome.phase !== "confirmed" && !pending && <p role="status">{outcome.error || "Callsign loading was blocked. Review Main Logging before selecting again."}</p>}
    {outcome?.phase === "uncertain" && <p role="alert">Review Main Logging and check the original action. Its outcome is uncertain.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
