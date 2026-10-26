import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cwRadioName, type CWDecodeSnapshot, type CWDecodeTrack } from "./cwDecode";

export type CWTuneRequest = (params: Record<string, unknown>) => Promise<unknown>;
const native: CWTuneRequest = params => invoke("cw_tune_request", { params });
const key = "xlog.cw.pending-tune";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) && value !== "00000000-0000-0000-0000-000000000000";
type Pending = { operationId: string; radioID: "radio1" | "radio2" };
type Outcome = { operationId: string; radioID?: string; status: "pending" | "unknown" | "confirmed" | "reviewed" | "rejected" | "not_admitted" | "missing" };
function retained(): Pending | "unverified" | null {
  try {
    const raw = sessionStorage.getItem(key); if (raw === null) return null;
    const value = JSON.parse(raw);
    return value && Object.keys(value).length === 2 && uuid(value.operationId) && ["radio1", "radio2"].includes(value.radioID) ? value : "unverified";
  } catch { return "unverified"; }
}
export function parseCWTuneOutcome(value: any, pending: Pending): Outcome {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.operationId !== pending.operationId ||
    !["pending", "unknown", "confirmed", "reviewed", "rejected", "not_admitted", "missing"].includes(value.status) ||
    Object.keys(value).some(field => !["operationId", "radioID", "status"].includes(field)) ||
    (value.status === "not_admitted" && value.radioID === undefined ? false : value.radioID !== pending.radioID))
    throw new Error("The tune outcome could not be verified. Check the original tune before trying again.");
  return value;
}
/** Mount, selection and status reads never tune. Only an explicit click creates
 * an intent; its durable station receipt owns the one possible RF dispatch. */
export function CWTuneAction({ signal, snapshot, request = native }: {
  signal?: CWDecodeTrack; snapshot: CWDecodeSnapshot; request?: CWTuneRequest;
}) {
  const operation = useRef(retained()), inFlight = useRef(false);
  const [pending, setPending] = useState(operation.current), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const eligible = snapshot.featureEnabled === true && snapshot.state === "running" && uuid(snapshot.operatingContext) &&
    ["normal_logging", "contesting"].includes(snapshot.operatingModule ?? "") && signal?.controlActivation && signal.frequencyHz !== undefined &&
    signal.descriptor.mappingQualified && !signal.descriptor.replay && !signal.muted && !signal.ambiguous && snapshot.activeRadioID === signal.descriptor.radioID;
  const run = async (check: boolean) => {
    if (inFlight.current || check && (!operation.current || operation.current === "unverified") || !check && (!eligible || operation.current)) return;
    const current: Pending = check ? operation.current as Pending : { operationId: crypto.randomUUID(), radioID: signal!.descriptor.radioID as Pending["radioID"] };
    try { sessionStorage.setItem(key, JSON.stringify(current)); }
    catch { setError("The tune identity could not be retained. Tuning is unavailable."); return; }
    operation.current = current; setPending(current); inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const params = check ? { action: "status", ...current } : { action: "apply", operationId: current.operationId,
        sourceEpoch: signal!.controlActivation!.sourceEpoch, spotId: signal!.trackID, spotVersion: signal!.controlActivation!.spotVersion,
        operatingModule: snapshot.operatingModule, operatingContext: snapshot.operatingContext };
      const outcome = parseCWTuneOutcome(await request(params), current);
      if (["confirmed", "reviewed", "rejected", "not_admitted"].includes(outcome.status)) {
        sessionStorage.removeItem(key); operation.current = null; setPending(null);
        setMessage(outcome.status === "confirmed" ? "CW tune confirmed by the radio. The logging entry is retained."
          : outcome.status === "reviewed" ? "The original tune was reviewed in Station Control. No tune was repeated."
          : "Tuning was not admitted. Read current signal and radio state before selecting again.");
      } else setMessage("The original tune remains unverified. Review its receipt and observed radio state in Station Control. No tune was repeated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tune outcome is unknown. Check the original tune."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const label = signal?.frequencyHz === undefined ? "Tune selected signal" : `Tune ${cwRadioName(signal.descriptor.radioID)} to ${(signal.frequencyHz / 1e6).toFixed(6)} MHz CW`;
  return <div className="cw-decode-callsign" aria-label="CW signal tuning">
    <div className="cw-decode-actions"><button type="button" disabled={!eligible || busy || !!pending} onClick={() => void run(false)}>{label}</button>
      {pending && <button type="button" disabled={busy || pending === "unverified"} onClick={() => void run(true)}>Check original tune</button>}</div>
    {signal && snapshot.activeRadioID !== signal.descriptor.radioID && <p>Select {cwRadioName(signal.descriptor.radioID)} in Radio Settings before tuning this signal.</p>}
    {pending && <p role="status">A retained tune needs a verified outcome before another CW tune.</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
