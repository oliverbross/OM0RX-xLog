import { DraftRequestRejected, sameDraftValue, validDraftSnapshot, validScopedSnapshot, validGeneration, sameGeneration,
  changedWorkspaceResponse, workspaceChangedMessage, type DraftQSO, type DraftSnapshot } from "./operatorDraftSession";
import { SpotEditorFence, spotActivationFrozenMessage, validSpotActivationBarrier, type SpotActivationBarrier, type SpotEditorReadiness } from "./spotActivationBarrier";

export type ContactMutation = { operationID: string; contactID: string; expectedRevision: number; action: "update"; qso: DraftQSO; generation?: string };
export type ContactJournal = { base: DraftSnapshot; draft: DraftQSO; pending: ContactMutation | null };
export type ContactEditState = { base: DraftSnapshot | null; draft: DraftQSO | null; pending: ContactMutation | null;
  conflict: boolean; current: DraftSnapshot | null; error: string; locked: boolean; workspaceChanged: boolean; activationFrozen: boolean };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
const clone = <T>(value: T): T => structuredClone(value);
const empty = (): ContactEditState => ({ base: null, draft: null, pending: null, conflict: false, current: null, error: "", locked: false, workspaceChanged: false, activationFrozen: false });
export function readContactJournal(raw: string | null): ContactJournal | null {
  try {
    if (!raw || raw.length > 100_000) return null;
    const value = JSON.parse(raw), pending = value?.pending;
    if (!validDraftSnapshot(value?.base) || value?.draft?.id !== value.base.qso.id) return null;
    if (pending != null && (pending.action !== "update" || typeof pending.operationID !== "string" || !pending.operationID ||
      pending.contactID !== value.base.qso.id || pending.expectedRevision !== value.base.revision ||
      !sameDraftValue(pending.qso, value.draft))) return null;
    return { base: value.base, draft: value.draft, pending: pending ?? null };
  } catch { return null; }
}

/** Existing contacts are saved only on explicit Update, never on typing. */
export class LogbookContactSession {
  private spotFence = new SpotEditorFence();
  private state: ContactEditState;
  private listeners = new Set<() => void>();
  private action: Promise<DraftQSO | null> | null = null;
  private reading: Promise<void> | null = null;
  private lifecycle = 0;
  constructor(private request: Request, private writeJournal: (journal: ContactJournal | null) => void,
    journal: ContactJournal | null = null, private uuid = () => crypto.randomUUID(), registrationRequired = false) {
    this.spotFence.setRegistered(!registrationRequired);
    const workspaceChanged = !!journal?.base && (!validGeneration(journal.base.generation) || !!journal.pending && !sameGeneration(journal.pending.generation, journal.base.generation));
    this.state = { ...empty(), ...clone(journal ?? {}), workspaceChanged, locked: !workspaceChanged && !!journal?.pending,
      error: workspaceChanged ? workspaceChangedMessage : journal?.pending ? "An earlier contact update needs its saved receipt checked." : "", activationFrozen: this.spotFence.frozen };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<ContactEditState>, persist = true) {
    this.state = { ...this.state, ...change, activationFrozen: this.spotFence.frozen };
    if (persist && this.state.base && this.state.draft) {
      try { this.writeJournal(clone({ base: this.state.base, draft: this.state.draft, pending: this.state.pending })); }
      catch { this.state = { ...this.state, error: "Contact recovery could not be saved on this device. Keep this window open." }; }
    }
    this.listeners.forEach(listener => listener());
  }
  private checked(value: any, id: string): DraftSnapshot | null {
    if (value === null) return null;
    if (!validScopedSnapshot(value) || value.qso.id.toLowerCase() !== id.toLowerCase()) throw new Error("The contact response could not be verified.");
    return value;
  }
  canAcceptLocalInput = () => !this.spotFence.frozen;
  setSpotEditorRegistered(registered: boolean) { this.spotFence.setRegistered(registered); this.update({}, false); }
  freezeSpotActivation(operationId: string) { const accepted = this.spotFence.freeze(operationId); this.update({}, false); return accepted; }
  prepareSpotActivation(barrier: SpotActivationBarrier): SpotEditorReadiness {
    const accepted = this.freezeSpotActivation(barrier.operationId);
    if (!accepted || !validSpotActivationBarrier(barrier) || !this.spotFence.matches(barrier.operationId)) return { ready: false, reason: "Editor registration or activation identity is unverified." };
    if (this.state.base || this.state.draft || this.state.pending || this.state.conflict || this.state.locked || this.state.workspaceChanged || this.action || this.reading)
      return { ready: false, reason: "Finish or reconcile the historical contact edit first." };
    return { ready: true };
  }
  reconcileSpotActivation(operationId: string, current: DraftSnapshot): boolean {
    if (!this.spotFence.matches(operationId) || !validScopedSnapshot(current) || this.action || this.reading || this.state.locked && !this.state.pending) return false;
    if (this.state.base && !sameGeneration(current.generation, this.state.base.generation)) this.changedWorkspace();
    this.spotFence.release(operationId); this.update({}, false); return true;
  }
  async open(id: string) {
    this.spotFence.assertWritable();
    if (this.state.base || this.state.locked || this.action) throw new Error("Finish or cancel the current contact edit first.");
    const lifecycle = ++this.lifecycle;
    this.update({ locked: true }, false);
    try {
      const response = await this.request("logbook_contact", { contactID: id });
      this.spotFence.assertWritable();
      const base = this.checked(response?.contact, id);
      if (!base || base.qso.deletedAt) throw new Error("This contact was removed. Refresh the logbook before editing.");
      if (lifecycle !== this.lifecycle) return;
      this.update({ base: clone(base), draft: clone(base.qso), error: "", conflict: false, current: null });
    } finally { if (lifecycle === this.lifecycle) this.update({ locked: false }, false); }
  }
  edit(qso: DraftQSO) {
    this.spotFence.assertWritable();
    if (this.state.locked || this.action) throw new Error("Wait for the contact update to finish.");
    if (!this.state.base || qso.id !== this.state.base.qso.id) throw new Error("The contact identity changed.");
    this.update({ draft: clone(qso) });
  }
  cancel() {
    this.spotFence.assertWritable();
    if (this.state.locked || this.action || this.state.pending && !this.state.workspaceChanged) throw new Error("Check the pending contact update before cancelling.");
    this.writeJournal(null); this.lifecycle++;
    this.update(empty(), false);
  }
  async refresh() {
    if (this.spotFence.frozen) return;
    if (this.state.workspaceChanged) return;
    if (this.action) return;
    if (this.state.pending) { await this.reconcile(); return; }
    if (!this.state.base || this.state.locked) return;
    if (this.reading) return this.reading;
    const base = this.state.base, lifecycle = this.lifecycle;
    this.reading = (async () => {
      const response = await this.request("logbook_contact", { contactID: base.qso.id });
      if (this.spotFence.frozen || lifecycle !== this.lifecycle || this.action || this.state.pending || this.state.base !== base) return;
      if (!validGeneration(response?.generation)) throw new Error("The contact workspace could not be verified.");
      if (!sameGeneration(response.generation, base.generation)) { this.changedWorkspace(); return; }
      const current = this.checked(response?.contact, base.qso.id);
      if (sameDraftValue(current, base) || this.state.conflict && sameDraftValue(current, this.state.current)) return;
      this.update({ conflict: true, current: clone(current), error: "This logged contact changed elsewhere. Your unsaved text is retained." });
    })().finally(() => { this.reading = null; });
    return this.reading;
  }
  async useCurrent() {
    this.spotFence.assertWritable();
    if (this.action || this.state.pending && !this.state.workspaceChanged || this.state.locked || !this.state.base) throw new Error("Check the pending contact update first.");
    const id = this.state.base.qso.id;
    this.update({ locked: true }, false);
    try {
      const response = await this.request("logbook_contact", { contactID: id });
      this.spotFence.assertWritable();
      const current = this.checked(response?.contact, id);
      if (!current || current.qso.deletedAt) throw new Error("This contact was removed. Copy your text, then cancel this edit.");
      this.lifecycle++;
      this.update({ base: clone(current), draft: clone(current.qso), pending: null, workspaceChanged: false, conflict: false, current: null, error: "" });
    } finally { this.update({ locked: false }, false); }
  }
  private finish(value: any, pending: ContactMutation): DraftQSO {
    if (!sameDraftValue(value?.mutation, pending) || !validScopedSnapshot(value?.contact) ||
      !sameGeneration(value.contact.generation, pending.generation) ||
      value.contact.qso.id.toLowerCase() !== pending.contactID.toLowerCase() ||
      value.contact.revision !== pending.expectedRevision + 1 || value.contact.qso.deletedAt)
      throw new Error("The contact update receipt could not be verified.");
    // Clear recovery storage before closing the editor. If storage fails, retain
    // the exact pending identity so the committed update can be reconciled.
    this.writeJournal(null); this.lifecycle++;
    this.update(empty(), false);
    return value.contact.qso;
  }
  private async apply(pending: ContactMutation): Promise<DraftQSO> {
    this.spotFence.assertWritable();
    this.writeJournal(clone({ base: this.state.base!, draft: this.state.draft!, pending }));
    this.update({ pending, locked: true, error: "" }, false);
    try {
      const response = await this.request("logbook_contact_apply", pending);
      if (changedWorkspaceResponse(response)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
      if (response?.status === "conflict") {
        const current = this.checked(response.contact, pending.contactID);
        if (current && !sameGeneration(current.generation, pending.generation)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
        this.update({ pending: null, conflict: true, current, locked: false,
          error: "This logged contact changed elsewhere. Your unsaved text is retained." });
        throw new Error(this.state.error);
      }
      if (response?.status !== "applied") throw new Error("The contact update result could not be verified.");
      return this.finish(response.receipt, pending);
    } catch (cause) {
      if (this.state.pending && cause instanceof DraftRequestRejected) {
        try {
          const result = await this.request("logbook_contact_receipt", { operationID: pending.operationID, generation: pending.generation });
          if (changedWorkspaceResponse(result)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
          if (result?.receipt) return this.finish(result.receipt, pending);
          if (result?.receipt === null) this.update({ pending: null, locked: false, error: cause.message });
        } catch { /* Missing evidence is not permission to resend a new update. */ }
      }
      if (this.state.pending && !this.state.workspaceChanged) this.update({ locked: true,
        error: "Contact update acknowledgement unavailable. Check the saved operation before retrying; your text is retained." });
      throw cause;
    }
  }
  save(): Promise<DraftQSO | null> {
    if (this.spotFence.frozen) return Promise.reject(new Error(spotActivationFrozenMessage));
    if (this.action) return this.action;
    const { base, draft, pending, conflict, locked } = this.state;
    if (!base || !draft || pending || conflict || locked || this.state.workspaceChanged || !validGeneration(base.generation)) return Promise.reject(new Error("Resolve the current contact edit before updating."));
    return this.perform({ operationID: this.uuid(), contactID: base.qso.id, expectedRevision: base.revision, generation: base.generation, action: "update", qso: clone(draft) });
  }
  private perform(pending: ContactMutation) {
    this.update({ locked: true }, false);
    this.action = this.apply(pending).finally(() => {
      this.action = null; this.update({ locked: !this.state.workspaceChanged && !!this.state.pending }, false);
    });
    return this.action;
  }
  retry() {
    if (this.spotFence.frozen) return Promise.reject(new Error(spotActivationFrozenMessage));
    if (this.state.workspaceChanged) return Promise.reject(new Error(workspaceChangedMessage));
    if (this.action) return this.action;
    return this.state.pending ? this.perform(this.state.pending) : this.save();
  }
  async reconcile(): Promise<DraftQSO | null> {
    this.spotFence.assertWritable();
    if (this.action) return this.action;
    const pending = this.state.pending;
    if (!pending || this.state.workspaceChanged) return null;
    this.action = (async () => {
      const result = await this.request("logbook_contact_receipt", { operationID: pending.operationID, generation: pending.generation });
      if (changedWorkspaceResponse(result)) { this.changedWorkspace(); return null; }
      if (result?.receipt) return this.finish(result.receipt, pending);
      this.update({ error: "No contact receipt is available yet. Retry reuses the same operation ID." });
      return null;
    })().finally(() => { this.action = null; this.update({ locked: !this.state.workspaceChanged && !!this.state.pending }, false); });
    return this.action;
  }
  private changedWorkspace() { this.update({ workspaceChanged: true, locked: false, conflict: false, current: null, error: workspaceChangedMessage }); }
}
