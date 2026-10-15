import { invoke } from "@tauri-apps/api/core";
import type { MonitorContext } from "./monitorContext";

export type ReleaseTarget = { provider: "direct_agent" | "direct_flex_lan"; selection_generation: number; selection_id: string; worker_generation: number; connection_generation: number };
export type ReleaseReceipt = { operation_id: string; target: ReleaseTarget; status: "pending" | "unknown" | "acknowledged" | "confirmed" | "reviewed" };
type Snapshot = { target: ReleaseTarget | null; receipts: ReleaseReceipt[] };
type Request = <T>(params: Record<string, unknown>) => Promise<T>;
type State = { operations: ReleaseReceipt[]; pending: string[]; message: string; feedback: string | null };
const key = "xlog.radio-release.pending";
const native: Request = params => invoke("radio_release_request", { params });
const storage = {
  read: (): string[] => { try { return JSON.parse(sessionStorage.getItem(key) || "[]"); } catch { return []; } },
  write: (ids: string[]) => { sessionStorage.setItem(key, JSON.stringify(ids.slice(-256))); },
};
const terminal = (status: ReleaseReceipt["status"]) => ["acknowledged", "confirmed", "reviewed"].includes(status);
const validTarget = (target: ReleaseTarget | null): target is ReleaseTarget => !!target && ["direct_agent", "direct_flex_lan"].includes(target.provider)
  && typeof target.selection_id === "string" && /^[0-9a-f-]{36}$/i.test(target.selection_id)
  && [target.selection_generation, target.worker_generation, target.connection_generation].every(v => Number.isSafeInteger(v) && v >= 0) && target.worker_generation > 0;
const validReceipt = (receipt: ReleaseReceipt | null, id: string): receipt is ReleaseReceipt => !!receipt && receipt.operation_id === id && validTarget(receipt.target)
  && ["pending", "unknown", "acknowledged", "confirmed", "reviewed"].includes(receipt.status);
const sameTarget = (a: ReleaseTarget, b: ReleaseTarget) => (["provider", "selection_generation", "selection_id", "worker_generation", "connection_generation"] as const).every(key => a[key] === b[key]);

/** Receipt recovery never repeats transport. Each click is a fresh explicit release. */
export class RadioReleaseSession {
  private state: State;
  private listeners = new Set<() => void>();
  private intent = 0;
  private inFlight = new Set<string>();
  constructor(private request: Request = native, private journal = storage) {
    const retained = journal.read();
    this.state = { operations: [], pending: Array.isArray(retained) ? retained.filter(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(-256) : [], message: "", feedback: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<State>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private retain(receipt: ReleaseReceipt) {
    const existing = this.state.operations.find(r => r.operation_id === receipt.operation_id);
    if (existing && terminal(existing.status) && !terminal(receipt.status)) return;
    const pending = terminal(receipt.status) ? this.state.pending.filter(id => id !== receipt.operation_id)
      : [...new Set([...this.state.pending, receipt.operation_id])];
    this.journal.write(pending);
    this.update({ pending, operations: [...this.state.operations.filter(r => r.operation_id !== receipt.operation_id), receipt] });
  }
  async refresh() {
    // Only look up retained intents. Never interpret a missing receipt while
    // this renderer's original request is still approaching native admission.
    const retained = this.state.pending.filter(id => !this.inFlight.has(id)).slice(-256);
    const snapshot = await this.request<Snapshot>({ action: "snapshot" });
    for (const receipt of snapshot.receipts ?? []) {
      if (!validReceipt(receipt, receipt.operation_id)) throw new Error("Radio Cancel receipt could not be verified.");
      this.retain(receipt);
    }
    const results = await Promise.allSettled(retained.map(id => this.check(id)));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async cancel(provider: ReleaseTarget["provider"], context?: MonitorContext | null) {
    const intent = ++this.intent;
    // A new explicit intent owns subsequent feedback even if preparation fails
    // before it receives an operation identity.
    this.update({ feedback: null });
    try { return await this.cancelIntent(provider, context, intent); }
    catch (cause) {
      if (this.intent === intent) this.update({ message: cause instanceof Error ? cause.message : "Radio Cancel receipt unavailable; check observed state." });
      throw cause;
    }
  }
  private async cancelIntent(provider: ReleaseTarget["provider"], context: MonitorContext | null | undefined, intent: number) {
    const base = await this.request<Snapshot>({ action: "snapshot" });
    const target = base.target;
    if (!validTarget(target) || target.provider !== provider || context?.acceptance) throw new Error("Refresh the selected radio connection before requesting Cancel.");
    if (context) {
      if (context.selection?.provider !== provider || context.selection.selection_id !== target.selection_id || context.selection.generation !== target.selection_generation)
        throw new Error("Selected radio changed. Refresh before requesting Cancel.");
    }
    if (this.intent !== intent) throw new Error("A newer explicit Cancel superseded this preparation. No older Cancel was sent.");
    const id = crypto.randomUUID();
    this.journal.write([...new Set([...this.state.pending, id])]);
    this.inFlight.add(id);
    this.update({ pending: [...new Set([...this.state.pending, id])], ...(this.intent === intent ? { feedback: id, message: "Cancel requested; awaiting its durable receipt." } : {}) });
    try {
      const receipt = await this.request<ReleaseReceipt>({ action: "cancel", operation_id: id, target });
      if (!validReceipt(receipt, id) || !sameTarget(receipt.target, target)) throw new Error("Radio Cancel receipt could not be verified.");
      this.retain(receipt);
      if (this.state.feedback === id) this.update({ message: receipt.status === "confirmed" ? "Cancel confirmed by fresh radio readback."
        : receipt.status === "acknowledged" ? "Cancel acknowledged by the Agent; release remains unconfirmed. Watch observed state."
        : "Cancel outcome is unknown. Check its receipt and observed radio state; no Cancel will be replayed." });
      if (!terminal(receipt.status)) throw new Error("Cancel outcome is unknown. Check its receipt and observed radio state; no Cancel will be replayed.");
      return { accepted: true, confirmed: receipt.status === "confirmed" };
    } catch (cause) {
      if (this.state.feedback === id) this.update({ message: "Cancel outcome is unknown. Check its receipt; no Cancel will be replayed." });
      throw cause;
    } finally { this.inFlight.delete(id); }
  }
  async check(id: string) {
    if (this.inFlight.has(id)) throw new Error("Radio Cancel is still being admitted. Wait for its retained receipt; no Cancel was repeated.");
    const receipt = await this.request<ReleaseReceipt | null>({ action: "receipt", operation_id: id });
    if (receipt && !validReceipt(receipt, id)) throw new Error("Radio Cancel receipt does not match its retained operation.");
    if (receipt) this.retain(receipt);
    else { const pending = this.state.pending.filter(value => value !== id); this.journal.write(pending); this.update({ pending }); }
    if (this.state.feedback === id) this.update({ message: receipt ? `Cancel receipt: ${receipt.status}. No Cancel was repeated.` : "No Cancel was admitted under this identity. No Cancel was repeated." });
  }
  async review(id: string) {
    const receipt = await this.request<ReleaseReceipt>({ action: "review", operation_id: id });
    if (!validReceipt(receipt, id) || receipt.status !== "reviewed") throw new Error("Radio Cancel review could not be verified.");
    this.retain(receipt);
    if (this.state.feedback === id) this.update({ message: "Unknown Cancel was durably reviewed. Its radio outcome remains unknown. No Cancel was repeated." });
  }
}
let shared: RadioReleaseSession | undefined;
export const radioReleaseSession = () => shared ??= new RadioReleaseSession();
