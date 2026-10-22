import { loadStationSession, stationSessionRequest, type RadioID, type StationReceipt, type StationSession } from "./stationSession";
import type { StationProvider } from "../worker";
import type { MonitorContext } from "./monitorContext";

type State = { pending: string | null; busy: boolean; message: string; reviewable: boolean };
type Transport = { snapshot: () => Promise<StationSession>; request: (params: Record<string, unknown>) => Promise<StationReceipt | null> };
export type ManualTuneSource = { frequencyHz: number; mode: string };
const native = (radioId: RadioID): Transport => ({ snapshot: () => loadStationSession(radioId), request: params => stationSessionRequest(radioId, params) });
const storage = (radioId: RadioID) => { const key = `xlog.station-session.${radioId}.manual-tune.pending`; return {
  read: () => { try { return sessionStorage.getItem(key); } catch { return "unverified"; } },
  write: (id: string | null) => { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); },
}; };

/** One renderer intent journal; durable admission and deduplication are native. */
export class ManualTuneSession {
  private state: State;
  private listeners = new Set<() => void>();
  constructor(private transport: Transport, private journal: {read:()=>string|null;write:(id:string|null)=>void}) {
    this.state = { pending: journal.read(), busy: false, message: "", reviewable: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  async tune(provider: StationProvider, frequencyHz: number, mode: string, context?: MonitorContext | null, source?: ManualTuneSource) {
    if (this.state.busy || this.state.pending) throw new Error("Check the existing manual tune receipt before another tune. No tune was repeated.");
    if (!Number.isSafeInteger(frequencyHz) || frequencyHz < 100_000 || frequencyHz > 1_000_000_000 || !/^[A-Z0-9]{1,16}$/.test(mode) || source &&
        (!Number.isSafeInteger(source.frequencyHz) || source.frequencyHz < 100_000 || source.frequencyHz > 1_000_000_000 || !/^[A-Z0-9]{1,16}$/.test(source.mode)))
      throw new Error("Enter a valid simplex frequency and mode.");
    this.update({ busy: true, message: "" });
    try {
      const base = await this.transport.snapshot();
      const unresolved = base.manual_tune_receipt ?? (base.last_receipt?.request.action === "manual_tune" ? base.last_receipt : null);
      if (unresolved && ["pending", "unknown"].includes(unresolved.status)) {
        this.journal.write(unresolved.operation_id); this.update({ pending: unresolved.operation_id });
        throw new Error("The previous manual tune outcome is unknown. Check its receipt and observed radio state.");
      }
      const selection = context?.selection ?? base.selection, radio = context?.radio ?? base.radio;
      if (context?.acceptance || selection?.provider !== provider || !selection.selection_id || radio?.provider !== provider ||
          radio.selection_id !== selection.selection_id || radio.selection_generation !== selection.generation || !Number.isSafeInteger(selection.control_revision) ||
          !Number.isSafeInteger(radio.snapshot?.generation) || provider !== "hamlib" && (!Number.isSafeInteger(base.worker_generation) || !base.worker_generation))
        throw new Error("Refresh the selected radio before manual tuning.");
      const operation = crypto.randomUUID();
      this.journal.write(operation); this.update({ pending: operation });
      const receipt = await this.transport.request({ action: "manual_tune", operation_id: operation, generation: base.generation, revision: base.revision,
        provider, selection_generation: selection.generation, selection_id: selection.selection_id, control_revision: selection.control_revision,
        connection_generation: radio.snapshot.generation, worker_generation: provider === "hamlib" ? 0 : base.worker_generation, frequency_hz: frequencyHz, mode,
        ...(source ? { expected_source_frequency_hz: source.frequencyHz, expected_source_mode: source.mode } : {}) });
      if (!receipt || receipt.operation_id !== operation || receipt.request.action !== "manual_tune") throw new Error("Manual tune receipt could not be verified. Check its retained operation.");
      if (receipt.status !== "confirmed") { this.update({reviewable:receipt.status==="unknown"}); throw new Error("Manual tune outcome is unknown. Check its receipt; no tune will be replayed."); }
      this.journal.write(null); this.update({ pending: null, reviewable:false, message: "Simplex tune confirmed by authoritative radio readback." });
      return { accepted: true, confirmed: true };
    } finally { this.update({ busy: false }); }
  }
  async check() {
    const operation = this.state.pending; if (!operation || this.state.busy) return;
    this.update({ busy: true });
    try {
      const receipt = await this.transport.request({ action: "receipt", operation_id: operation });
      if (receipt && (receipt.operation_id !== operation || receipt.request.action !== "manual_tune")) throw new Error("Manual tune receipt does not match its retained operation.");
      if (!receipt || receipt.status === "confirmed" || receipt.status === "reviewed") {
        this.journal.write(null); this.update({ pending: null, reviewable:false, message: receipt?.status === "reviewed" ? "Recovered durable review of the unknown tune. No tune was repeated."
          : receipt ? "Recovered confirmed manual tune receipt. No tune was repeated." : "No manual tune was admitted under this identity. No tune was repeated." });
      } else this.update({ reviewable:receipt.status==="unknown", message: "Manual tune outcome remains unknown. Review observed radio state; no tune was repeated." });
    } finally { this.update({ busy: false }); }
  }
  async review() {
    const operation = this.state.pending; if (!operation || this.state.busy || !this.state.reviewable) return;
    this.update({ busy: true });
    try {
      const receipt = await this.transport.request({ action:"review", operation_id:operation, reviewed_action:"manual_tune" });
      if (!receipt || receipt.operation_id !== operation || receipt.request.action !== "manual_tune" || receipt.status !== "reviewed")
        throw new Error("Manual tune review acknowledgement could not be verified.");
      this.journal.write(null); this.update({pending:null,reviewable:false,message:"Previous tune remains unknown and was durably reviewed. A new tune requires a new explicit request."});
    } finally { this.update({ busy:false }); }
  }
}
const shared = new Map<RadioID, ManualTuneSession>();
export const manualTuneSession = (radioId: RadioID) => {
  const existing = shared.get(radioId);
  if (existing) return existing;
  const session = new ManualTuneSession(native(radioId), storage(radioId)); shared.set(radioId, session); return session;
};
