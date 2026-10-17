import type {
  ContestCommitResult, ContestCreateInput, ContestCreateResult, ContestDraftFields, ContestDraftResult,
  ContestLogPage, ContestMethod, ContestMutationScope, ContestOpenResult, ContestOperationReceiptResult,
  ContestRequest, ContestRuleMetadata, ContestScore, ContestSessionSummary, ContestWorkerError,
} from "./types";

type IDFactory = () => string;
type DigestFactory = (payload: unknown) => Promise<string>;
export type ContestOperationState = "inflight" | "uncertain" | "confirmed";
export type ContestOperationObserver = (operation: ContestMutation, state: ContestOperationState) => void;
const BANDS = new Set(["160m", "80m", "40m", "20m", "15m", "10m"]);

export function canonicalJSON(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Contest requests require finite numbers.");
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new Error("Contest request contains an unsupported value.");
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(payload: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure contest request identity is unavailable.");
  const bytes = new TextEncoder().encode(canonicalJSON(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function defaultID() { if (!globalThis.crypto?.randomUUID) throw new Error("Secure contest request identity is unavailable."); return globalThis.crypto.randomUUID(); }
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown, max = 256, allowEmpty = false): value is string {
  return typeof value === "string" && new TextEncoder().encode(value).length <= max && (allowEmpty || value.length > 0);
}
function uint(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function iso(value: unknown): value is string { return text(value, 64) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().length > 0; }
function utcOperationISO(value: unknown): value is string { return iso(value) && new Date(value).toISOString() === value; }
function sameContext(item: Record<string, unknown>, params: Record<string, unknown>) { return item.sessionID === params.sessionID && item.workspaceGeneration === params.workspaceGeneration; }

function validIdentity(value: unknown) {
  const v = object(value);
  return !!v && (v.id === "cq-ww-cw" || v.id === "cq-wpx-cw") && text(v.version, 64) && text(v.edition, 32) && text(v.sourceRevision, 160);
}
function validRule(value: unknown) {
  const v = object(value);
  return !!v && validIdentity(v.identity) && (v.displayName === "CQ WW CW" || v.displayName === "CQ WPX CW") && v.mode === "CW" &&
    text(v.referenceDataVersion, 160) && text(v.sourceNote, 512) && ["verified", "provisional", "unverified"].includes(String(v.sourceVerification));
}
function validSession(value: unknown, params?: Record<string, unknown>) {
  const v = object(value), station = object(v?.station), operator = object(v?.operator);
  return !!v && text(v.sessionID, 128) && text(v.workspaceGeneration, 128) && (!params || sameContext(v, params)) && uint(v.revision) &&
    text(v.name, 128) && validRule(v.rule) && text(v.referenceDataVersion, 160) && !!station && text(station.callsign, 32) && text(station.cqZone, 8) &&
    text(station.dxccEntity, 160) && !!operator && text(operator.callsign, 32) && text(operator.category, 80) && uint(v.qsoCount) && iso(v.updatedAt);
}
export function validateDraftFields(value: unknown): asserts value is ContestDraftFields {
  const v = object(value);
  if (!v || !text(v.callsign, 32, true) || !text(v.sentReport, 3, true) || !text(v.sentExchange, 32, true) ||
      !text(v.receivedReport, 3, true) || !text(v.receivedExchange, 32, true) || !text(v.band, 8) || !BANDS.has(v.band) || v.mode !== "CW" ||
      !(v.frequencyHz === null || uint(v.frequencyHz) && (v.frequencyHz as number) <= 100_000_000_000)) throw new Error("Contest draft contains an invalid or oversized field.");
}
function validDraft(value: unknown, params: Record<string, unknown>, expectedDraftID?: unknown) {
  const v = object(value), validation = object(v?.validation), dupe = object(v?.dupe);
  try { validateDraftFields(v?.fields); } catch { return false; }
  return !!v && text(v.draftID, 128) && (!expectedDraftID || v.draftID === expectedDraftID) && sameContext(v, params) && uint(v.revision) &&
    (v.reservedSerial === null || uint(v.reservedSerial)) && !!validation && Array.isArray(validation.errors) && validation.errors.length <= 32 &&
    validation.errors.every(x => text(x, 512, true)) && Array.isArray(validation.warnings) && validation.warnings.length <= 32 && validation.warnings.every(x => text(x, 512, true)) &&
    !!dupe && ["clear", "duplicate", "unchecked"].includes(String(dupe.state)) && text(dupe.reason, 512, true) && iso(v.updatedAt);
}
function validReceipt(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && v.requestID === params.requestID && v.payloadDigest === params.payloadDigest && text(v.requestID, 128) && text(v.payloadDigest, 512) && uint(v.committedRevision) && iso(v.committedAt);
}
function validQSO(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && v.sessionID === params.sessionID && text(v.qsoID, 128) && iso(v.workedAt) && text(v.callsign, 32) && text(v.band, 8) && BANDS.has(v.band) &&
    v.mode === "CW" && text(v.sentExchange, 32, true) && text(v.receivedExchange, 32, true) && uint(v.points) && (v.multiplier === null || text(v.multiplier, 160)) && typeof v.isDupe === "boolean";
}
function validScoreSummary(value: unknown, params: Record<string, unknown>, expectedRevision?: number) {
  const v = object(value);
  return !!v && sameContext(v, params) && uint(v.revision) && (expectedRevision === undefined || v.revision === expectedRevision) && uint(v.qsos) && uint(v.points) &&
    uint(v.multipliers) && uint(v.claimedScore) && ["verified", "provisional", "unverified"].includes(String(v.sourceVerification));
}
function validScore(value: unknown, params: Record<string, unknown>, expectedRevision?: number) {
  const v = object(value);
  return validScoreSummary(value, params, expectedRevision) && !!v && Array.isArray(v.multiplierLabels) && v.multiplierLabels.length <= 10_000 && v.multiplierLabels.every(x => text(x, 160));
}

function validateResult<T>(method: ContestMethod, value: unknown, params: Record<string, unknown>): T {
  const v = object(value); let valid = false;
  if (method === "contest_catalog") valid = !!v && text(v.workspaceGeneration, 128) && Array.isArray(v.rules) && v.rules.length <= 2 && v.rules.every(validRule);
  else if (method === "contest_sessions") valid = !!v && Array.isArray(v.sessions) && v.sessions.length <= 1_000 && v.sessions.every(x => validSession(x));
  else if (method === "contest_open" || method === "contest_draft_get") {
    const s = object(v?.session); valid = !!v && validSession(s, params) && s?.sessionID === params.sessionID && validDraft(v.draft, s!, undefined) && object(v.draft)?.revision === s?.revision;
  } else if (["contest_create", "contest_draft_apply", "contest_serial_reserve", "contest_qso_commit"].includes(method)) {
    const s = object(v?.session), d = object(v?.draft), receipt = object(v?.receipt);
    valid = !!v && validSession(s, params) && validDraft(d, params, params.draftID) && validReceipt(receipt, params) && s?.revision === d?.revision && s?.revision === receipt?.committedRevision;
    if (valid && method === "contest_create") valid = params.expectedRevision === 0 && s?.sessionID === params.sessionID;
    if (valid && method === "contest_qso_commit") valid = validQSO(v!.qso, params) && validScoreSummary(v!.score, params, s?.revision as number) && !("multiplierLabels" in object(v!.score)!);
  } else if (method === "contest_operation_receipt") valid = !!v && (v.status === "not_found" || v.status === "committed" && validReceipt(v.receipt, params));
  else if (method === "contest_log_page") valid = !!v && sameContext(v, params) && v.revision === params.expectedRevision && Array.isArray(v.qsos) && v.qsos.length <= 200 && v.qsos.every(x => validQSO(x, params)) && uint(v.total) && v.offset === params.offset && v.limit === params.limit;
  else if (method === "contest_score") valid = validScore(v, params, params.expectedRevision as number);
  if (!valid) throw new Error(`Malformed or stale ${method} response.`);
  return value as T;
}

export type ContestMutation = { method: "contest_create" | "contest_draft_apply" | "contest_serial_reserve" | "contest_qso_commit"; scope: ContestMutationScope; payload: Record<string, unknown> };
export class ContestServerError extends Error {
  constructor(readonly code: string, message: string, readonly outcome: "confirmed" | "uncertain") { super(message); this.name = "ContestServerError"; }
}
export class ContestMutationUncertain extends Error {
  constructor(readonly operation: ContestMutation, readonly cause: unknown) { super("The save reply was not confirmed. Check the original operation receipt before continuing."); this.name = "ContestMutationUncertain"; }
}

export class ContestClient {
  constructor(private readonly request: ContestRequest, private readonly createID: IDFactory = defaultID, private readonly digest: DigestFactory = sha256, private readonly observeOperation?: ContestOperationObserver, private readonly now: () => string = () => new Date().toISOString()) {}
  private async read<T>(method: ContestMethod, params: Record<string, unknown> = {}) {
    const response = await this.request<T>(method, params);
    if (!response.ok) { const e: ContestWorkerError = response.error; throw new ContestServerError(e.code || "contest_rejected", e.message || `${method} failed.`, e.outcome === "uncertain" ? "uncertain" : "confirmed"); }
    return validateResult<T>(method, response.result, params);
  }
  catalog() { return this.read<{ workspaceGeneration: string; rules: ContestRuleMetadata[] }>("contest_catalog"); }
  sessions() { return this.read<{ sessions: ContestSessionSummary[] }>("contest_sessions"); }
  open(sessionID: string, workspaceGeneration: string) { return this.read<ContestOpenResult>("contest_open", { sessionID, workspaceGeneration }); }
  draft(session: ContestSessionSummary) { return this.read<ContestOpenResult>("contest_draft_get", { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration }); }
  logPage(session: ContestSessionSummary, offset: number, limit: number) { return this.read<ContestLogPage>("contest_log_page", { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, expectedRevision: session.revision, offset, limit }); }
  score(session: ContestSessionSummary) { return this.read<ContestScore>("contest_score", { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, expectedRevision: session.revision }); }
  private async mutate<T>(operation: ContestMutation): Promise<T> {
    this.observeOperation?.(operation, "inflight");
    try {
      const result = await this.read<T>(operation.method, { ...operation.scope, payload: operation.payload });
      this.observeOperation?.(operation, "confirmed");
      return result;
    }
    catch (cause) {
      if (cause instanceof ContestServerError && cause.outcome === "confirmed") { this.observeOperation?.(operation, "confirmed"); throw cause; }
      this.observeOperation?.(operation, "uncertain");
      throw new ContestMutationUncertain(operation, cause);
    }
  }
  private async operation(method: ContestMutation["method"], sessionID: string, workspaceGeneration: string, expectedRevision: number, payload: Record<string, unknown>, draftID?: string) {
    canonicalJSON(payload);
    const operationTimestamp = this.now();
    if (!utcOperationISO(operationTimestamp)) throw new Error("Contest operation timestamp must be a canonical UTC ISO timestamp.");
    const scope: ContestMutationScope = { sessionID, workspaceGeneration, requestID: this.createID(), expectedRevision, ...(draftID ? { draftID } : {}), payloadDigest: await this.digest(payload), operationTimestamp };
    return { method, scope, payload } as ContestMutation;
  }
  async create(workspaceGeneration: string, input: ContestCreateInput) {
    validateCreateInput(input);
    const sessionID = this.createID();
    const operation = await this.operation("contest_create", sessionID, workspaceGeneration, 0, { sessionID, ...input });
    return this.mutate<ContestCreateResult>(operation);
  }
  async applyDraft(session: ContestSessionSummary, draftID: string, fields: ContestDraftFields) { validateDraftFields(fields); return this.mutate<ContestDraftResult>(await this.operation("contest_draft_apply", session.sessionID, session.workspaceGeneration, session.revision, { fields }, draftID)); }
  async reserveSerial(session: ContestSessionSummary, draftID: string) { return this.mutate<ContestDraftResult>(await this.operation("contest_serial_reserve", session.sessionID, session.workspaceGeneration, session.revision, {}, draftID)); }
  async commitQSO(session: ContestSessionSummary, draftID: string) { return this.mutate<ContestCommitResult>(await this.operation("contest_qso_commit", session.sessionID, session.workspaceGeneration, session.revision, {}, draftID)); }
  retry(operation: ContestMutation) { canonicalJSON(operation.payload); if (!utcOperationISO(operation.scope.operationTimestamp)) throw new Error("Contest operation timestamp must be a canonical UTC ISO timestamp."); return this.mutate<ContestCreateResult | ContestDraftResult | ContestCommitResult>(operation); }
  receipt(operation: ContestMutation) { const { sessionID, workspaceGeneration, requestID, payloadDigest } = operation.scope; return this.read<ContestOperationReceiptResult>("contest_operation_receipt", { sessionID, workspaceGeneration, requestID, payloadDigest }); }
}

export function validateCreateInput(input: ContestCreateInput) {
  if (!text(input.name, 128) || !validIdentity(input.ruleIdentity) || !text(input.referenceDataVersion, 160) ||
      !text(input.station.callsign, 32) || !text(input.station.cqZone, 8) || !text(input.station.dxccEntity, 160) ||
      !text(input.operator.callsign, 32) || !text(input.operator.category, 80)) throw new Error("Contest session contains an invalid or oversized field.");
}
