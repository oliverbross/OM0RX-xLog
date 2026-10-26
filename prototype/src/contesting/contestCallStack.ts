/** Manual assistance only: this module never tunes, transmits, scores, or reserves serials. */
export type CallStackScope = { sessionID: string; workspaceGeneration: string };
export type CallStackFragment = { value: string; source: "heard" };
export type CallStackItem = { id: string; revision: number; callsign: string;
  fragments: Record<string, CallStackFragment> };
export type CallStackDraft = CallStackScope & { draftID: string; revision: number;
  fields: Record<string, string>; defaults: Record<string, string>;
  /** Actual received field roles; excludes every station-sent/allocated field. */
  receivedFieldIDs?: string[];
  /** Current values explicitly typed/heard by the operator; excludes inferred/history values. */
  heardFieldIDs: string[] };
export type CallStackDecision = "swap" | "park" | "discard";
export type CallStackOperation = { kind: "commit" | "load"; operationID: string;
  draft: CallStackDraft; fields: Record<string, string> };
export type CallStackResult = { operationID: string; draft: CallStackDraft; qsoID?: string };
type Transition = { item: CallStackItem; outgoing?: CallStackItem; decision: CallStackDecision };
type Pending = { phase: "commit"; operation: CallStackOperation; transition: Transition }
  | { phase: "committed"; draft: CallStackDraft; transition: Transition }
  | { phase: "load"; operation: CallStackOperation; transition: Transition; afterCommit?: boolean };
export type CallStackState = CallStackScope & { schemaVersion: 1; revision: number;
  items: CallStackItem[]; selectedID: string | null; pending: Pending | null };
export type CallStackClassification = { itemID: string; itemRevision: number; scope: string;
  state: "clear" | "duplicate" | "unknown"; reason: string };
export type CallStackPorts = {
  getDraft(): CallStackDraft;
  /** Resolve only after the existing host has returned its durable result. */
  mutate(operation: CallStackOperation): Promise<CallStackResult>;
  receipt(operation: CallStackOperation): Promise<CallStackResult | null>;
  /** Must persist synchronously before returning; an error prevents host mutation. */
  persist(state: CallStackState): void;
  /** True only for a definitive host rejection; transport errors remain uncertain. */
  rejected(cause: unknown): boolean;
  changed?(state: CallStackState): void;
  id?(): string;
};
const sameScope = (a: CallStackScope, b: CallStackScope) => a.sessionID === b.sessionID && a.workspaceGeneration === b.workspaceGeneration;
const normalizedCall = (value: string) => value.trim().toUpperCase();
export const partialStackCall = (call: string) => call.includes("?");
export function emptyCallStack(scope: CallStackScope): CallStackState {
  return { ...scope, schemaVersion: 1, revision: 0, items: [], selectedID: null, pending: null };
}
export function callStackStorageKey(scope: CallStackScope) {
  return `xlog.contest.call-stack.v1/${scope.workspaceGeneration}/${scope.sessionID}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is Record<string, string> {
  return record(value) && Object.values(value).every(item => typeof item === "string");
}
function validItem(value: unknown): value is CallStackItem {
  if (!record(value) || typeof value.id !== "string" || !value.id || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
      typeof value.callsign !== "string" || !/^[A-Z0-9/?]{1,32}$/.test(value.callsign) || !record(value.fragments)) return false;
  return Object.entries(value.fragments).every(([key, fragment]) => !["callsign", "sent"].includes(key) &&
    record(fragment) && fragment.source === "heard" && typeof fragment.value === "string" && fragment.value.length <= 128);
}
function validDraft(value: unknown): value is CallStackDraft {
  return record(value) && typeof value.sessionID === "string" && typeof value.workspaceGeneration === "string" &&
    typeof value.draftID === "string" && Number.isSafeInteger(value.revision) && strings(value.fields) && strings(value.defaults) &&
    Array.isArray(value.heardFieldIDs) && value.heardFieldIDs.every(id => typeof id === "string") &&
    (value.receivedFieldIDs === undefined || Array.isArray(value.receivedFieldIDs) && value.receivedFieldIDs.every(id => typeof id === "string"));
}
/** Malformed/stale storage is surfaced, never silently replaced with an empty queue. */
export function restoreCallStack(raw: string | null, scope: CallStackScope): CallStackState {
  if (raw === null) return emptyCallStack(scope);
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("Call Stack recovery data is unreadable; preserve it before continuing."); }
  const fail = () => { throw new Error("Call Stack recovery data does not match this contest; preserve it before continuing."); };
  if (!record(value) || value.schemaVersion !== 1 || !sameScope(value as CallStackState, scope) ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.items) || value.items.length > 128 ||
      !value.items.every(validItem) || new Set(value.items.map(item => item.id)).size !== value.items.length ||
      !(value.selectedID === null || typeof value.selectedID === "string" && value.items.some(item => item.id === value.selectedID))) return fail();
  if (value.pending !== null) {
    const pending = value.pending;
    if (!record(pending) || !["commit", "committed", "load"].includes(String(pending.phase)) || !record(pending.transition) ||
        !validItem(pending.transition.item) || !["swap", "park", "discard"].includes(String(pending.transition.decision)) ||
        pending.transition.outgoing !== undefined && !validItem(pending.transition.outgoing) ||
        pending.afterCommit !== undefined && typeof pending.afterCommit !== "boolean") return fail();
    const transition = pending.transition as unknown as Transition;
    if (!value.items.some(item => item.id === transition.item.id && item.revision === transition.item.revision)) return fail();
    const operation = pending.operation;
    if (pending.phase === "committed") { if (!validDraft(pending.draft) || !sameScope(pending.draft, scope)) return fail(); }
    else if (!record(operation) || operation.kind !== pending.phase || typeof operation.operationID !== "string" ||
      !operation.operationID || !validDraft(operation.draft) || !sameScope(operation.draft, scope) || !strings(operation.fields)) return fail();
  }
  return value as unknown as CallStackState;
}
/** Only explicitly heard receiver fields travel; sent values always come from the active host draft. */
export function stackItemFields(item: CallStackItem, draft: CallStackDraft) {
  const fields: Record<string, string> = { ...draft.defaults, callsign: item.callsign };
  for (const [id, fragment] of Object.entries(item.fragments))
    if ((draft.receivedFieldIDs ?? draft.heardFieldIDs).includes(id) && !["sent", "callsign"].includes(id)) fields[id] = fragment.value;
  return fields;
}
export function occupiedStackDraft(draft: CallStackDraft) {
  return !!normalizedCall(draft.fields.callsign ?? "") || (draft.receivedFieldIDs ?? draft.heardFieldIDs).some(id =>
    (draft.fields[id] ?? "").trim() !== (draft.defaults[id] ?? "").trim());
}
export function currentStackClassification(item: CallStackItem, scope: string, values: CallStackClassification[]) {
  return values.find(value => value.itemID === item.id && value.itemRevision === item.revision && value.scope === scope);
}
export class ContestCallStack {
  private state: CallStackState;
  private active = false;
  private readonly id: () => string;
  constructor(state: CallStackState, private readonly ports: CallStackPorts) {
    this.state = restoreCallStack(JSON.stringify(state), state); this.id = ports.id ?? (() => crypto.randomUUID());
  }
  snapshot() { return structuredClone(this.state); }
  private save(next: CallStackState) {
    const durable = structuredClone({ ...next, revision: this.state.revision + 1 });
    this.ports.persist(durable); this.state = durable; this.ports.changed?.(this.snapshot());
  }
  private editable() {
    if (this.active || this.state.pending) throw new Error("Resolve the pending Call Stack operation before changing the queue.");
  }
  private draft() {
    const draft = this.ports.getDraft();
    if (!sameScope(draft, this.state)) throw new Error("Call Stack belongs to another contest workspace.");
    return structuredClone(draft);
  }
  private makeItem(callsign: string, fields: Record<string, string> = {}, heardFieldIDs: string[] = []): CallStackItem {
    const call = normalizedCall(callsign);
    if (!/^[A-Z0-9/?]{1,32}$/.test(call)) throw new Error("Enter a heard callsign or partial call using ?.");
    const fragments: Record<string, CallStackFragment> = {};
    for (const id of heardFieldIDs) if (!["callsign", "sent"].includes(id) && fields[id]?.trim())
      fragments[id] = { value: fields[id].trim().slice(0, 128), source: "heard" };
    return { id: this.id(), revision: 0, callsign: call, fragments };
  }
  add(callsign: string, fields: Record<string, string> = {}, heardFieldIDs: string[] = []) {
    this.editable(); if (this.state.items.length >= 128) throw new Error("Call Stack is full; remove a caller before adding another.");
    const item = this.makeItem(callsign, fields, heardFieldIDs);
    this.save({ ...this.state, items: [...this.state.items, item], selectedID: item.id }); return item.id;
  }
  select(id: string) { this.editable(); this.item(id); this.save({ ...this.state, selectedID: id }); }
  private item(id: string) {
    const item = this.state.items.find(value => value.id === id); if (!item) throw new Error("The queued caller is no longer available."); return item;
  }
  promote(id: string) { this.editable(); const item = this.item(id);
    this.save({ ...this.state, items: [item, ...this.state.items.filter(value => value.id !== id)], selectedID: id }); }
  remove(id: string) { this.editable(); this.item(id); const items = this.state.items.filter(value => value.id !== id);
    this.save({ ...this.state, items, selectedID: this.state.selectedID === id ? items[0]?.id ?? null : this.state.selectedID }); }
  private transition(id: string, draft: CallStackDraft, decision?: CallStackDecision): Transition {
    const item = structuredClone(this.item(id)), occupied = occupiedStackDraft(draft);
    if (occupied && !decision) throw new Error("Entry contains a caller or exchange. Choose Swap, Park, or Discard explicitly.");
    const choice = decision ?? "discard";
    if (occupied && choice !== "discard" && !normalizedCall(draft.fields.callsign ?? ""))
      throw new Error("Add a callsign to the current exchange before parking it, or explicitly discard it.");
    if (occupied && choice === "park" && this.state.items.length >= 128) throw new Error("Call Stack is full; use Swap or remove a caller first.");
    return { item, decision: choice, ...(occupied && choice !== "discard"
      ? { outgoing: this.makeItem(draft.fields.callsign, draft.fields, draft.heardFieldIDs) } : {}) };
  }
  async load(id: string, decision?: CallStackDecision) {
    this.editable(); const draft = this.draft(), transition = this.transition(id, draft, decision);
    await this.performLoad(draft, transition);
  }
  async logAndNext() {
    this.editable(); const draft = this.draft(), item = this.state.items[0];
    if (!item) throw new Error("Add a caller to Call Stack first.");
    if (!normalizedCall(draft.fields.callsign ?? "") || partialStackCall(draft.fields.callsign))
      throw new Error("Complete the current callsign before logging; partial calls are assistance only.");
    const operation: CallStackOperation = { kind: "commit", operationID: this.id(), draft, fields: { ...draft.fields } };
    this.save({ ...this.state, pending: { phase: "commit", operation, transition: { item: structuredClone(item), decision: "discard" } } });
    await this.execute(operation);
  }
  private async performLoad(draft: CallStackDraft, transition: Transition, afterCommit = false) {
    const operation: CallStackOperation = { kind: "load", operationID: this.id(), draft, fields: stackItemFields(transition.item, draft) };
    this.save({ ...this.state, pending: { phase: "load", operation, transition, afterCommit } }); await this.execute(operation);
  }
  private async execute(operation: CallStackOperation) {
    this.active = true;
    try { await this.confirm(await this.ports.mutate(structuredClone(operation))); }
    catch (cause) {
      if (this.ports.rejected(cause) && this.state.pending?.phase === operation.kind) {
        const pending = this.state.pending;
        this.save({ ...this.state, pending: pending.phase === "load" && pending.afterCommit
          ? { phase: "committed", draft: pending.operation.draft, transition: pending.transition } : null });
      }
      throw cause;
    } finally { this.active = false; }
  }
  private async confirm(result: CallStackResult) {
    const pending = this.state.pending;
    if (!pending || pending.phase === "committed" || result.operationID !== pending.operation.operationID ||
        !sameScope(result.draft, this.state) || result.draft.revision <= pending.operation.draft.revision)
      throw new Error("The Call Stack receipt does not match the pending operation; retain it for recovery.");
    if (pending.phase === "commit") {
      if (!result.qsoID || result.draft.draftID === pending.operation.draft.draftID)
        throw new Error("The contact save has no confirmed durable contact and next draft; check its original receipt.");
      this.save({ ...this.state, pending: { phase: "committed", draft: result.draft, transition: pending.transition } });
      await this.continueCommitted(); return;
    }
    if (result.draft.draftID !== pending.operation.draft.draftID ||
        Object.entries(pending.operation.fields).some(([id, value]) => result.draft.fields[id] !== value))
      throw new Error("The loaded draft does not match the queued caller; retain the queue for recovery.");
    const { transition } = pending, items = this.state.items.flatMap(item => item.id !== transition.item.id ? [item]
      : transition.decision === "swap" && transition.outgoing ? [transition.outgoing] : []);
    if (transition.decision === "park" && transition.outgoing) items.push(transition.outgoing);
    this.save({ ...this.state, items, selectedID: items[0]?.id ?? null, pending: null });
  }
  private async continueCommitted() {
    const pending = this.state.pending; if (!pending || pending.phase !== "committed") return;
    const current = this.draft();
    if (current.draftID !== pending.draft.draftID || current.revision !== pending.draft.revision || occupiedStackDraft(current))
      throw new Error("The contact is saved. Entry changed before loading next; keep the queue and resolve it explicitly.");
    await this.performLoad(current, pending.transition, true);
  }
  /** Read the original receipt first. A deliberate retry uses the identical operation ID and payload. */
  async recover(retryMissing = false) {
    if (this.active) throw new Error("Call Stack is busy.");
    const pending = this.state.pending; if (!pending) return;
    if (pending.phase === "committed") { await this.continueCommitted(); return; }
    this.active = true;
    try {
      const result = await this.ports.receipt(structuredClone(pending.operation));
      if (result) await this.confirm(result);
      else if (retryMissing) await this.execute(pending.operation);
      else throw new Error("The original operation is still unconfirmed. Entry and queue are preserved; retry only this operation.");
    } finally { this.active = false; }
  }
  /** After a confirmed save, leave the current entry alone and release the retained queue for manual loading. */
  keepQueueAfterSavedContact() {
    if (this.active || this.state.pending?.phase !== "committed") throw new Error("Confirm the contact save receipt before releasing its queue.");
    this.save({ ...this.state, pending: null });
  }
}
