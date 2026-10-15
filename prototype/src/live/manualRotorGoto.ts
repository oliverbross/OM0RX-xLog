import { invoke } from "@tauri-apps/api/core";
import type { RotorOwner, RotorSnapshot } from "./rotorControl";
import type { StationReceipt } from "./stationSession";

const key = "xlog.station-session.manual-rotor-goto.pending";
type NativeSnapshot = { generation: string; revision: number; last_receipt: StationReceipt | null; worker_generation: number;
  rotor: { available: boolean; revision: number; received_at_ms?: number; snapshot: RotorSnapshot | null } };
type State = { pending: string | null; busy: boolean; message: string; reviewable: boolean };
type Transport = { snapshot: () => Promise<NativeSnapshot>; request: (params: Record<string, unknown>) => Promise<StationReceipt | null> };
const request = <T,>(params: Record<string, unknown>) => invoke<T>("manual_rotor_request", { params });
const native: Transport = { snapshot: () => request<NativeSnapshot>({ action: "snapshot" }), request };
const storage = { read: () => { try { return sessionStorage.getItem(key); } catch { return "unverified"; } },
  write: (id: string | null) => { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } };

export class ManualRotorGotoSession {
  private state: State;
  private listeners = new Set<() => void>();
  constructor(private transport: Transport = native, private journal: {read:()=>string|null;write:(id:string|null)=>void} = storage) {
    this.state = { pending: journal.read(), busy: false, message: "", reviewable: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  async goto(owner: RotorOwner, observedGeneration: number, bearing: number, label = "Manual bearing") {
    if (this.state.busy || this.state.pending) throw new Error("Check the existing manual rotor receipt before another turn. No turn was repeated.");
    if (!Number.isSafeInteger(observedGeneration) || observedGeneration < 0 || !Number.isFinite(bearing) || bearing < 0 || bearing > 360 ||
        label.length > 64 || !/^[\x20-\x7e]*$/.test(label)) throw new Error("Use a current rotor observation, bearing from 0° to 360° and a short target label.");
    this.update({ busy: true, message: "" });
    try {
      const base = await this.transport.snapshot();
      if (base.last_receipt?.request.action === "manual_rotor_goto" && ["pending", "unknown"].includes(base.last_receipt.status)) {
        this.journal.write(base.last_receipt.operation_id); this.update({ pending: base.last_receipt.operation_id });
        throw new Error("The previous manual rotor outcome is unknown. Check its receipt and observed bearing.");
      }
      const retained = base.rotor;
      if (!retained?.available || retained.snapshot?.owner !== owner || retained.snapshot.generation !== observedGeneration ||
          retained.snapshot.state !== "active" || retained.snapshot.backend_available === false || !Number.isSafeInteger(retained.revision) ||
          typeof retained.received_at_ms !== "number" || Date.now() - retained.received_at_ms < -1000 || Date.now() - retained.received_at_ms > 5000 ||
          owner === "native_dcu1" && (!Number.isSafeInteger(base.worker_generation) || !base.worker_generation))
        throw new Error("Refresh the connected rotor observation before manual Goto.");
      const operation = crypto.randomUUID();
      this.journal.write(operation); this.update({ pending: operation });
      const receipt = await this.transport.request({ action: "manual_rotor_goto", operation_id: operation, generation: base.generation, revision: base.revision,
        rotor_owner: owner, rotor_generation: observedGeneration, rotor_revision: retained.revision,
        worker_generation: owner === "hamlib" ? 0 : base.worker_generation, bearing, label });
      if (!receipt || receipt.operation_id !== operation || receipt.request.action !== "manual_rotor_goto")
        throw new Error("Manual rotor receipt could not be verified. Check its retained operation.");
      if (receipt.status !== "acknowledged") {
        this.update({ reviewable: receipt.status === "unknown" });
        throw new Error("Manual rotor outcome is unknown. Check its receipt and observed bearing; no turn will be replayed.");
      }
      this.journal.write(null); this.update({ pending: null, reviewable: false, message: "Rotor Goto acknowledged; watch the observed bearing." });
      return { accepted: true, acknowledged: true };
    } finally { this.update({ busy: false }); }
  }
  async check() {
    const operation = this.state.pending; if (!operation || this.state.busy) return;
    this.update({ busy: true });
    try {
      const receipt = await this.transport.request({ action: "receipt", operation_id: operation });
      if (receipt && (receipt.operation_id !== operation || receipt.request.action !== "manual_rotor_goto"))
        throw new Error("Manual rotor receipt does not match its retained operation.");
      if (!receipt || receipt.status === "acknowledged" || receipt.status === "reviewed") {
        this.journal.write(null); this.update({ pending: null, reviewable: false,
          message: receipt?.status === "reviewed" ? "Recovered durable review of the unknown rotor Goto. No turn was repeated."
            : receipt ? "Recovered acknowledged rotor Goto. No turn was repeated." : "No rotor Goto was admitted under this identity. No turn was repeated." });
      } else this.update({ reviewable: receipt.status === "unknown", message: "Manual rotor outcome remains unknown. Review observed bearing; no turn was repeated." });
    } finally { this.update({ busy: false }); }
  }
  async review() {
    const operation = this.state.pending; if (!operation || this.state.busy || !this.state.reviewable) return;
    this.update({ busy: true });
    try {
      const receipt = await this.transport.request({ action:"review", operation_id:operation, reviewed_action:"manual_rotor_goto" });
      if (!receipt || receipt.operation_id !== operation || receipt.request.action !== "manual_rotor_goto" || receipt.status !== "reviewed")
        throw new Error("Manual rotor review acknowledgement could not be verified.");
      this.journal.write(null); this.update({ pending:null, reviewable:false,
        message:"Previous turn remains unknown and was durably reviewed. A new turn requires a new explicit request." });
    } finally { this.update({ busy:false }); }
  }
}

let shared: ManualRotorGotoSession | undefined;
export const manualRotorGotoSession = () => shared ??= new ManualRotorGotoSession();
