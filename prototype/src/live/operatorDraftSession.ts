/** Local-first view of the workspace's canonical draft. No radio operations. */
export type DraftQSO = Record<string, any> & { id: string };
export type DraftSnapshot = { revision: number; qso: DraftQSO; generation?: string };
export type DraftMutation = { operationID: string; draftID: string; expectedRevision: number;
  action: "replace" | "clear" | "save"; qso?: DraftQSO; generation?: string };
type Receipt = { mutation: DraftMutation; draft: DraftSnapshot; savedQSO?: DraftQSO | null };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
export type DraftSessionState = { draft: DraftQSO | null; base: DraftSnapshot | null;
  conflict: DraftSnapshot | null; pending: DraftMutation | null; error: string; locked: boolean; workspaceChanged: boolean };
export type DraftJournal = Pick<DraftSessionState, "draft" | "base" | "pending">;
const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: any): string => JSON.stringify(value, (key, item) => {
  if (typeof item === "string") {
    if (["id", "operationID", "draftID", "contactID", "generation"].includes(key)) return item.toLowerCase();
    if (["start", "end", "createdAt", "updatedAt", "deletedAt"].includes(key) && /^\d{4}-\d\d-\d\dT/.test(item) && Number.isFinite(Date.parse(item)))
      return new Date(item).toISOString();
  }
  // Swift omits nil optional QSO fields while controls may explicitly set null.
  const optional = ["wavelogID", "end", "frequencyHz", "receiveFrequencyHz", "dxcc", "stationProfileID", "deletedAt"];
  return object(item) ? Object.fromEntries(Object.keys(item).sort()
    .filter(key => !optional.includes(key) || item[key] != null).map(key => [key, item[key]])) : item;
});
/** Only use for a correlated, explicit worker error response, not IPC failure. */
export class DraftRequestRejected extends Error {}
export const sameDraftValue = (a: unknown, b: unknown) => stable(a) === stable(b);
export function validDraftSnapshot(value: any): value is DraftSnapshot {
  return object(value) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    object(value.qso) && typeof value.qso.id === "string" && value.qso.id.length > 0;
}
export const validGeneration = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const validScopedSnapshot = (value: any): value is DraftSnapshot & { generation: string } => validDraftSnapshot(value) && validGeneration(value.generation);
export const sameGeneration = (a: unknown, b: unknown) => validGeneration(a) && validGeneration(b) && a.toLowerCase() === b.toLowerCase();
export const changedWorkspaceResponse = (value: any) => value?.status === "workspace_changed" && validGeneration(value.generation);
export const workspaceChangedMessage = "This edit may belong to a restored or replaced workspace. Your text is retained; earlier saves may exist in the recovery backup. Review the log before logging again.";
function validMutation(value: any): value is DraftMutation {
  return object(value) && typeof value.operationID === "string" && typeof value.draftID === "string" &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
    ["replace", "clear", "save"].includes(value.action) &&
    (value.action === "replace" ? object(value.qso) && value.qso.id === value.draftID : value.qso == null);
}
export function readDraftJournal(raw: string | null): DraftJournal | null {
  try {
    if (!raw || raw.length > 100_000) return null;
    const value = JSON.parse(raw);
    return validDraftSnapshot(value.base) && object(value.draft) && value.draft.id === value.base.qso.id &&
      (value.pending == null || validMutation(value.pending) && value.pending.draftID === value.base.qso.id)
      ? value : null;
  } catch { return null; }
}

export class OperatorDraftSession {
  private state: DraftSessionState;
  private listeners = new Set<() => void>();
  private work: Promise<void> | null = null;
  private action: Promise<DraftQSO | null> | null = null;
  private loading: Promise<void> | null = null;
  private resolving = false;
  private restoring = false;
  private version = 0;
  private lifecycle = 0;
  constructor(private request: Request, private writeJournal: (journal: DraftJournal) => void,
    journal: DraftJournal | null = null, private uuid: () => string = () => crypto.randomUUID()) {
    journal = clone(journal);
    const workspaceChanged = !!journal?.base && (!validGeneration(journal.base.generation) || !!journal.pending && !sameGeneration(journal.pending.generation, journal.base.generation));
    this.state = { draft: journal?.draft ?? null, base: journal?.base ?? null,
      pending: journal?.pending ?? null, conflict: null, workspaceChanged, error: workspaceChanged ? workspaceChangedMessage : "",
      locked: !workspaceChanged && !!journal?.pending && journal.pending.action !== "replace" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<DraftSessionState>, persist = true) {
    this.state = { ...this.state, ...change };
    if (persist && this.state.base && this.state.draft) {
      try { this.writeJournal(clone({ draft: this.state.draft, base: this.state.base, pending: this.state.pending })); }
      catch { this.state = { ...this.state, error: "Draft recovery could not be saved on this device. Keep this window open and retry." }; }
    }
    this.listeners.forEach(listener => listener());
  }
  get dirty() { return !!this.state.base && !sameDraftValue(this.state.draft, this.state.base.qso); }
  edit(next: DraftQSO) {
    if (this.state.locked) throw new Error("Wait for the current draft action to finish.");
    if (!this.state.base || next.id !== this.state.base.qso.id) throw new Error("The draft identity changed. Reload the shared draft.");
    if (sameDraftValue(next, this.state.draft)) return;
    this.version++;
    this.update({ draft: clone(next) });
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = this.refresh().finally(() => { this.loading = null; });
    return this.loading;
  }
  async refresh() {
    if (this.state.workspaceChanged) return;
    if (this.work || this.action || this.state.locked && !this.state.pending) return;
    const lifecycle = this.lifecycle;
    if (this.state.pending) { await this.reconcile(); return; }
    const result = await this.request("logbook_operator_draft");
    if (lifecycle !== this.lifecycle || this.work || this.action || this.state.pending) return;
    if (!validScopedSnapshot(result?.draft)) throw new Error("The shared draft response could not be verified.");
    this.acceptCurrent(result.draft);
  }
  private acceptCurrent(current: DraftSnapshot) {
    const base = this.state.base;
    if (base && !sameGeneration(current.generation, base.generation)) { this.changedWorkspace(); return; }
    if (base && current.revision < base.revision) {
      this.update({ conflict: clone(current), error: "The logbook draft was restored or replaced. Review your local text before continuing." });
      return;
    }
    if (base && sameDraftValue(current, base)) return;
    if (this.dirty || this.state.pending) {
      this.update({ conflict: clone(current), error: "The shared draft changed in another window. Your local text is retained." });
    } else this.update({ base: clone(current), draft: clone(current.qso), conflict: null, error: "" });
  }
  private mutation(action: DraftMutation["action"]): DraftMutation {
    if (!this.state.base || this.state.workspaceChanged || !validGeneration(this.state.base.generation)) throw new Error("Load the current workspace draft first.");
    return { operationID: this.uuid(), draftID: this.state.base.qso.id, expectedRevision: this.state.base.revision,
      generation: this.state.base.generation, action, ...(action === "replace" ? { qso: clone(this.state.draft!) } : {}) };
  }
  private changedWorkspace() { this.update({ workspaceChanged: true, locked: false, conflict: null, error: workspaceChangedMessage }); }
  private verifiedReceipt(value: any, mutation: DraftMutation): Receipt {
    if (!object(value) || !sameDraftValue(value.mutation, mutation) || !validScopedSnapshot(value.draft) ||
      !sameGeneration(value.draft.generation, mutation.generation) ||
      value.draft.revision !== mutation.expectedRevision + 1 ||
      (mutation.action === "replace" ? value.draft.qso.id !== mutation.draftID : value.draft.qso.id === mutation.draftID) ||
      (mutation.action === "save" && (!object(value.savedQSO) || value.savedQSO.id !== mutation.draftID)))
      throw new Error("The draft receipt could not be verified. Check the saved operation before retrying.");
    return value;
  }
  private acceptReceipt(receipt: Receipt, sentVersion: number) {
    // A successful Replace may race with further typing; preserve the newer text.
    const unchanged = this.version === sentVersion;
    // Reads issued before this write cannot describe the new canonical state.
    this.lifecycle++;
    this.update({ base: clone(receipt.draft),
      draft: unchanged || receipt.mutation.action !== "replace" ? clone(receipt.draft.qso) : this.state.draft,
      pending: null, conflict: null, error: "", locked: !!this.action || this.restoring });
  }
  private async apply(mutation: DraftMutation): Promise<DraftQSO | null> {
    const lifecycle = this.lifecycle, version = this.version;
    // Persist the exact operation before it can cross IPC. A retry must reuse it.
    this.writeJournal(clone({ draft: this.state.draft, base: this.state.base, pending: mutation }));
    this.update({ pending: mutation, error: "" }, false);
    try {
      const result = await this.request("logbook_operator_draft_apply", mutation);
      if (lifecycle !== this.lifecycle) throw new Error("The workspace changed while the draft operation was running.");
      if (changedWorkspaceResponse(result)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
      if (result?.status === "conflict" && validScopedSnapshot(result.draft)) {
        if (!sameGeneration(result.draft.generation, mutation.generation)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
        this.update({ pending: null, conflict: clone(result.draft), error: "The shared draft changed in another window. Your local text is retained." });
        throw new Error(this.state.error);
      }
      if (result?.status !== "applied") throw new Error("The draft result could not be verified.");
      const receipt = this.verifiedReceipt(result.receipt, mutation);
      this.acceptReceipt(receipt, version);
      return receipt.savedQSO ?? null;
    } catch (cause) {
      if (lifecycle === this.lifecycle && this.state.pending && cause instanceof DraftRequestRejected) {
        // Even a worker error may follow a committed Save whose subsequent
        // aggregate refresh failed. The durable receipt is the authority.
        try {
          const checked = await this.request("logbook_operator_draft_receipt", { operationID: mutation.operationID, generation: mutation.generation });
          if (lifecycle !== this.lifecycle) throw new Error("Workspace changed.");
          if (changedWorkspaceResponse(checked)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
          if (checked?.receipt) {
            const receipt = this.verifiedReceipt(checked.receipt, mutation);
            this.acceptReceipt(receipt, version);
            return receipt.savedQSO ?? null;
          }
          if (checked?.receipt === null) this.update({ pending: null, locked: false, error: cause.message });
        } catch { /* An unverified receipt leaves the original operation pending. */ }
      }
      if (lifecycle === this.lifecycle && this.state.pending && !this.state.workspaceChanged)
        this.update({ locked: mutation.action !== "replace", error: "Draft acknowledgement unavailable. Your text and operation ID are retained; check the saved operation before retrying." });
      throw cause;
    }
  }
  async flush() {
    if (this.state.workspaceChanged) throw new Error(workspaceChangedMessage);
    if (this.resolving) throw new Error("Wait for draft conflict resolution to finish.");
    if (this.work) await this.work;
    if (this.state.pending || this.state.conflict) throw new Error(this.state.error || "Resolve the pending draft operation first.");
    if (!this.dirty) return;
    this.work = (async () => {
      while (this.dirty) {
        await this.apply(this.mutation("replace"));
      }
    })().finally(() => { this.work = null; });
    return this.work;
  }
  commit(action: "save" | "clear"): Promise<DraftQSO | null> {
    if (this.action) return this.action;
    if (this.state.locked || this.state.workspaceChanged) return Promise.reject(new Error("Check the pending draft operation before another action."));
    this.update({ locked: true }, false);
    this.action = (async () => {
      // Clear deliberately discards the local draft but still fences on its base.
      if (action === "save") await this.flush();
      else if (this.work) await this.work;
      if (this.state.pending || this.state.conflict) throw new Error(this.state.error || "Resolve the pending draft operation first.");
      return this.apply(this.mutation(action));
    })().finally(() => { this.action = null; this.update({ locked: !this.state.workspaceChanged && !!this.state.pending && this.state.pending.action !== "replace" }, false); });
    return this.action;
  }
  async reconcile() {
    const pending = this.state.pending;
    if (!pending || this.work || this.action || this.state.workspaceChanged) return;
    const lifecycle = this.lifecycle, version = this.version;
    const result = await this.request("logbook_operator_draft_receipt", { operationID: pending.operationID, generation: pending.generation });
    if (lifecycle !== this.lifecycle || this.work || this.action || this.state.pending !== pending) return;
    if (changedWorkspaceResponse(result)) { this.changedWorkspace(); return; }
    if (result?.receipt) {
      const receipt = this.verifiedReceipt(result.receipt, pending);
      // On reload, local text may already include edits newer than the sent Replace.
      const keepTyping = pending.action === "replace" && !sameDraftValue(this.state.draft, pending.qso);
      this.acceptReceipt(receipt, keepTyping ? -1 : version);
      // A receipt is historical. Fetch current state before enabling another action.
      await this.refresh();
    } else this.update({ error: "No receipt is available yet. Retry uses the same operation ID and cannot create a duplicate QSO." });
  }
  async retry() {
    if (this.state.workspaceChanged) throw new Error(workspaceChangedMessage);
    if (this.work || this.action) return;
    const pending = this.state.pending;
    if (!pending) return this.flush();
    const keepTyping = pending.action === "replace" && !sameDraftValue(this.state.draft, pending.qso);
    const local = clone(this.state.draft);
    this.update({ locked: true }, false);
    this.action = this.apply(pending).then(saved => {
      if (keepTyping) this.update({ draft: local });
      return saved;
    }).finally(() => { this.action = null; this.update({ locked: !this.state.workspaceChanged && !!this.state.pending && this.state.pending.action !== "replace" }, false); });
    await this.action;
    await this.refresh();
  }
  async useShared() {
    if (this.work || this.action || this.state.pending && !this.state.workspaceChanged || this.state.locked) throw new Error("Check the pending operation before replacing local text.");
    const lifecycle = this.lifecycle;
    this.resolving = true;
    this.update({ locked: true }, false);
    try {
      const result = await this.request("logbook_operator_draft");
      if (lifecycle !== this.lifecycle || this.work || this.action || this.state.pending && !this.state.workspaceChanged) throw new Error("The workspace changed. Review its current draft.");
      if (!validScopedSnapshot(result?.draft)) throw new Error("The shared draft response could not be verified.");
      this.lifecycle++; this.version++;
      this.update({ base: clone(result.draft), draft: clone(result.draft.qso), pending: null, workspaceChanged: false, conflict: null, error: "" });
    } finally { this.resolving = false; this.update({ locked: false }, false); }
  }
  keepLocal() {
    if (this.work || this.action || this.state.pending || this.state.locked || this.state.workspaceChanged || !this.state.conflict || this.state.conflict.qso.id !== this.state.draft?.id)
      throw new Error("The original draft was saved or cleared. Copy your text before loading the current draft.");
    this.update({ base: clone(this.state.conflict), conflict: null, error: "" });
  }
  reset() {
    if (this.work || this.action || this.state.pending || this.state.locked) throw new Error("Finish or reconcile the draft operation before changing the workspace.");
    this.writeJournal({ draft: null, base: null, pending: null });
    this.lifecycle++; this.version++;
    this.update({ draft: null, base: null, pending: null, conflict: null, error: "", locked: false, workspaceChanged: false }, false);
  }
  async withWorkspaceRestore<T>(restore: () => Promise<T>): Promise<T> {
    if (this.state.locked || this.action || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the draft operation before restoring a workspace.");
    this.restoring = true;
    this.update({ locked: true }, false);
    try {
      await this.flush();
    } catch (cause) {
      this.restoring = false;
      const pending = this.getSnapshot().pending;
      this.update({ locked: !!pending && pending.action !== "replace" }, false);
      throw cause;
    }
    try {
      const result = await restore();
      this.writeJournal({ draft: null, base: null, pending: null });
      this.lifecycle++; this.version++;
      this.restoring = false;
      this.update({ draft: null, base: null, pending: null, conflict: null, error: "", locked: false, workspaceChanged: false }, false);
      return result;
    } catch (cause) {
      // A timeout cannot prove whether restore happened. Do not issue new draft
      // writes into an uncertain workspace; process restart retires that worker.
      this.update({ locked: true, error: "Workspace restore outcome is unconfirmed. Reopen the app before editing another QSO." }, false);
      throw cause;
    }
  }
}
