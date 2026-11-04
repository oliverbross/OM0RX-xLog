import { loadStationSession, stationSessionRequest, type RadioID, type StationReceipt, type StationSession } from "./stationSession";
import type { StationProvider } from "../worker";
import type { MonitorContext } from "./monitorContext";

type TuneResult = { accepted: boolean; confirmed: boolean; superseded?: boolean };
type State = { pending: string | null; busy: boolean; message: string; reviewable: boolean };
type Transport = { snapshot: () => Promise<StationSession>; request: (params: Record<string, unknown>) => Promise<StationReceipt | null> };
export type ManualTuneSource = { frequencyHz: number; mode: string };
export type ManualTuneBinding={radioID:RadioID;activeRadio:RadioID;slotGeneration:string;slotRevision:number;provider:StationProvider;
  selectionID:string;selectionGeneration:number;controlRevision:number;workerGeneration:number;connectionGeneration:number};
/** Native identity only; no credentials or mutable station configuration enter the action journal. */
export function captureManualTuneBinding(base:StationSession):ManualTuneBinding{
  const selection=base.selection,radio=base.radio,provider=selection?.provider as StationProvider;
  if(!["radio1","radio2"].includes(base.radio_id)||base.active_radio!==base.radio_id||!base.generation||!Number.isSafeInteger(base.revision)||
    !["direct_agent","direct_flex_lan","direct_tci","hamlib"].includes(provider)||!selection.selection_id||radio?.provider!==provider||
    radio.selection_id!==selection.selection_id||radio.selection_generation!==selection.generation||
    ![selection.generation,selection.control_revision,radio.snapshot?.generation].every(value=>Number.isSafeInteger(value)&&Number(value)>=0)||
    provider!=="hamlib"&&(!Number.isSafeInteger(base.worker_generation)||!base.worker_generation))throw Error("Refresh the exact observed radio binding before preparing a directed pass tune.");
  return{radioID:base.radio_id,activeRadio:base.active_radio,slotGeneration:base.generation,slotRevision:base.revision,provider,
    selectionID:selection.selection_id,selectionGeneration:selection.generation,controlRevision:selection.control_revision!,
    workerGeneration:provider==="hamlib"?0:base.worker_generation!,connectionGeneration:radio.snapshot.generation};
}
export function assertManualTuneBinding(base:StationSession,expected:ManualTuneBinding){
  const current=captureManualTuneBinding(base);
  if(Object.keys(expected).some(key=>expected[key as keyof ManualTuneBinding]!==current[key as keyof ManualTuneBinding]))
    throw Error("The original directed pass radio binding or generation changed; no replacement radio was tuned.");
}
const native = (radioId: RadioID): Transport => ({ snapshot: () => loadStationSession(radioId), request: params => stationSessionRequest(radioId, params) });
const storage = (radioId: RadioID) => { const key = `xlog.station-session.${radioId}.manual-tune.pending`; return {
  read: () => { try { return sessionStorage.getItem(key); } catch { return "unverified"; } },
  write: (id: string | null) => { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); },
}; };
export const manualTuneJournal = storage;

/** One renderer intent journal; durable admission and deduplication are native. */
export class ManualTuneSession {
  private state: State;
  private activeTarget: { provider: StationProvider; frequencyHz: number; mode: string } | null = null;
  private queued: { provider: StationProvider; frequencyHz: number; mode: string;
    resolve: (result: TuneResult) => void; reject: (reason: unknown) => void } | null = null;
  private listeners = new Set<() => void>();
  constructor(private transport: Transport, private journal: {read:()=>string|null;write:(id:string|null)=>void}) {
    this.state = { pending: journal.read(), busy: false, message: "", reviewable: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  async tune(provider: StationProvider, frequencyHz: number, mode: string, context?: MonitorContext | null, source?: ManualTuneSource, expectedBinding?:ManualTuneBinding): Promise<TuneResult> {
    if(expectedBinding)expectedBinding=structuredClone(expectedBinding);
    if (this.state.busy && this.activeTarget && !context && !source && !expectedBinding && provider === this.activeTarget.provider &&
        (this.queued !== null || frequencyHz !== this.activeTarget.frequencyHz || mode !== this.activeTarget.mode) &&
        Number.isSafeInteger(frequencyHz) && frequencyHz >= 100_000 && frequencyHz <= 1_000_000_000 && /^[A-Z0-9]{1,16}$/.test(mode)) {
      // Keep only the newest explicit absolute target. Relative steps retain
      // their exact observed-source fence and must never be queued this way.
      this.queued?.resolve({ accepted: false, confirmed: false, superseded: true });
      return new Promise((resolve, reject) => { this.queued = { provider, frequencyHz, mode, resolve, reject }; });
    }
    if (this.state.busy || this.state.pending) throw new Error("Check the existing manual tune receipt before another tune. No tune was repeated.");
    this.activeTarget = { provider, frequencyHz, mode };
    try { return await this.execute(provider, frequencyHz, mode, context, source,expectedBinding); }
    finally {
      this.activeTarget = null;
      const queued = this.queued; this.queued = null;
      if (queued) {
        if (this.state.pending) queued.reject(new Error("Previous tune is unresolved. The queued QSY was not sent; check its receipt."));
        else void this.tune(queued.provider, queued.frequencyHz, queued.mode).then(queued.resolve, queued.reject);
      }
    }
  }
  private async execute(provider: StationProvider, frequencyHz: number, mode: string, context?: MonitorContext | null, source?: ManualTuneSource,expectedBinding?:ManualTuneBinding): Promise<TuneResult> {
    if (this.state.busy || this.state.pending) throw new Error("Check the existing manual tune receipt before another tune. No tune was repeated.");
    if (!Number.isSafeInteger(frequencyHz) || frequencyHz < 100_000 || frequencyHz > 1_000_000_000 || !/^[A-Z0-9]{1,16}$/.test(mode) || source &&
        (!Number.isSafeInteger(source.frequencyHz) || source.frequencyHz < 100_000 || source.frequencyHz > 1_000_000_000 || !/^[A-Z0-9]{1,16}$/.test(source.mode)))
      throw new Error("Enter a valid simplex frequency and mode.");
    this.update({ busy: true, message: "" });
    try {
      const base = await this.transport.snapshot();
      if(expectedBinding){assertManualTuneBinding(base,expectedBinding);if(expectedBinding.provider!==provider)throw Error("The directed pass tune provider changed.");}
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
      const receipt = await this.transport.request({ action: "manual_tune", operation_id: operation, generation: expectedBinding?.slotGeneration??base.generation, revision: expectedBinding?.slotRevision??base.revision,
        provider, selection_generation: selection.generation, selection_id: selection.selection_id, control_revision: selection.control_revision,
        connection_generation: expectedBinding?.connectionGeneration??radio.snapshot.generation, worker_generation: expectedBinding?.workerGeneration??(provider === "hamlib" ? 0 : base.worker_generation), frequency_hz: frequencyHz, mode,
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
