import { validScopedSnapshot, type DraftSnapshot } from "./operatorDraftSession";
import { validSpotActivationBarrier, validSpotOperation, type SpotActivationBarrier, type SpotEditorReadiness } from "./spotActivationBarrier";

export type SpotActivationPhase = "preparing" | "draft_applied" | "tuning" | "blocked" | "confirmed" | "failed" | "uncertain";
export type SpotActivationSnapshot = { operationId: null; phase: "idle"; barrier: null } | {
  operationId: string; phase: SpotActivationPhase; barrier?: SpotActivationBarrier | null;
  admitted?: boolean; reservationActive?: boolean; error?: string; tuneConfirmed?: boolean; rotor?: string;
};
export type SpotEditorAck = SpotEditorReadiness & { operationId: string; barrierId: string };
export type SpotEditorParticipant = {
  setSpotEditorRegistered(registered: boolean): void;
  freezeSpotActivation(operationId: string): boolean;
  prepareSpotActivation(barrier: SpotActivationBarrier): SpotEditorReadiness;
  reconcileSpotActivation(operationId: string, current: DraftSnapshot): boolean;
};
const terminal = (phase: string) => ["blocked", "confirmed", "failed", "uncertain"].includes(phase);
export function validSpotActivationSnapshot(value: any): value is SpotActivationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.phase === "idle") return value.operationId === null && value.barrier === null;
  return validSpotOperation(value.operationId) && ["preparing", "draft_applied", "tuning", "blocked", "confirmed", "failed", "uncertain"].includes(value.phase) &&
    (value.admitted === undefined || typeof value.admitted === "boolean") &&
    (value.reservationActive === undefined || typeof value.reservationActive === "boolean") &&
    (value.barrier == null || validSpotActivationBarrier(value.barrier) && value.barrier.operationId === value.operationId) &&
    (value.error === undefined || typeof value.error === "string") &&
    (!terminal(value.phase) || typeof value.tuneConfirmed === "boolean" && typeof value.rotor === "string");
}

/** Pure editor-side protocol. Native registration/status/read transports are
 * injected by the mounting surface; no mutation, automatic retry or timer. */
export class SpotActivationEditor {
  private active = true;
  private registered = false;
  private operation: string | null = null;
  private completed = new Set<string>();
  private version = 0;
  constructor(private participants: readonly SpotEditorParticipant[], private readCanonical: () => Promise<unknown>,
    private localReadiness: () => SpotEditorReadiness = () => ({ ready: true })) {
    participants.forEach(participant => participant.setSpotEditorRegistered(false));
  }
  get frozen() { return !this.registered || this.operation !== null; }
  get operationId() { return this.operation; }
  /** Call only with the actual native registration reply, never a timer. */
  registeredWith(snapshot: unknown): Promise<SpotEditorAck | null> {
    if (!this.active) return Promise.resolve(null);
    if (!validSpotActivationSnapshot(snapshot)) {
      this.registered = false; this.participants.forEach(participant => participant.setSpotEditorRegistered(false));
      return Promise.reject(new Error("Editor registration state could not be verified."));
    }
    if (snapshot.operationId && !this.completed.has(snapshot.operationId)) this.freeze(snapshot.operationId);
    this.registered = true;
    this.participants.forEach(participant => participant.setSpotEditorRegistered(true));
    return this.observe(snapshot);
  }
  private freeze(operationId: string) {
    if (this.operation && this.operation !== operationId) throw new Error("The earlier spot activation outcome must be checked first.");
    this.operation = operationId;
    this.participants.forEach(participant => participant.freezeSpotActivation(operationId));
  }
  async observe(snapshot: unknown): Promise<SpotEditorAck | null> {
    if (!this.active) return null;
    if (!validSpotActivationSnapshot(snapshot)) {
      this.registered = false;
      this.participants.forEach(participant => participant.setSpotEditorRegistered(false));
      throw new Error("Spot activation state could not be verified. Editors remain protected.");
    }
    const version = ++this.version;
    if (snapshot.phase === "idle") return null; // Missing status cannot release an existing operation.
    if (this.completed.has(snapshot.operationId)) return null;
    this.freeze(snapshot.operationId); // Synchronous, before readiness or any await.
    if (snapshot.phase === "preparing") {
      if (!snapshot.barrier) return null;
      const results = [this.localReadiness(), ...this.participants.map(participant => participant.prepareSpotActivation(snapshot.barrier!))];
      const rejected = !this.registered ? { ready: false, reason: "Editor registration is not confirmed." } : results.find(result => !result.ready);
      return { operationId: snapshot.operationId, barrierId: snapshot.barrier!.barrierId, ready: !rejected,
        ...(rejected ? { reason: rejected.reason || "Finish the local editor operation first." } : {}) };
    }
    if (!terminal(snapshot.phase)) return null;
    if (snapshot.reservationActive === true) return null;
    // Outcome.draft may be historical. A separate current read is mandatory.
    const response: any = await this.readCanonical();
    if (!this.active || version !== this.version || this.operation !== snapshot.operationId) return null;
    if (!validScopedSnapshot(response?.draft)) throw new Error("The current shared draft could not be verified. Editors remain protected.");
    try {
      const released = this.participants.map(participant => participant.reconcileSpotActivation(snapshot.operationId, response.draft));
      if (released.some(result => !result)) throw new Error("Editor reconciliation is incomplete. Check the existing activation status.");
    } catch (cause) { this.freeze(snapshot.operationId); throw cause; }
    this.completed.add(snapshot.operationId);
    if (this.completed.size > 64) this.completed.delete(this.completed.values().next().value!);
    this.operation = null;
    return null;
  }
  dispose() {
    this.active = false; this.registered = false; this.version++;
    this.participants.forEach(participant => participant.setSpotEditorRegistered(false));
  }
}
