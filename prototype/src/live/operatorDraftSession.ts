import { SpotEditorFence, spotActivationFrozenMessage, validSpotActivationBarrier, type SpotActivationBarrier, type SpotEditorReadiness } from "./spotActivationBarrier";
/** Local-first view of the workspace's canonical draft. No radio operations. */
export type DraftQSO = Record<string, any> & { id: string };
export type DraftPowerIntent = { action: "manual"; value: string } | { action: "automatic"; value?: never };
export type DraftPowerSample = { source: "kpa500_output"; unit: "W"; watts: number;
  observedAt: string; radioObservedAt: string; amplifierObservedAt: string; receivedAt: string; sessionID: string };
export type DraftPowerContext = { providerID: string; selectionID: string; sessionID: string;
  sessionStartedAt: string; source: "direct_agent"; meterSource: "kpa500_output" };
export type DraftPowerContact = { workspaceID: string; draftID: string; call: string; band: string; mode: string; frequencyHz?: number | null };
export type DraftPowerScope = { id: string; contact: DraftPowerContact; context: DraftPowerContext; armedAt: string };
/** Matches Swift OperatorDraftPowerState; optional Codable properties may be omitted. */
export type DraftPowerState = { revision: number; enabled: boolean; fallback: string; manualOverride: boolean;
  selectedValue: string; contact: DraftPowerContact; activeScope?: DraftPowerScope | null;
  selectedSample?: DraftPowerSample | null; selectedContext?: DraftPowerContext | null;
  selectedContact?: DraftPowerContact | null; lastContext?: DraftPowerContext | null;
  sessionPeak?: DraftPowerSample | null; lastObservedAt?: string | null };
export type DraftSnapshot = { revision: number; qso: DraftQSO; generation?: string; power?: DraftPowerState | null };
export type DraftMutation = { operationID: string; draftID: string; expectedRevision: number;
  action: "replace" | "clear" | "save"; qso?: DraftQSO; generation?: string; powerIntent?: DraftPowerIntent };
type Receipt = { mutation: DraftMutation; draft: DraftSnapshot; savedQSO?: DraftQSO | null };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
export type DraftSessionState = { draft: DraftQSO | null; base: DraftSnapshot | null;
  conflict: DraftSnapshot | null; pending: DraftMutation | null; error: string; locked: boolean; workspaceChanged: boolean;
  powerIntent: DraftPowerIntent | null; powerIntentID: string | null; pendingPowerIntentID: string | null; activationFrozen: boolean };
export type DraftJournal = Pick<DraftSessionState, "draft" | "base" | "pending"> &
  Partial<Pick<DraftSessionState, "powerIntent" | "powerIntentID" | "pendingPowerIntentID">>;
const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: any): string => JSON.stringify(value, (key, item) => {
  if (typeof item === "string") {
    if (["id", "operationID", "draftID", "contactID", "generation", "workspaceID", "sessionID"].includes(key)) return item.toLowerCase();
    if (["start", "end", "createdAt", "updatedAt", "deletedAt", "observedAt", "radioObservedAt", "amplifierObservedAt", "receivedAt", "sessionStartedAt", "armedAt", "lastObservedAt"].includes(key) && /^\d{4}-\d\d-\d\dT/.test(item) && Number.isFinite(Date.parse(item)))
      return new Date(item).toISOString();
  }
  // Swift omits nil optional QSO fields while controls may explicitly set null.
  const optional = ["wavelogID", "end", "frequencyHz", "receiveFrequencyHz", "dxcc", "stationProfileID", "deletedAt",
    "power", "activeScope", "selectedSample", "selectedContext", "selectedContact", "lastContext", "sessionPeak", "lastObservedAt"];
  return object(item) ? Object.fromEntries(Object.keys(item).sort()
    .filter(key => !optional.includes(key) || item[key] != null).map(key => [key, item[key]])) : item;
});
/** Only use for a correlated, explicit worker error response, not IPC failure. */
export class DraftRequestRejected extends Error {}
export const sameDraftValue = (a: unknown, b: unknown) => stable(a) === stable(b);
const matchesPowerContact = (qso: DraftQSO, contact: DraftPowerContact) => contact.draftID.toLowerCase() === qso.id.toLowerCase() &&
  contact.call === String(qso.call ?? "").trim().toUpperCase() && contact.band === String(qso.band ?? "").trim().toLowerCase() &&
  contact.mode === String(qso.mode ?? "").trim().toUpperCase() && (contact.frequencyHz ?? null) === (qso.frequencyHz ?? null);
export function validDraftSnapshot(value: any): value is DraftSnapshot {
  return object(value) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    object(value.qso) && typeof value.qso.id === "string" && value.qso.id.length > 0 &&
    (value.power == null || validDraftPower(value.power) && value.power.selectedValue === value.qso.txPower && matchesPowerContact(value.qso, value.power.contact));
}
export const validGeneration = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && new TextEncoder().encode(value).length <= max && !value.includes("\0");
const powerDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Date.parse(value) > 0 && Date.parse(value) <= 4_102_444_800_000;
const validPowerContact = (value: any): value is DraftPowerContact => object(value) && validGeneration(value.workspaceID) &&
  bounded(value.draftID, 64) && value.draftID.length > 0 && bounded(value.call, 64) && bounded(value.band, 16) && bounded(value.mode, 16) &&
  value.call === value.call.trim().toUpperCase() && value.band === value.band.trim().toLowerCase() && value.mode === value.mode.trim().toUpperCase() &&
  (value.frequencyHz == null || Number.isSafeInteger(value.frequencyHz) && value.frequencyHz > 0 && value.frequencyHz <= 1_000_000_000_000);
const validPowerContext = (value: any): value is DraftPowerContext => object(value) &&
  bounded(value.providerID, 256) && !!value.providerID.trim() && bounded(value.selectionID, 256) && !!value.selectionID.trim() &&
  validGeneration(value.sessionID) && powerDate(value.sessionStartedAt) && value.source === "direct_agent" && value.meterSource === "kpa500_output";
const validPowerSample = (value: any): value is DraftPowerSample => object(value) && value.source === "kpa500_output" && value.unit === "W" &&
  Number.isFinite(value.watts) && value.watts > 0 && value.watts <= 1_000 && validGeneration(value.sessionID) &&
  [value.observedAt, value.radioObservedAt, value.amplifierObservedAt, value.receivedAt].every(powerDate) &&
  [[value.observedAt, 2_000], [value.radioObservedAt, 2_000], [value.amplifierObservedAt, 15_000]].every(([date, age]) => {
    const elapsed = Date.parse(value.receivedAt) - Date.parse(date as string); return elapsed >= 0 && elapsed <= (age as number);
  });
export function validDraftPower(value: any): value is DraftPowerState {
  if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.enabled !== "boolean" ||
    typeof value.manualOverride !== "boolean" || !bounded(value.fallback, 64) || !bounded(value.selectedValue, 343) || !validPowerContact(value.contact)) return false;
  if (![value.selectedContext, value.lastContext].every(item => item == null || validPowerContext(item)) ||
    value.selectedContact != null && !validPowerContact(value.selectedContact) ||
    ![value.selectedSample, value.sessionPeak].every(item => item == null || validPowerSample(item)) ||
    value.lastObservedAt != null && !powerDate(value.lastObservedAt)) return false;
  if (value.activeScope != null && (!object(value.activeScope) || !value.enabled || value.manualOverride ||
    !validGeneration(value.activeScope.id) || !validPowerContact(value.activeScope.contact) || !sameDraftValue(value.activeScope.contact, value.contact) ||
    !validPowerContext(value.activeScope.context) || !powerDate(value.activeScope.armedAt) ||
    Date.parse(value.activeScope.armedAt) < Date.parse(value.activeScope.context.sessionStartedAt))) return false;
  if (value.selectedSample != null && (value.manualOverride || !value.selectedContext ||
    !sameGeneration(value.selectedSample.sessionID, value.selectedContext.sessionID) || !sameDraftValue(value.selectedContact, value.contact) ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.selectedValue) || Number(value.selectedValue) !== value.selectedSample.watts)) return false;
  return true;
}
const validPowerIntent = (value: any): value is DraftPowerIntent => object(value) &&
  (value.action === "manual" ? bounded(value.value, 343) : value.action === "automatic" && value.value === undefined);
const withoutPower = (qso: DraftQSO): DraftQSO => {
  const result = clone(qso); delete result.txPower;
  if (object(result.extraFields)) result.extraFields = Object.fromEntries(Object.entries(result.extraFields)
    .filter(([key]) => !key.toUpperCase().startsWith("APP_OM0RXXLOG_POWER_")));
  return result;
};
export const validScopedSnapshot = (value: any): value is DraftSnapshot & { generation: string } => validDraftSnapshot(value) && validGeneration(value.generation);
export const sameGeneration = (a: unknown, b: unknown) => validGeneration(a) && validGeneration(b) && a.toLowerCase() === b.toLowerCase();
export const changedWorkspaceResponse = (value: any) => value?.status === "workspace_changed" && validGeneration(value.generation);
export const workspaceChangedMessage = "This edit may belong to a restored or replaced workspace. Your text is retained; earlier saves may exist in the recovery backup. Review the log before logging again.";
function validMutation(value: any): value is DraftMutation {
  return object(value) && typeof value.operationID === "string" && typeof value.draftID === "string" &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
    ["replace", "clear", "save"].includes(value.action) &&
    (value.action === "replace" ? object(value.qso) && value.qso.id === value.draftID && (value.powerIntent == null || validPowerIntent(value.powerIntent)) : value.qso == null && value.powerIntent == null);
}
export function readDraftJournal(raw: string | null): DraftJournal | null {
  try {
    if (!raw || raw.length > 100_000) return null;
    const value = JSON.parse(raw);
    return validDraftSnapshot(value.base) && object(value.draft) && value.draft.id === value.base.qso.id &&
      (value.pending == null || validMutation(value.pending) && value.pending.draftID === value.base.qso.id) &&
      (value.powerIntent == null || validPowerIntent(value.powerIntent)) &&
      [value.powerIntentID, value.pendingPowerIntentID].every(item => item == null || validGeneration(item))
      ? value : null;
  } catch { return null; }
}

export class OperatorDraftSession {
  private spotFence = new SpotEditorFence();
  private state: DraftSessionState;
  private listeners = new Set<() => void>();
  private work: Promise<void> | null = null;
  private action: Promise<DraftQSO | null> | null = null;
  private loading: Promise<void> | null = null;
  private resolving = false;
  private restoring = false;
  private version = 0;
  private lifecycle = 0;
  private readSequence = 0;
  private localInputPending = false;
  setLocalInputPending = (pending: boolean) => { this.localInputPending = pending; };
  constructor(private request: Request, private writeJournal: (journal: DraftJournal) => void,
    journal: DraftJournal | null = null, private uuid: () => string = () => crypto.randomUUID(), registrationRequired = false) {
    this.spotFence.setRegistered(!registrationRequired);
    journal = clone(journal);
    const workspaceChanged = !!journal?.base && (!validGeneration(journal.base.generation) || !!journal.pending && !sameGeneration(journal.pending.generation, journal.base.generation));
    const powerIntent = journal?.powerIntent ?? journal?.pending?.powerIntent ?? null;
    const powerIntentID = powerIntent ? journal?.powerIntentID ?? this.uuid() : null;
    this.state = { draft: journal?.draft ?? null, base: journal?.base ?? null,
      pending: journal?.pending ?? null, conflict: null, workspaceChanged, error: workspaceChanged ? workspaceChangedMessage : "",
      locked: !workspaceChanged && !!journal?.pending && journal.pending.action !== "replace",
      powerIntent, powerIntentID, pendingPowerIntentID: journal?.pending?.powerIntent ? journal.pendingPowerIntentID ?? powerIntentID : null, activationFrozen: this.spotFence.frozen };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<DraftSessionState>, persist = true) {
    this.state = { ...this.state, ...change, activationFrozen: this.spotFence.frozen };
    if (persist && this.state.base && this.state.draft) {
      try { this.writeJournal(this.journal()); }
      catch { this.state = { ...this.state, error: "Draft recovery could not be saved on this device. Keep this window open and retry." }; }
    }
    this.listeners.forEach(listener => listener());
  }
  private journal(pending = this.state.pending, pendingPowerIntentID = this.state.pendingPowerIntentID): DraftJournal {
    return clone({ draft: this.state.draft, base: this.state.base, pending,
      ...(this.state.powerIntent ? { powerIntent: this.state.powerIntent, powerIntentID: this.state.powerIntentID } : {}),
      ...(pendingPowerIntentID ? { pendingPowerIntentID } : {}) });
  }
  get dirty() { return !!this.state.base && (!!this.state.powerIntent || !sameDraftValue(this.state.draft, this.state.base.qso)); }
  canAcceptLocalInput = () => !this.spotFence.frozen;
  canAcceptBackgroundUpdate = () => !this.spotFence.frozen && !this.localInputPending;
  setSpotEditorRegistered(registered: boolean) { this.spotFence.setRegistered(registered); this.readSequence++; this.update({}, false); }
  freezeSpotActivation(operationId: string) {
    const accepted = this.spotFence.freeze(operationId); this.readSequence++; this.update({}, false); return accepted;
  }
  prepareSpotActivation(barrier: SpotActivationBarrier): SpotEditorReadiness {
    const accepted = this.freezeSpotActivation(barrier.operationId);
    const reject = (reason: string) => ({ ready: false, reason });
    if (!accepted || !validSpotActivationBarrier(barrier) || !this.spotFence.matches(barrier.operationId)) return reject("Editor registration or activation identity is unverified.");
    if (this.localInputPending) return reject("Finish the locally buffered draft fields first.");
    if (this.work || this.action || this.loading || this.state.pending) return reject("Check the pending draft operation first.");
    if (this.restoring || this.resolving || this.state.locked || this.state.workspaceChanged || this.state.conflict || this.state.error) return reject("Resolve the draft or workspace state first.");
    if (this.dirty || this.state.powerIntent || this.state.pendingPowerIntentID) return reject("Unsaved draft text or power intent is retained.");
    const base = this.state.base;
    if (!base || !this.state.draft || !sameGeneration(base.generation, barrier.generation) ||
      base.qso.id.toLowerCase() !== barrier.draftId.toLowerCase() || base.revision !== barrier.expectedRevision)
      return reject("The canonical draft identity or revision changed.");
    return { ready: true };
  }
  /** Called only after a verified matching terminal native status and a fresh
   * canonical read. Never sends/retries a local pending journal operation. */
  reconcileSpotActivation(operationId: string, current: DraftSnapshot): boolean {
    if (!this.spotFence.matches(operationId) || !validScopedSnapshot(current) || this.work || this.action || this.loading || this.restoring || this.resolving) return false;
    this.readSequence++;
    if (this.localInputPending) {
      if (this.state.base && !sameGeneration(current.generation, this.state.base.generation)) this.changedWorkspace();
      else if (this.state.base && !sameDraftValue(current, this.state.base)) this.update({ conflict: clone(current), error: "The shared draft changed. Your locally buffered fields are retained." });
    } else this.acceptCurrent(current);
    this.spotFence.release(operationId); this.update({}, false);
    return true;
  }
  setManualPower(value: string) {
    if (!validPowerIntent({ action: "manual", value })) throw new Error("The power value is invalid.");
    this.setPowerIntent({ action: "manual", value });
  }
  resumeAutomaticPower() { this.setPowerIntent({ action: "automatic" }); }
  private setPowerIntent(powerIntent: DraftPowerIntent) {
    this.spotFence.assertWritable();
    if (this.state.locked) throw new Error("Wait for the current draft action to finish.");
    if (!this.state.base || !this.state.draft || this.state.workspaceChanged) throw new Error("Load the current workspace draft first.");
    if (powerIntent.action === "automatic" && !this.state.base.power) throw new Error("Load the current power-enabled workspace draft first.");
    this.version++;
    this.update({ powerIntent: clone(powerIntent), powerIntentID: this.uuid(),
      ...(powerIntent.action === "manual" ? { draft: { ...this.state.draft, txPower: powerIntent.value } } : {}) });
  }
  edit(next: DraftQSO) {
    this.spotFence.assertWritable();
    if (this.state.locked) throw new Error("Wait for the current draft action to finish.");
    if (!this.state.base || next.id !== this.state.base.qso.id) throw new Error("The draft identity changed. Reload the shared draft.");
    if (sameDraftValue(next, this.state.draft)) return;
    this.version++;
    this.update({ draft: clone(next) });
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = this.refresh().then(() => {}).finally(() => { this.loading = null; });
    return this.loading;
  }
  /** True only after an actual, validated current read. Skipped/fenced reads
   * must not be mistaken for transport recovery by the window health UI. */
  async refresh(): Promise<boolean> {
    if (this.spotFence.frozen) return false;
    if (this.localInputPending) return false;
    if (this.state.workspaceChanged) return false;
    if (this.work || this.action || this.state.locked && !this.state.pending) return false;
    const lifecycle = this.lifecycle;
    if (this.state.pending) { await this.reconcile(); return false; }
    const sequence = ++this.readSequence;
    let result;
    try { result = await this.request("logbook_operator_draft"); }
    catch (cause) {
      if (sequence !== this.readSequence || lifecycle !== this.lifecycle) return false;
      throw cause;
    }
    if (this.spotFence.frozen || this.localInputPending || sequence !== this.readSequence || lifecycle !== this.lifecycle || this.work || this.action || this.state.pending) return false;
    if (!validScopedSnapshot(result?.draft)) throw new Error("The shared draft response could not be verified.");
    this.receiveSnapshot(result.draft);
    return true;
  }
  /** Consume a correlated worker snapshot without issuing another request. */
  receiveSnapshot(current: DraftSnapshot) {
    if (!validScopedSnapshot(current)) throw new Error("The shared draft response could not be verified.");
    // Wake, reload, settings and direct snapshots share one freshness fence.
    this.readSequence++;
    if (this.spotFence.frozen || this.localInputPending) return;
    if (!this.state.workspaceChanged) this.acceptCurrent(current);
  }
  private acceptCurrent(current: DraftSnapshot) {
    const base = this.state.base;
    if (base && !sameGeneration(current.generation, base.generation)) { this.changedWorkspace(); return; }
    if (base && current.revision < base.revision) {
      this.update({ conflict: clone(current), error: "The logbook draft was restored or replaced. Review your local text before continuing." });
      return;
    }
    if (base && sameDraftValue(current, base)) return;
    if (base && current.revision === base.revision && sameDraftValue(withoutPower(current.qso), withoutPower(base.qso))) {
      const currentPowerRevision = current.power?.revision ?? -1, basePowerRevision = base.power?.revision ?? -1;
      if (currentPowerRevision < basePowerRevision) return;
      if (currentPowerRevision > basePowerRevision) {
        // A delayed power notification cannot resolve an existing text conflict
        // or an uncertain operation; only explicit reconciliation may do that.
        this.update({ base: clone(current), draft: this.mergePower(this.state.draft!, current) });
        return;
      }
    }
    if (this.dirty || this.state.pending) {
      this.update({ conflict: clone(current), error: "The shared draft changed in another window. Your local text is retained." });
    } else this.update({ base: clone(current), draft: clone(current.qso), conflict: null, error: "" });
  }
  private mutation(action: DraftMutation["action"]): DraftMutation {
    if (!this.state.base || this.state.workspaceChanged || !validGeneration(this.state.base.generation)) throw new Error("Load the current workspace draft first.");
    return { operationID: this.uuid(), draftID: this.state.base.qso.id, expectedRevision: this.state.base.revision,
      generation: this.state.base.generation, action, ...(action === "replace" ? { qso: clone(this.state.draft!),
        ...(this.state.powerIntent ? { powerIntent: clone(this.state.powerIntent) } : {}) } : {}) };
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
  private mergePower(local: DraftQSO, snapshot: DraftSnapshot, intent = this.state.powerIntent): DraftQSO {
    if (!snapshot.power || intent?.action === "manual" || !matchesPowerContact(local, snapshot.power.contact)) return clone(local);
    const result = clone(local); result.txPower = snapshot.qso.txPower;
    if (object(result.extraFields)) {
      result.extraFields = Object.fromEntries(Object.entries(result.extraFields).filter(([key]) => !key.toUpperCase().startsWith("APP_OM0RXXLOG_POWER_")));
      for (const [key, value] of Object.entries(snapshot.qso.extraFields ?? {}))
        if (key.toUpperCase().startsWith("APP_OM0RXXLOG_POWER_")) result.extraFields[key] = value;
    }
    return result;
  }
  private acceptReceipt(receipt: Receipt, sentVersion: number, sentPowerIntentID: string | null) {
    // A successful Replace may race with further typing; preserve the newer text.
    const unchanged = this.version === sentVersion;
    const powerIntent = receipt.mutation.action !== "replace" || this.state.powerIntentID === sentPowerIntentID ? null : this.state.powerIntent;
    // Reads issued before this write cannot describe the new canonical state.
    this.lifecycle++;
    this.update({ base: clone(receipt.draft),
      draft: unchanged && !powerIntent || receipt.mutation.action !== "replace" ? clone(receipt.draft.qso) : this.mergePower(this.state.draft!, receipt.draft, powerIntent),
      pending: null, pendingPowerIntentID: null, powerIntent, powerIntentID: powerIntent ? this.state.powerIntentID : null,
      conflict: null, error: "", locked: !!this.action || this.restoring });
  }
  private async apply(mutation: DraftMutation): Promise<DraftQSO | null> {
    this.spotFence.assertWritable();
    const lifecycle = this.lifecycle, version = this.version;
    const sentPowerIntentID = mutation === this.state.pending ? this.state.pendingPowerIntentID : mutation.powerIntent ? this.state.powerIntentID : null;
    // Persist the exact operation before it can cross IPC. A retry must reuse it.
    this.writeJournal(this.journal(mutation, sentPowerIntentID));
    this.update({ pending: mutation, pendingPowerIntentID: sentPowerIntentID, error: "" }, false);
    try {
      const result = await this.request("logbook_operator_draft_apply", mutation);
      if (lifecycle !== this.lifecycle) throw new Error("The workspace changed while the draft operation was running.");
      if (changedWorkspaceResponse(result)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
      if (result?.status === "conflict" && validScopedSnapshot(result.draft)) {
        if (!sameGeneration(result.draft.generation, mutation.generation)) { this.changedWorkspace(); throw new Error(workspaceChangedMessage); }
        this.update({ pending: null, pendingPowerIntentID: null, conflict: clone(result.draft), error: "The shared draft changed in another window. Your local text is retained." });
        throw new Error(this.state.error);
      }
      if (result?.status !== "applied") throw new Error("The draft result could not be verified.");
      const receipt = this.verifiedReceipt(result.receipt, mutation);
      this.acceptReceipt(receipt, version, sentPowerIntentID);
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
            this.acceptReceipt(receipt, version, sentPowerIntentID);
            return receipt.savedQSO ?? null;
          }
          if (checked?.receipt === null) this.update({ pending: null, pendingPowerIntentID: null, locked: false, error: cause.message });
        } catch { /* An unverified receipt leaves the original operation pending. */ }
      }
      if (lifecycle === this.lifecycle && this.state.pending && !this.state.workspaceChanged)
        this.update({ locked: mutation.action !== "replace", error: "Draft acknowledgement unavailable. Your text and operation ID are retained; check the saved operation before retrying." });
      throw cause;
    }
  }
  async flush() {
    this.spotFence.assertWritable();
    if (this.state.workspaceChanged) throw new Error(workspaceChangedMessage);
    if (this.resolving) throw new Error("Wait for draft conflict resolution to finish.");
    if (this.work) await this.work;
    this.spotFence.assertWritable();
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
    if (this.spotFence.frozen) return Promise.reject(new Error(spotActivationFrozenMessage));
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
    this.spotFence.assertWritable();
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
      this.acceptReceipt(receipt, keepTyping || this.state.powerIntentID !== this.state.pendingPowerIntentID ? -1 : version, this.state.pendingPowerIntentID);
      // A receipt is historical. Fetch current state before enabling another action.
      await this.refresh();
    } else this.update({ error: "No receipt is available yet. Retry uses the same operation ID and cannot create a duplicate QSO." });
  }
  async retry() {
    this.spotFence.assertWritable();
    if (this.state.workspaceChanged) throw new Error(workspaceChangedMessage);
    if (this.work || this.action) return;
    const pending = this.state.pending;
    if (!pending) return this.flush();
    const keepTyping = pending.action === "replace" && (!sameDraftValue(this.state.draft, pending.qso) || this.state.powerIntentID !== this.state.pendingPowerIntentID);
    const local = clone(this.state.draft);
    this.update({ locked: true }, false);
    this.action = this.apply(pending).then(saved => {
      if (keepTyping) this.update({ draft: this.mergePower(local!, this.state.base!, this.state.powerIntent) });
      return saved;
    }).finally(() => { this.action = null; this.update({ locked: !this.state.workspaceChanged && !!this.state.pending && this.state.pending.action !== "replace" }, false); });
    await this.action;
    await this.refresh();
  }
  async useShared() {
    this.spotFence.assertWritable();
    if (this.work || this.action || this.state.pending && !this.state.workspaceChanged || this.state.locked) throw new Error("Check the pending operation before replacing local text.");
    const lifecycle = this.lifecycle;
    this.resolving = true;
    this.update({ locked: true }, false);
    try {
      const result = await this.request("logbook_operator_draft");
      this.spotFence.assertWritable();
      if (lifecycle !== this.lifecycle || this.work || this.action || this.state.pending && !this.state.workspaceChanged) throw new Error("The workspace changed. Review its current draft.");
      if (!validScopedSnapshot(result?.draft)) throw new Error("The shared draft response could not be verified.");
      this.lifecycle++; this.version++;
      this.update({ base: clone(result.draft), draft: clone(result.draft.qso), pending: null, powerIntent: null, powerIntentID: null, pendingPowerIntentID: null,
        workspaceChanged: false, conflict: null, error: "" });
    } finally { this.resolving = false; this.update({ locked: false }, false); }
  }
  keepLocal() {
    this.spotFence.assertWritable();
    if (this.work || this.action || this.state.pending || this.state.locked || this.state.workspaceChanged || !this.state.conflict || this.state.conflict.qso.id !== this.state.draft?.id)
      throw new Error("The original draft was saved or cleared. Copy your text before loading the current draft.");
    this.update({ base: clone(this.state.conflict), draft: this.mergePower(this.state.draft!, this.state.conflict), conflict: null, error: "" });
  }
  reset() {
    this.spotFence.assertWritable();
    if (this.work || this.action || this.state.pending || this.state.locked) throw new Error("Finish or reconcile the draft operation before changing the workspace.");
    this.writeJournal({ draft: null, base: null, pending: null });
    this.lifecycle++; this.version++;
    this.update({ draft: null, base: null, pending: null, powerIntent: null, powerIntentID: null, pendingPowerIntentID: null,
      conflict: null, error: "", locked: false, workspaceChanged: false }, false);
  }
  async withWorkspaceRestore<T>(restore: () => Promise<T>): Promise<T> {
    this.spotFence.assertWritable();
    if (this.state.locked || this.action || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the draft operation before restoring a workspace.");
    this.restoring = true;
    this.update({ locked: true }, false);
    try {
      await this.flush();
      this.spotFence.assertWritable();
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
      this.update({ draft: null, base: null, pending: null, powerIntent: null, powerIntentID: null, pendingPowerIntentID: null,
        conflict: null, error: "", locked: false, workspaceChanged: false }, false);
      return result;
    } catch (cause) {
      // A timeout cannot prove whether restore happened. Do not issue new draft
      // writes into an uncertain workspace; process restart retires that worker.
      this.update({ locked: true, error: "Workspace restore outcome is unconfirmed. Reopen the app before editing another QSO." }, false);
      throw cause;
    }
  }
}
