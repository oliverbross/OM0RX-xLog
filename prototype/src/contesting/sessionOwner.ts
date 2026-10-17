import { ContestClient, validateDraftFields, type ContestMutation, type ContestOperationState } from "./client";
import type { ContestDraftFields, ContestDraftResult, ContestDraftSnapshot, ContestQSOChangeResult, ContestRequest, ContestSessionSummary } from "./types";

export type ContestRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ContestOwnerLease = { id: number };
type RecoveredDraft = { sessionID: string; workspaceGeneration: string; draftID: string; fields: ContestDraftFields };
type Recovery = { drafts: Record<string, RecoveredDraft>; pending?: { operation: ContestMutation; phase: "inflight" | "uncertain" } };
const KEY_PREFIX = "xlog.contesting.local-test-workspace.v2:";
const sharedOwners = new WeakMap<ContestRequest, ContestSessionOwner>();

function draftKey(sessionID: string, generation: string) { return `${generation}/${sessionID}`; }
function operationValid(operation: ContestMutation) {
  const scope = operation?.scope, methods = ["contest_create", "contest_draft_apply", "contest_serial_reserve", "contest_qso_commit", "contest_qso_correct", "contest_qso_delete"];
  return methods.includes(operation?.method) && !!scope && typeof scope.sessionID === "string" && scope.sessionID.length <= 128 &&
    typeof scope.workspaceGeneration === "string" && scope.workspaceGeneration.length <= 128 && typeof scope.requestID === "string" && scope.requestID.length <= 128 &&
    typeof scope.payloadDigest === "string" && scope.payloadDigest.length <= 512 && typeof scope.operationTimestamp === "string" && Number.isFinite(Date.parse(scope.operationTimestamp)) && new Date(scope.operationTimestamp).toISOString() === scope.operationTimestamp &&
    Number.isSafeInteger(scope.expectedRevision) && scope.expectedRevision >= 0 &&
    !!operation.payload && typeof operation.payload === "object" && !Array.isArray(operation.payload);
}
function load(storage: ContestRecoveryStorage | undefined, key: string): Recovery {
  if (!storage) return { drafts: {} };
  try {
    const value = JSON.parse(storage.getItem(key) || "null") as Recovery | null;
    if (!value || typeof value !== "object" || !value.drafts || typeof value.drafts !== "object") return { drafts: {} };
    for (const draft of Object.values(value.drafts)) validateDraftFields(draft.fields);
    if (value.pending) {
      if (!operationValid(value.pending.operation)) throw new Error("Invalid contest recovery operation.");
      value.pending.phase = "uncertain";
    }
    return value;
  } catch { storage.removeItem(key); return { drafts: {} }; }
}
function sameOperation(a: ContestMutation, b: ContestMutation) {
  return a.method === b.method && a.scope.sessionID === b.scope.sessionID && a.scope.workspaceGeneration === b.scope.workspaceGeneration &&
    a.scope.requestID === b.scope.requestID && a.scope.payloadDigest === b.scope.payloadDigest;
}

export class ContestSessionOwner {
  private sessionValue: ContestSessionSummary | null = null;
  private draftValue: ContestDraftSnapshot | null = null;
  private editVersion = 0;
  private savedVersion = 0;
  private pump: Promise<void> | null = null;
  private recovery: Recovery = { drafts: {} };
  private storageKey = "";
  private workspaceGeneration = "";
  private listeners = new Set<() => void>();
  private leaseSerial = 0;
  private activeLease = 0;
  private admission = 0;

  constructor(readonly client: ContestClient, private readonly storage?: ContestRecoveryStorage) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  get session() { return this.sessionValue; }
  get draft() { return this.draftValue; }
  get dirty() { return this.editVersion > this.savedVersion; }
  get pendingOperation() { return this.recovery.pending?.operation ?? null; }
  get pendingPhase() { return this.recovery.pending?.phase ?? null; }

  acquireLease(): ContestOwnerLease { const lease = { id: ++this.leaseSerial }; this.activeLease = lease.id; this.admission += 1; return lease; }
  releaseLease(lease: ContestOwnerLease) { if (this.activeLease === lease.id) { this.activeLease = 0; this.admission += 1; } }
  beginAdmission(lease: ContestOwnerLease | null): number | null { if (!lease || this.activeLease !== lease.id) return null; this.admission += 1; return this.admission; }
  captureAdmission(lease: ContestOwnerLease | null): number | null { return lease && this.activeLease === lease.id ? this.admission : null; }
  accepts(lease: ContestOwnerLease | null, admission: number | null) { return !!lease && admission !== null && this.activeLease === lease.id && this.admission === admission; }

  setWorkspaceGeneration(generation: string, lease: ContestOwnerLease, admission: number) {
    if (!this.accepts(lease, admission)) return false;
    if (generation === this.workspaceGeneration) return true;
    if (this.pump || this.recovery.pending) throw new Error("Cannot switch contest workspaces while an operation is pending.");
    this.workspaceGeneration = generation;
    this.storageKey = `${KEY_PREFIX}${encodeURIComponent(generation)}`;
    this.recovery = load(this.storage, this.storageKey);
    this.sessionValue = null; this.draftValue = null; this.editVersion = 0; this.savedVersion = 0;
    this.emit(); return true;
  }
  private persist() {
    if (!this.storage || !this.storageKey) return;
    if (!Object.keys(this.recovery.drafts).length && !this.recovery.pending) this.storage.removeItem(this.storageKey);
    else this.storage.setItem(this.storageKey, JSON.stringify(this.recovery));
  }
  trackOperation(operation: ContestMutation, state: ContestOperationState) {
    const pending = this.recovery.pending;
    if (state === "inflight") {
      if (pending && !sameOperation(pending.operation, operation)) throw new Error("Another contest operation is already pending.");
      this.recovery.pending = { operation, phase: "inflight" };
    } else if (state === "uncertain") {
      this.recovery.pending = { operation, phase: "uncertain" };
    } else if (pending && sameOperation(pending.operation, operation)) delete this.recovery.pending;
    this.persist(); this.emit();
  }
  confirmPending(operation: ContestMutation, lease: ContestOwnerLease, admission: number) {
    if (this.accepts(lease, admission) && this.recovery.pending && sameOperation(this.recovery.pending.operation, operation)) {
      delete this.recovery.pending; this.persist(); this.emit();
      return true;
    }
    return false;
  }
  activate(session: ContestSessionSummary, draft: ContestDraftSnapshot, lease: ContestOwnerLease, admission: number) {
    if (!this.accepts(lease, admission) || !this.workspaceGeneration || session.workspaceGeneration !== this.workspaceGeneration || draft.workspaceGeneration !== this.workspaceGeneration) return false;
    const key = draftKey(session.sessionID, session.workspaceGeneration), saved = this.recovery.drafts[key];
    const matches = saved && saved.draftID === draft.draftID;
    this.sessionValue = session; this.draftValue = matches ? { ...draft, fields: saved.fields } : draft;
    this.editVersion = matches ? 1 : 0; this.savedVersion = 0; this.emit(); return true;
  }
  rebase(session: ContestSessionSummary, draft: ContestDraftSnapshot, lease: ContestOwnerLease, admission: number) {
    const local = this.dirty ? this.draftValue?.fields : undefined;
    if (!this.activate(session, draft, lease, admission)) return false;
    if (local) this.edit(local); return true;
  }
  edit(fields: ContestDraftFields) {
    validateDraftFields(fields);
    const draftSaveInFlight = this.recovery.pending?.phase === "inflight" && this.recovery.pending.operation.method === "contest_draft_apply";
    if (!this.sessionValue || !this.draftValue || this.recovery.pending && !draftSaveInFlight) return;
    this.editVersion += 1; this.draftValue = { ...this.draftValue, fields };
    this.recovery.drafts[draftKey(this.sessionValue.sessionID, this.sessionValue.workspaceGeneration)] = {
      sessionID: this.sessionValue.sessionID, workspaceGeneration: this.sessionValue.workspaceGeneration, draftID: this.draftValue.draftID, fields,
    };
    this.persist(); this.emit();
  }
  private contextMatches(sessionID: string, generation: string) { return this.sessionValue?.sessionID === sessionID && this.sessionValue.workspaceGeneration === generation; }
  async flush(): Promise<void> {
    if (this.pump) { await this.pump; if (this.dirty && !this.recovery.pending) return this.flush(); return; }
    if (this.recovery.pending || !this.sessionValue || !this.draftValue || !this.dirty) return;
    this.pump = this.runPump().finally(() => { this.pump = null; });
    await this.pump;
    if (this.dirty && !this.recovery.pending) await this.flush();
  }
  private async runPump() {
    while (!this.recovery.pending && this.sessionValue && this.draftValue && this.savedVersion < this.editVersion) {
      const session = this.sessionValue, draft = this.draftValue, version = this.editVersion, fields = draft.fields;
      const result = await this.client.applyDraft(session, draft.draftID, fields);
      if (!this.contextMatches(session.sessionID, session.workspaceGeneration)) return;
      this.sessionValue = result.session; this.savedVersion = version;
      this.draftValue = this.editVersion > version ? { ...result.draft, fields: this.draftValue!.fields } : result.draft;
      const key = draftKey(result.session.sessionID, result.session.workspaceGeneration);
      if (this.savedVersion === this.editVersion) delete this.recovery.drafts[key];
      else this.recovery.drafts[key] = { sessionID: result.session.sessionID, workspaceGeneration: result.session.workspaceGeneration, draftID: result.draft.draftID, fields: this.draftValue.fields };
      this.persist(); this.emit();
    }
  }
  apply(result: ContestDraftResult, lease: ContestOwnerLease, admission: number) {
    if (!this.accepts(lease, admission) || !this.sessionValue || !this.contextMatches(result.session.sessionID, result.session.workspaceGeneration)) return false;
    const oldKey = draftKey(this.sessionValue.sessionID, this.sessionValue.workspaceGeneration);
    this.sessionValue = result.session; this.draftValue = result.draft; this.editVersion = 0; this.savedVersion = 0;
    delete this.recovery.drafts[oldKey]; this.persist(); this.emit(); return true;
  }
  applyChange(result: ContestQSOChangeResult, lease: ContestOwnerLease, admission: number) {
    const current = this.sessionValue, draft = this.draftValue, next = result.session;
    if (!this.accepts(lease, admission) || !current || !draft || !this.contextMatches(next.sessionID, next.workspaceGeneration) ||
        next.referenceDataVersion !== current.referenceDataVersion || next.ruleIdentity.id !== current.rule.identity.id ||
        next.ruleIdentity.version !== current.rule.identity.version || next.ruleIdentity.edition !== current.rule.identity.edition ||
        next.ruleIdentity.sourceRevision !== current.rule.identity.sourceRevision) return false;
    this.sessionValue = { ...current, revision: next.revision, qsoCount: next.qsoCount, updatedAt: next.updatedAt };
    this.draftValue = { ...draft, revision: next.revision };
    this.emit(); return true;
  }
}

export function sharedContestSessionOwner(request: ContestRequest, createID?: () => string, digest?: (payload: unknown) => Promise<string>, storage?: ContestRecoveryStorage) {
  const existing = sharedOwners.get(request); if (existing) return existing;
  let owner!: ContestSessionOwner;
  const client = new ContestClient(request, createID, digest, (operation, state) => owner.trackOperation(operation, state));
  owner = new ContestSessionOwner(client, storage); sharedOwners.set(request, owner); return owner;
}

export class MemoryContestRecoveryStorage implements ContestRecoveryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
