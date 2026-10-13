import { DraftRequestRejected, changedWorkspaceResponse, sameDraftValue, sameGeneration,
  validGeneration, validScopedSnapshot, type DraftSnapshot } from "./operatorDraftSession";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
export type LogbookMutation = { operationID: string; contactID: string; expectedRevision: number;
  generation: string; action: "delete" | "restore" };
export type LogbookMutationJournal = { pending: LogbookMutation | null; undo: DraftSnapshot | null };
export type LogbookMutationState = LogbookMutationJournal & { busy: boolean; error: string; workspaceChanged: boolean; conflict: boolean };
const clone = <T>(value: T): T => structuredClone(value);
const empty = (): LogbookMutationState => ({ pending: null, undo: null, busy: false, error: "", workspaceChanged: false, conflict: false });
function validMutation(value: any): value is LogbookMutation {
  return value && typeof value.operationID === "string" && !!value.operationID && typeof value.contactID === "string" && !!value.contactID &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && validGeneration(value.generation) &&
    ["delete", "restore"].includes(value.action) && value.qso === undefined;
}
export function readLogbookMutationJournal(text: string | null): LogbookMutationJournal | null {
  if (!text || text.length > 80_000) return null;
  try {
    const value = JSON.parse(text);
    return value && (value.pending === null || validMutation(value.pending)) &&
      (value.undo === null || validScopedSnapshot(value.undo) && !!value.undo.qso.deletedAt) ? value : null;
  } catch { return null; }
}

/** One table-operation owner per view. Never uses legacy ID-only Delete/Undo. */
export class LogbookMutationSession {
  private state: LogbookMutationState;
  private listeners = new Set<() => void>();
  private operation: Promise<DraftSnapshot | null> | null = null;
  constructor(private request: Request, private write: (journal: LogbookMutationJournal) => void,
    journal: LogbookMutationJournal | null = null, private uuid = () => crypto.randomUUID()) {
    this.state = { ...empty(), ...clone(journal), error: journal?.pending ? "Check the previous logbook operation before making another change." : "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<LogbookMutationState>) {
    this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener());
  }
  private persist(change: Partial<LogbookMutationState>) {
    const next = { ...this.state, ...change };
    this.write(clone({ pending: next.pending, undo: next.undo })); this.update(change);
  }
  private ensureReady() {
    if (this.state.busy || this.state.pending || this.state.workspaceChanged || this.state.conflict)
      throw new Error("Resolve the previous logbook operation first.");
  }
  async prepareDelete(id: string): Promise<DraftSnapshot> {
    this.ensureReady(); this.update({ busy: true });
    try {
      const response = await this.request("logbook_contact", { contactID: id });
      if (!validScopedSnapshot(response?.contact) || !sameGeneration(response.generation, response.contact.generation) ||
        response.contact.qso.id.toLowerCase() !== id.toLowerCase() || response.contact.qso.deletedAt)
        throw new Error("This contact is no longer available. Refresh the logbook.");
      return clone(response.contact);
    } finally { this.update({ busy: false }); }
  }
  delete(snapshot: DraftSnapshot) {
    this.ensureReady();
    if (!validScopedSnapshot(snapshot) || snapshot.qso.deletedAt) throw new Error("Confirm a current contact before deleting.");
    return this.perform({ operationID: this.uuid(), contactID: snapshot.qso.id, expectedRevision: snapshot.revision,
      generation: snapshot.generation!, action: "delete" });
  }
  undo() {
    this.ensureReady();
    const snapshot = this.state.undo;
    if (!snapshot || !validScopedSnapshot(snapshot) || !snapshot.qso.deletedAt) throw new Error("No verified deletion is available to undo.");
    return this.perform({ operationID: this.uuid(), contactID: snapshot.qso.id, expectedRevision: snapshot.revision,
      generation: snapshot.generation!, action: "restore" });
  }
  private changedWorkspace() {
    this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. This earlier Delete/Undo will not be replayed. Review the current logbook and recovery backup." });
  }
  private finish(receipt: any, mutation: LogbookMutation): DraftSnapshot {
    if (!sameDraftValue(receipt?.mutation, mutation) || !validScopedSnapshot(receipt?.contact) ||
      !sameGeneration(receipt.contact.generation, mutation.generation) ||
      receipt.contact.qso.id.toLowerCase() !== mutation.contactID.toLowerCase() ||
      receipt.contact.revision !== mutation.expectedRevision + 1 ||
      !!receipt.contact.qso.deletedAt !== (mutation.action === "delete"))
      throw new Error("The logbook operation receipt could not be verified.");
    this.persist({ pending: null, undo: mutation.action === "delete" ? clone(receipt.contact) : null, error: "" });
    return clone(receipt.contact);
  }
  private async receipt(mutation: LogbookMutation) {
    const response = await this.request("logbook_contact_receipt", { operationID: mutation.operationID, generation: mutation.generation });
    if (changedWorkspaceResponse(response)) { this.changedWorkspace(); return undefined; }
    if (response?.receipt) return this.finish(response.receipt, mutation);
    if (response?.receipt !== null) throw new Error("The logbook receipt response could not be verified.");
    return null;
  }
  private perform(mutation: LogbookMutation) {
    // Commit recovery identity before dispatch. A storage failure sends nothing.
    this.persist({ pending: clone(mutation), error: "" });
    return this.run(async () => {
      try {
        const response = await this.request("logbook_contact_apply", mutation);
        if (changedWorkspaceResponse(response)) { this.changedWorkspace(); return null; }
        if (response?.status === "conflict") {
          if (response.contact !== null && (!validScopedSnapshot(response.contact) ||
            !sameGeneration(response.contact.generation, mutation.generation) ||
            response.contact.qso.id.toLowerCase() !== mutation.contactID.toLowerCase()))
            throw new Error("The logbook conflict response could not be verified.");
          this.persist({ pending: null, undo: null, conflict: true,
            error: "This contact changed elsewhere. Nothing was overwritten. Refresh and review it before another change." });
          return null;
        }
        if (response?.status !== "applied") throw new Error("The logbook operation result could not be verified.");
        return this.finish(response.receipt, mutation);
      } catch (cause) {
        if (cause instanceof DraftRequestRejected) {
          try {
            const found = await this.receipt(mutation);
            if (found) return found;
            if (found === null) this.persist({ pending: null, error: cause.message });
          } catch { /* Retain identity when receipt evidence is unavailable. */ }
        }
        if (this.state.pending && !this.state.workspaceChanged)
          this.update({ error: "Logbook acknowledgement unavailable. Check its receipt before retrying; the original operation is retained." });
        throw cause;
      }
    });
  }
  private run(action: () => Promise<DraftSnapshot | null>) {
    this.update({ busy: true });
    this.operation = action().finally(() => { this.operation = null; this.update({ busy: false }); });
    return this.operation;
  }
  reconcile() {
    if (this.operation) return this.operation;
    const mutation = this.state.pending;
    if (!mutation || this.state.workspaceChanged) return Promise.resolve(null);
    return this.run(async () => {
      const found = await this.receipt(mutation);
      if (found === null) this.update({ error: "No receipt is available yet. Retry sends the same operation, never a new deletion." });
      return found ?? null;
    });
  }
  retry() {
    if (this.operation) return this.operation;
    if (!this.state.pending || this.state.workspaceChanged) return Promise.reject(new Error("No retry is available. Review the current workspace."));
    return this.perform(this.state.pending);
  }
  dismiss() {
    if (this.state.busy || this.state.pending && !this.state.workspaceChanged) throw new Error("Check the pending logbook operation first.");
    this.persist(empty());
  }
}
