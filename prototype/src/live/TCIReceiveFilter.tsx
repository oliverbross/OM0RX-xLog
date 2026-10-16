import { useState } from "react";
import { loadStationSession, stationSessionRequest, type StationReceipt, type StationSession } from "./stationSession";
type Data = Record<string, any>;
const key = "xlog.tci-filter.pending";
export function filterAdmission(snapshot: Data | null, now: number) {
  const recent = (t: unknown) => typeof t === "number" && Number.isFinite(t) && now - t * 1000 >= -1000 && now - t * 1000 <= 5000;
  return snapshot?.source === "direct_tci" && snapshot.available === true && snapshot.transport_state === "ready"
    && snapshot.station?.radio_stale !== true && snapshot.radio?.connected === true && snapshot.radio?.observed === true
    && snapshot.radio?.transmitting === false && recent(snapshot.generated_at) && recent(snapshot.radio.observed_at)
    && snapshot.capabilities?.supported_commands?.includes("station_receive_filter") === true && snapshot.tci?.filter_scope === "trx"
    && Number.isSafeInteger(snapshot.tci?.filter_lower_hz) && Number.isSafeInteger(snapshot.tci?.filter_upper_hz);
}
const readJournal = () => { try { return sessionStorage.getItem(key); } catch { return "unverified"; } };
export function TCIReceiveFilter({ snapshot, now, transport = { snapshot: loadStationSession, request: stationSessionRequest<StationReceipt | null> } }:
  { snapshot: Data | null; now: number; transport?: { snapshot: () => Promise<StationSession>; request: (p: Record<string, unknown>) => Promise<StationReceipt | null> } }) {
  const [lower, setLower] = useState(""), [upper, setUpper] = useState("");
  const [pending, setPending] = useState(readJournal), [busy, setBusy] = useState(false), [reviewable, setReviewable] = useState(false), [message, setMessage] = useState("");
  const edges = [lower, upper].map(v => /^-?\d{1,5}$/.test(v) ? Number(v) : NaN);
  const valid = edges.every(v => Number.isSafeInteger(v) && Math.abs(v) <= 24000) && edges[0] < edges[1];
  const remember = (id: string | null) => { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); setPending(id); };
  const inspect = async (review = false) => {
    if (busy || !pending) return;
    setBusy(true);
    try {
      const receipt = await transport.request(review ? { action: "review", operation_id: pending, reviewed_action: "tci_receive_filter" } : { action: "receipt", operation_id: pending });
      if (receipt && (receipt.operation_id !== pending || receipt.request.action !== "tci_receive_filter")) throw new Error("The filter receipt identity could not be verified.");
      if (review && receipt?.status !== "reviewed") throw new Error("The durable filter review could not be verified.");
      if (!receipt || ["confirmed", "reviewed"].includes(receipt.status)) { remember(null); setReviewable(false); setMessage("Filter receipt checked. No adjustment was repeated."); }
      else { setReviewable(receipt.status === "unknown"); setMessage("Filter outcome remains unknown. Review observed filter edges before another explicit adjustment."); }
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy || pending || !valid || !filterAdmission(snapshot, now)) return;
    setBusy(true); setMessage("");
    try {
      const base = await transport.snapshot(), radio = base.radio, selected = base.selection;
      const unresolved = base.tci_filter_receipt;
      if (unresolved && ["pending", "unknown"].includes(unresolved.status)) { remember(unresolved.operation_id); throw new Error("Check the existing filter receipt before another adjustment."); }
      if (selected.provider !== "direct_tci" || !selected.selection_id || radio?.provider !== "direct_tci" || radio.selection_id !== selected.selection_id
        || radio.selection_generation !== selected.generation || !Number.isSafeInteger(selected.control_revision)
        || radio.snapshot?.generation !== snapshot?.generation || radio.snapshot?.tci?.trx !== snapshot?.tci?.trx || radio.snapshot?.tci?.channel !== snapshot?.tci?.channel
        || !Number.isSafeInteger(base.worker_generation) || !base.worker_generation || !Number.isSafeInteger(radio.snapshot?.generation)
        || !filterAdmission(radio.snapshot, Date.now())) throw new Error("Refresh the selected TCI receiver before adjusting its filter.");
      const operation = crypto.randomUUID(); remember(operation);
      const receipt = await transport.request({ action: "tci_receive_filter", operation_id: operation, generation: base.generation, revision: base.revision,
        provider: "direct_tci", selection_generation: selected.generation, selection_id: selected.selection_id, control_revision: selected.control_revision,
        connection_generation: radio.snapshot.generation, worker_generation: base.worker_generation, lower_hz: edges[0], upper_hz: edges[1] });
      if (!receipt || receipt.operation_id !== operation || receipt.request.action !== "tci_receive_filter") throw new Error("Filter receipt could not be verified. Check its outcome.");
      if (receipt.status !== "confirmed") { setReviewable(receipt.status === "unknown"); throw new Error("Filter outcome unknown. Check its receipt; no adjustment will be replayed."); }
      remember(null); setMessage("Receive filter confirmed by authoritative TCI readback.");
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  return <fieldset disabled={busy}><legend>TCI receive filter</legend>
    <p>Shared by all channels on saved TRX {snapshot?.tci?.trx ?? "unavailable"}. App limit: −24000 to 24000 Hz.</p>
    <p>Reported edges: {snapshot?.tci?.filter_lower_hz ?? "unavailable"} to {snapshot?.tci?.filter_upper_hz ?? "unavailable"} Hz</p>
    <label>Lower edge (Hz)<input value={lower} onChange={e => setLower(e.target.value)} inputMode="numeric" /></label>
    <label>Upper edge (Hz)<input value={upper} onChange={e => setUpper(e.target.value)} inputMode="numeric" /></label>
    <button type="button" disabled={!!pending || !valid || !filterAdmission(snapshot, now)} onClick={() => void apply()}>Apply receive filter</button>
    {pending && <><button type="button" onClick={() => void inspect()}>Check filter receipt</button>{reviewable && <button type="button" onClick={() => void inspect(true)}>Acknowledge unknown filter outcome</button>}</>}
    {message && <p role="status">{message}</p>}
  </fieldset>;
}
