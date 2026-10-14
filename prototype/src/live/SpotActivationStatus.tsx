import { activationMessage } from "./spotActivationClient";
import type { SpotActivationSnapshot } from "./spotActivation";
export function SpotActivationStatus({ status, error, checking = false, reconcile, inline = false }: {
  status: SpotActivationSnapshot | null; error?: string; checking?: boolean; reconcile: () => void; inline?: boolean;
}) {
  const progress = status && ["preparing", "draft_applied", "tuning"].includes(status.phase);
  if (inline) return progress ? <span className="secondary" role="status">Activating selected report…</span> : null;
  if (progress) return error ? <div className="live-cluster-note live-actions" role="alert"><span>{error}</span><button type="button" disabled={checking} onClick={reconcile}>Check activation</button></div> : null;
  if (status?.phase === "confirmed" && !error && !status.error && status.reservationActive !== true && !/uncertain|failed|rejected|error/i.test(status.rotor || "")) return null;
  const text = error || (status?.phase !== "idle" && status?.reservationActive === true ? "Activation cleanup is unconfirmed. Check the existing operation; editors remain protected." : activationMessage(status));
  if (!text) return null;
  return <div className="live-cluster-note live-actions" role={error ? "alert" : "status"}><span>{text}</span>{(status?.operationId || error) &&
    <button type="button" disabled={checking} onClick={reconcile}>{checking ? "Checking…" : "Check activation"}</button>}</div>;
}
