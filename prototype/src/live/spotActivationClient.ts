import { validSpotActivationSnapshot, type SpotActivationSnapshot } from "./spotActivation";
import { validSpotOperation } from "./spotActivationBarrier";
type Call = (command: string, params?: Record<string, unknown>) => Promise<any>;
type State = { status: SpotActivationSnapshot | null; error: string; requesting: boolean; checked: boolean };
const terminal = (status: SpotActivationSnapshot | null) => !!status && ["blocked", "confirmed", "failed", "uncertain"].includes(status.phase);
export function activationMessage(status: SpotActivationSnapshot | null): string {
  if (!status || status.phase === "idle") return "";
  if (status.phase === "preparing") return "Checking shared editors before loading this spot…";
  if (status.phase === "draft_applied") return "Spot loaded. Waiting for native radio admission…";
  if (status.phase === "tuning") return "Spot loaded. Waiting for observed radio confirmation…";
  if (status.phase === "confirmed") return `${status.tuneConfirmed ? "Spot loaded · observed radio tune confirmed." : "Spot loaded; radio tune is not confirmed."}${status.error ? ` ${status.error}` : ""}${status.rotor && status.rotor !== "not_requested" ? ` Rotor: ${status.rotor.replaceAll("_", " ")}.` : ""}`;
  if (status.phase === "uncertain") return "Spot activation outcome is uncertain. Check the existing operation; no tune will be replayed.";
  return status.error || (status.phase === "blocked" ? "Spot activation was blocked. Finish the shared editor operation first." : "Spot activation failed. Check its status before selecting another report.");
}
/** Holds the exact operation identity after lost IPC. Only an explicit user
 * click creates a UUID; neither polling nor reconciliation invokes activation. */
export class SpotActivationClient {
  private state: State = { status: null, error: "", requesting: false, checked: false };
  private listeners = new Set<() => void>();
  private operation: string | null = null;
  private active = true;
  private version = 0;
  private reading: Promise<void> | null = null;
  constructor(private call: Call, private uuid: () => string = () => crypto.randomUUID()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { if (this.active) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); } }
  private resolved() { const status = this.state.status; return !!status && status.phase !== "idle" && terminal(status) && status.reservationActive !== true &&
    (status.phase !== "uncertain" || this.state.checked); }
  private accept(value: unknown, expected?: string) {
    if (!validSpotActivationSnapshot(value) || expected && value.operationId !== expected) throw new Error("The activation status could not be correlated. Check the existing operation before selecting another report.");
    const previous = this.state.status;
    if (previous?.operationId === value.operationId && terminal(previous) && (!terminal(value) ||
      previous.phase !== "idle" && value.phase !== "idle" && previous.reservationActive === false && value.reservationActive === true)) return;
    if (value.phase === "idle" && this.operation && !this.resolved()) return;
    const changedOperation = value.operationId !== this.operation;
    this.operation = value.operationId;
    this.update({ status: value, error: "", ...(changedOperation ? { checked: false } : {}) });
  }
  async activate(spot: Record<string, any>) {
    if (!this.active || this.state.requesting || this.operation && !this.resolved()) throw new Error("Check the existing spot activation before selecting another report.");
    if (!validSpotOperation(spot.activation?.sourceEpoch) || !validSpotOperation(spot.activation?.spotVersion) ||
      typeof spot.id !== "string" || !spot.id || spot.id.length > 128 || spot.id.includes("\0"))
      throw new Error("Refresh the shared cluster before selecting this report. Its native activation identity is unavailable.");
    const operationId = this.uuid(); if (!validSpotOperation(operationId)) throw new Error("The activation operation identity could not be created.");
    this.operation = operationId; const version = ++this.version;
    this.update({ requesting: true, checked: false, status: null, error: "" });
    try {
      const result = await this.call("activate_spot", { operationId, sourceEpoch: spot.activation.sourceEpoch, spotId: spot.id, spotVersion: spot.activation.spotVersion });
      if (this.active && version === this.version && !(this.state.status?.operationId === operationId && terminal(this.state.status))) this.accept(result, operationId);
      return result;
    } catch (cause) {
      if (this.active && version === this.version) this.update({ error: "Activation acknowledgement unavailable. Check the existing operation; do not select it again to retry." });
      throw cause;
    } finally { if (version === this.version) this.update({ requesting: false }); }
  }
  refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.reading) return this.reading;
    const version = this.version, operationId = this.operation && !this.resolved() ? this.operation : null;
    this.reading = (async () => {
      try {
        const result = await this.call(operationId ? "spot_activation_status" : "spot_activation_snapshot", operationId ? { operationId } : {});
        if (this.active && version === this.version) this.accept(result, operationId ?? undefined);
      } catch (cause) { if (this.active && version === this.version) this.update({ error: cause instanceof Error ? cause.message : "Activation status is unavailable. No action was replayed." }); }
    })().finally(() => { this.reading = null; });
    return this.reading;
  }
  async reconcile() {
    if (!this.active || !this.operation || this.state.requesting) return;
    const operationId = this.operation, version = ++this.version;
    this.update({ requesting: true, checked: false });
    try {
      const result = await this.call("spot_activation_reconcile", { operationId });
      if (this.active && version === this.version) { this.accept(result, operationId); this.update({ checked: true }); }
    } catch (cause) { if (this.active && version === this.version) this.update({ error: cause instanceof Error ? cause.message : "The existing activation could not be reconciled. No tune was replayed." }); }
    finally { if (version === this.version) this.update({ requesting: false }); }
  }
  dispose() { this.active = false; this.version++; this.listeners.clear(); }
}
