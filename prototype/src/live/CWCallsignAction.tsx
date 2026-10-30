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
  const [checkedOriginal, setCheckedOriginal] = useState(false);
  const [originals, setOriginals] = useState<{ operationId: string; target: string }[]>([]);
  const target = snapshot.operatingModule === "normal_logging" ? "Normal Logging" : snapshot.operatingModule === "contesting" ? "Contest Entry" : null;
  const entryTarget=snapshot.operatingModule === "contesting" ? snapshot.callsignEntryTarget : undefined;
  const eligible = snapshot.featureEnabled === true && snapshot.state === "running" && ["normal_logging", "contesting"].includes(snapshot.operatingModule ?? "") &&
    uuid(snapshot.operatingContext) && !!signal?.selection?.activation && !signal.ambiguous &&
    (snapshot.operatingModule !== "contesting" || entryTarget !== undefined);
  const retainOriginal = (id: string) => {
    const prior = sessionStorage.getItem(key);
    if (prior !== null && !uuid(prior)) {
      const backup = `${key}.unreadable`, saved = sessionStorage.getItem(backup);
      if (saved !== null && saved !== prior) throw new Error("The unreadable identity backup is occupied. Preserve it and review Main Logging.");
      sessionStorage.setItem(backup, prior);
    }
    sessionStorage.setItem(key, id); operation.current = id; setPending(id); setOriginals([]);
  };
  const findOriginal = async () => {
    if (inFlight.current || uuid(operation.current)) return;
    inFlight.current = true; setBusy(true); setError(""); setOutcome(null); setOriginals([]);
    try {
      const value: any = await request({ action: "retained" });
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 ||
        !Array.isArray(value.operations) || value.operations.length > 65 || value.operations.some((row: any) =>
          !row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2 || !uuid(row.operationId) ||
          !["Normal Logging", "Contest Entry"].includes(row.target)) ||
        new Set(value.operations.map((row: any) => row.operationId.toLowerCase())).size !== value.operations.length)
        throw new Error("The original-action identities could not be verified. Review Main Logging.");
      if (value.operations.length === 1) retainOriginal(value.operations[0].operationId);
      else if (value.operations.length) setOriginals(value.operations);
      else setError("No unresolved CW action was found in the retained native evidence. Review Main Logging if an earlier outcome is unknown.");
    } catch (cause) {
      operation.current = "unverified"; setPending("unverified");
      setError(cause instanceof Error ? cause.message : "The original action could not be found. Review Main Logging.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const run = async (check: boolean) => {
    if (inFlight.current || (!check && (!eligible || operation.current)) || check && !uuid(operation.current)) return;
    const id = check ? operation.current! : crypto.randomUUID();
    try { sessionStorage.setItem(key, id); } catch { setError("The action identity could not be retained. Callsign loading is unavailable."); return; }
    operation.current = id; setPending(id); inFlight.current = true; setBusy(true); setError(""); setOutcome(null); setCheckedOriginal(check);
    try {
      const selection = signal?.selection;
      const params = check ? { action: "reconcile", operationId: id } : { action: "apply", operationId: id,
        sourceEpoch: selection!.activation!.sourceEpoch, spotId: selection!.reference.trackID, spotVersion: selection!.activation!.spotVersion,
        operatingModule:snapshot.operatingModule,operatingContext:snapshot.operatingContext,
        ...(entryTarget ? {entryTarget} : {}) };
      const next = parseCWCallsignOutcome(await request(params), id); setOutcome(next);
      if (["confirmed", "blocked", "failed"].includes(next.phase) && !next.reservationActive) {
        sessionStorage.removeItem(key); operation.current = null; setPending(null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Callsign loading could not be confirmed. Check the original action."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="cw-decode-callsign" aria-label="CW callsign loading">
    {target && <p>Target entry: <strong>{target}{entryTarget?.laneID ? ` · Lane ${entryTarget.laneID === "laneA" ? "A" : "B"}` : ""}</strong>.
      {entryTarget ? ` Draft ${entryTarget.draftID.slice(0,8)} · revision ${entryTarget.expectedDraftRevision}.` : ""} Frequency and mode are kept.</p>}
    {snapshot.operatingModule === "contesting" && !entryTarget && <p>Target Entry is unavailable. Open the intended lane in Contest Entry and finish the current draft or pending edits.</p>}
    <div className="cw-decode-actions"><button type="button" disabled={!eligible || busy || !!pending || originals.length > 0} onClick={() => void run(false)}
      title="Load the observed callsign into the active logging entry, preserving its frequency, mode and operator text.">Use callsign{signal?.selection ? ` ${signal.selection.callsign}` : ""}</button>
      {pending && <button type="button" disabled={busy || !uuid(pending)} onClick={() => void run(true)}>Check original action</button>}
      {(!pending || pending === "unverified") && snapshot.featureEnabled === true && <button type="button" disabled={busy}
        onClick={() => void findOriginal()} title="Read retained native operation identities after losing a window's saved ID. This does not apply a callsign.">Find original action</button>}</div>
    {originals.length > 1 && <div aria-label="Retained CW actions"><p>Choose the original action to check.</p>{originals.map(row =>
      <button type="button" key={row.operationId} disabled={busy} onClick={() => {
        try { retainOriginal(row.operationId); } catch (cause) { setError(cause instanceof Error ? cause.message : "The original identity could not be retained."); }
      }}>{row.target} · {row.operationId}</button>)}</div>}
    {!snapshot.operatingModule && <p>Callsign loading requires an active logging module.</p>}
    {pending && <p role="status">{busy ? "Checking callsign loading…" : "The previous action needs a verified outcome before another callsign can be loaded."}</p>}
    {pending === "unverified" && <p role="alert">The retained callsign identity cannot be read. Review Main Logging before further callsign loading.</p>}
    {outcome?.phase === "confirmed" && <p role="status">{checkedOriginal ? "Original callsign action confirmed. Review the current entry in Main Logging." : "Callsign loaded into the logging entry. Frequency and mode are retained."}</p>}
    {outcome && outcome.phase !== "confirmed" && !pending && <p role="status">{outcome.error || "Callsign loading was blocked. Review Main Logging before selecting again."}</p>}
    {outcome?.phase === "uncertain" && <p role="alert">Review Main Logging and check the original action. Its outcome is uncertain.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
