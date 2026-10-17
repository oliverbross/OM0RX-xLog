import type {
  ContestCommitResult, ContestCreateInput, ContestCreateResult, ContestDraftFields, ContestDraftResult,
  ContestExportChunk, ContestExportPrepareRequest, ContestExportReadRequest, ContestExportReleaseResult,
  ContestFullQSO, ContestLogPage, ContestMethod, ContestMutationScope, ContestOpenResult, ContestOperationReceiptResult, ContestPreparedExport,
  ContestQSOChangeResult, ContestQSOReadResult, ContestRequest, ContestRuleMetadata, ContestScore, ContestSessionSummary, ContestWorkerError,
} from "./types";

type IDFactory = () => string;
type DigestFactory = (payload: unknown) => Promise<string>;
export type ContestOperationState = "inflight" | "uncertain" | "confirmed";
export type ContestOperationObserver = (operation: ContestMutation, state: ContestOperationState) => void;
const BANDS = new Set(["160m", "80m", "40m", "20m", "15m", "10m"]);
const MAX_EXPORT_BYTES = 32 * 1_024 * 1_024;
const MAX_EXPORT_CHUNK = 64 * 1_024;
const MAX_EXPORT_BASE64 = 4 * Math.ceil(MAX_EXPORT_CHUNK / 3);
const SHA256 = /^[0-9a-f]{64}$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(key => key in value); }
function iso(value: unknown): value is string { return text(value, 64) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().length > 0; }
function utcOperationISO(value: unknown): value is string { return iso(value) && new Date(value).toISOString() === value; }
function sameContext(item: Record<string, unknown>, params: Record<string, unknown>) { return item.sessionID === params.sessionID && item.workspaceGeneration === params.workspaceGeneration; }
function validExportCoordinate(value: Record<string, unknown>, params: Record<string, unknown>) {
  return value.artifactID === params.exportID && value.sessionID === params.sessionID && value.workspaceGeneration === params.workspaceGeneration;
}
function validExportPrepareRequest(value: ContestExportPrepareRequest) {
  const request = object(value), header = object(request?.header);
  const requiredHeader = ["callsign", "categoryOperator", "categoryAssisted", "categoryBand", "categoryMode",
    "categoryTransmitter", "categoryPower", "operators", "location", "name", "addressLines", "email"];
  const allowedHeader = new Set([...requiredHeader, "categoryOverlay", "club"]);
  return !!request && exact(request, ["exportID", "sessionID", "workspaceGeneration", "expectedRevision", "generatedAtUTC", "format", "header"]) &&
    LOWER_UUID.test(String(request.exportID)) && LOWER_UUID.test(String(request.sessionID)) && LOWER_UUID.test(String(request.workspaceGeneration)) &&
    uint(request.expectedRevision) && utcOperationISO(request.generatedAtUTC) && ["cabrillo", "adif"].includes(String(request.format)) && !!header &&
    requiredHeader.every(key => key in header) && Object.keys(header).every(key => allowedHeader.has(key)) &&
    text(header.callsign, 32) && text(header.categoryOperator, 32) && text(header.categoryAssisted, 32) &&
    text(header.categoryBand, 16) && text(header.categoryMode, 16) && text(header.categoryTransmitter, 32) &&
    text(header.categoryPower, 16) && (header.categoryOverlay === undefined || text(header.categoryOverlay, 64, true)) &&
    Array.isArray(header.operators) && header.operators.length <= 16 && header.operators.every(value => text(value, 32)) &&
    text(header.location, 64) && (header.club === undefined || text(header.club, 128, true)) && text(header.name, 75) &&
    Array.isArray(header.addressLines) && header.addressLines.length <= 8 && header.addressLines.every(value => text(value, 160)) &&
    text(header.email, 254, true);
}
function validPreparedExport(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && exact(v, ["artifactID", "sessionID", "workspaceGeneration", "revision", "format", "inputSchemaVersion",
    "formatterVersion", "generatedAtUTC", "qsoCount", "totalPoints", "multiplierCount", "claimedScore", "byteLength",
    "sha256", "chunkLimit", "expiresAfterSeconds"]) && validExportCoordinate(v, params) && v.revision === params.expectedRevision &&
    v.format === params.format && v.generatedAtUTC === params.generatedAtUTC && text(v.inputSchemaVersion, 64) &&
    text(v.formatterVersion, 64) && uint(v.qsoCount) && uint(v.totalPoints) && uint(v.multiplierCount) && uint(v.claimedScore) &&
    uint(v.byteLength) && (v.byteLength as number) <= MAX_EXPORT_BYTES && text(v.sha256, 64) && SHA256.test(v.sha256 as string) &&
    uint(v.chunkLimit) && (v.chunkLimit as number) > 0 && (v.chunkLimit as number) <= MAX_EXPORT_CHUNK &&
    uint(v.expiresAfterSeconds) && (v.expiresAfterSeconds as number) > 0;
}
function validExportChunk(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && exact(v, ["artifactID", "sessionID", "workspaceGeneration", "revision", "offset", "dataBase64", "eof", "byteLength", "sha256"]) &&
    validExportCoordinate(v, params) && uint(v.revision) && v.offset === params.offset && text(v.dataBase64, MAX_EXPORT_BASE64, true) &&
    typeof v.eof === "boolean" && uint(v.byteLength) && (v.byteLength as number) <= MAX_EXPORT_BYTES &&
    text(v.sha256, 64) && SHA256.test(v.sha256 as string);
}

function validIdentity(value: unknown) {
  const v = object(value);
  return !!v && ["cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb"].includes(String(v.id)) &&
    text(v.version, 64) && text(v.edition, 32) && text(v.sourceRevision, 160);
}
function validEntry(value: unknown) {
  const v = object(value), report = object(v?.report), exchange = object(v?.exchange), serial = object(v?.serial);
  if (!v || !report || !exchange || !serial ||
      !exact(v, ["mode", "adifMode", "cabrilloQSOType", "cabrilloFormatterVersion", "cabrilloProjectionFormatterVersion", "report", "exchange", "serial"]) ||
      !exact(report, ["format", "defaultSent", "defaultReceived", "maximumUTF8Bytes"]) ||
      !exact(exchange, ["sent", "received", "sentDefault", "adifFields"]) ||
      !exact(serial, ["requirement", "allowedScopes"]) || !Array.isArray(serial.allowedScopes)) return false;
  const cw = v.mode === "CW" && v.adifMode === "CW" && v.cabrilloQSOType === "CW" &&
    v.cabrilloFormatterVersion === "pilot-1" && v.cabrilloProjectionFormatterVersion === "pilot-2" &&
    report.format === "cwRST" && report.defaultSent === "599" && report.defaultReceived === "599" && report.maximumUTF8Bytes === 3;
  const ssb = v.mode === "SSB" && v.adifMode === "SSB" && v.cabrilloQSOType === "PH" &&
    v.cabrilloFormatterVersion === "ssb-pilot-1" && v.cabrilloProjectionFormatterVersion === "ssb-pilot-2" &&
    report.format === "phoneRS" && report.defaultSent === "59" && report.defaultReceived === "59" && report.maximumUTF8Bytes === 2;
  const zone = exchange.sent === "cqZone" && exchange.received === "cqZone" && exchange.sentDefault === "stationSnapshot" &&
    exchange.adifFields === "none" && serial.requirement === "none" && serial.allowedScopes.length === 0;
  const serialEntry = exchange.sent === "serialNumber" && exchange.received === "serialNumber" && exchange.sentDefault === "reservedSerial" &&
    exchange.adifFields === "stxSrx" && serial.requirement === "requiredForCommit" &&
    canonicalJSON(serial.allowedScopes) === '["session","band","transmitter"]';
  return (cw || ssb) && (zone || serialEntry);
}
function validRule(value: unknown) {
  const v = object(value);
  const identity = object(v?.identity), entry = object(v?.entry), exchange = object(entry?.exchange), serial = object(entry?.serial);
  const names: Record<string, string> = { "cq-ww-cw": "CQ WW CW", "cq-wpx-cw": "CQ WPX CW", "cq-ww-ssb": "CQ WW SSB", "cq-wpx-ssb": "CQ WPX SSB" };
  const id = String(identity?.id), expectedMode = id.endsWith("-ssb") ? "SSB" : "CW", expectsSerial = id.startsWith("cq-wpx-");
  return !!v && exact(v, ["identity", "displayName", "mode", "entryDescriptorVersion", "entry", "referenceDataVersion", "sourceVerification", "sourceNote"]) &&
    validIdentity(identity) && v.displayName === names[id] && v.entryDescriptorVersion === 1 && validEntry(entry) && entry?.mode === v.mode && v.mode === expectedMode &&
    (expectsSerial ? serial?.requirement === "requiredForCommit" && exchange?.sent === "serialNumber" : serial?.requirement === "none" && exchange?.sent === "cqZone") &&
    text(v.referenceDataVersion, 160) && text(v.sourceNote, 512) && ["verified", "provisional", "unverified"].includes(String(v.sourceVerification));
}
function validSession(value: unknown, params?: Record<string, unknown>) {
  const v = object(value), station = object(v?.station), operator = object(v?.operator);
  return !!v && text(v.sessionID, 128) && text(v.workspaceGeneration, 128) && (!params || sameContext(v, params)) && uint(v.revision) &&
    text(v.name, 128) && validRule(v.rule) && text(v.referenceDataVersion, 160) && !!station && text(station.callsign, 32) && text(station.cqZone, 8) &&
    text(station.dxccEntity, 160) && !!operator && text(operator.callsign, 32) && text(operator.category, 80) && uint(v.qsoCount) && iso(v.updatedAt);
}
export function validateDraftFields(value: unknown, rule?: ContestRuleMetadata): asserts value is ContestDraftFields {
  const v = object(value);
  if (!v || !text(v.callsign, 32, true) || !text(v.sentReport, 3, true) || !text(v.sentExchange, 32, true) ||
      !text(v.receivedReport, 3, true) || !text(v.receivedExchange, 32, true) || !text(v.band, 8) || !BANDS.has(v.band) || !["CW", "SSB"].includes(String(v.mode)) ||
      !(v.frequencyHz === null || uint(v.frequencyHz) && (v.frequencyHz as number) <= 100_000_000_000)) throw new Error("Contest draft contains an invalid or oversized field.");
  if (rule && (v.mode !== rule.entry.mode || !text(v.sentReport, rule.entry.report.maximumUTF8Bytes, true) ||
      !text(v.receivedReport, rule.entry.report.maximumUTF8Bytes, true))) throw new Error("Contest draft does not match the selected rule entry descriptor.");
}
function validDraft(value: unknown, params: Record<string, unknown>, expectedDraftID?: unknown, rule?: ContestRuleMetadata) {
  const v = object(value), validation = object(v?.validation), dupe = object(v?.dupe);
  try { validateDraftFields(v?.fields, rule); } catch { return false; }
  return !!v && text(v.draftID, 128) && (!expectedDraftID || v.draftID === expectedDraftID) && sameContext(v, params) && uint(v.revision) &&
    (v.reservedSerial === null || uint(v.reservedSerial)) && !!validation && Array.isArray(validation.errors) && validation.errors.length <= 32 &&
    validation.errors.every(x => text(x, 512, true)) && Array.isArray(validation.warnings) && validation.warnings.length <= 32 && validation.warnings.every(x => text(x, 512, true)) &&
    !!dupe && ["clear", "duplicate", "unchecked"].includes(String(dupe.state)) && text(dupe.reason, 512, true) && iso(v.updatedAt);
}
function validReceipt(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && v.requestID === params.requestID && v.payloadDigest === params.payloadDigest && text(v.requestID, 128) && text(v.payloadDigest, 512) && uint(v.committedRevision) && iso(v.committedAt);
}
function validLogQSO(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && v.sessionID === params.sessionID && text(v.qsoID, 128) && iso(v.workedAt) && text(v.callsign, 32) && text(v.band, 8) && BANDS.has(v.band) &&
    ["CW", "SSB"].includes(String(v.mode)) && text(v.sentExchange, 32, true) && text(v.receivedExchange, 32, true) && uint(v.points) && (v.multiplier === null || text(v.multiplier, 160)) && typeof v.isDupe === "boolean";
}
function validEntity(value: unknown) {
  if (value === null) return true;
  const v = object(value);
  return !!v && exact(v, ["adif", "name", "countryPrefix", "continent", "cqZone"]) && uint(v.adif) && text(v.name, 128) &&
    text(v.countryPrefix, 16) && text(v.continent, 4) && uint(v.cqZone);
}
function validProvenance(value: unknown) {
  const v = object(value);
  return !!v && exact(v, ["source", "sourceIdentity", "importedClaimedScore"]) &&
    ["operatorEntry", "importFile", "digitalReceiver", "networkPeer"].includes(String(v.source)) &&
    (v.sourceIdentity === null || text(v.sourceIdentity, 160)) && (v.importedClaimedScore === null || uint(v.importedClaimedScore));
}
function validFullQSO(value: unknown, params: Record<string, unknown>, expectedQSOID?: unknown) {
  const v = object(value);
  if (!v || !exact(v, ["qsoID", "sessionID", "originalUTC", "callsign", "band", "mode", "frequencyHz", "sentReport", "receivedReport",
    "sentExchange", "normalizedSentExchange", "allocatedSerial", "receivedExchange", "normalizedReceivedExchange", "entity", "operatorCallsign",
    "stationLocation", "provenance", "ruleIdentity", "referenceDataVersion"])) return false;
  return v.sessionID === params.sessionID && (expectedQSOID === undefined || v.qsoID === expectedQSOID) && text(v.qsoID, 128) && iso(v.originalUTC) &&
    text(v.callsign, 32) && text(v.band, 8) && BANDS.has(v.band) && ["CW", "SSB"].includes(String(v.mode)) && uint(v.frequencyHz) && (v.frequencyHz as number) <= 100_000_000_000 &&
    text(v.sentReport, 3, true) && text(v.receivedReport, 3, true) && text(v.sentExchange, 64, true) && text(v.normalizedSentExchange, 64, true) &&
    text(v.allocatedSerial, 64, true) && v.allocatedSerial === v.normalizedSentExchange && text(v.receivedExchange, 64, true) &&
    text(v.normalizedReceivedExchange, 64, true) && validEntity(v.entity) && text(v.operatorCallsign, 32, true) && text(v.stationLocation, 128, true) &&
    validProvenance(v.provenance) && validIdentity(v.ruleIdentity) && text(v.referenceDataVersion, 160);
}
function validChangeSession(value: unknown, params: Record<string, unknown>) {
  const v = object(value);
  return !!v && exact(v, ["sessionID", "workspaceGeneration", "revision", "name", "ruleIdentity", "referenceDataVersion", "qsoCount", "updatedAt"]) &&
    sameContext(v, params) && uint(v.revision) && text(v.name, 128) && validIdentity(v.ruleIdentity) && text(v.referenceDataVersion, 160) && uint(v.qsoCount) && iso(v.updatedAt);
}
function validQSOChange(value: unknown, params: Record<string, unknown>, operation: "correction" | "deletion") {
  const v = object(value), s = object(v?.session), score = object(v?.score), receipt = object(v?.receipt), audit = object(v?.auditReference);
  const payload = object(params.payload), qso = object(payload?.qso), expectedQSOID = operation === "correction" ? qso?.qsoID : payload?.qsoID;
  if (!v || !s || !score || !receipt || !audit || !exact(v, ["session", "operation", "qsoID", "qsoCount", "score", "currentTarget", "auditReference", "receipt"]) ||
      v.operation !== operation || v.qsoID !== expectedQSOID || !text(v.qsoID, 128) || !uint(v.qsoCount) || !validChangeSession(s, params) ||
      s.qsoCount !== v.qsoCount || !validScoreSummary(score, params, s.revision as number) || "multiplierLabels" in score || score.qsos !== v.qsoCount ||
      !validReceipt(receipt, params) || receipt.committedRevision !== s.revision ||
      !exact(audit, ["sessionID", "qsoID", "requestID", "revision"]) || audit.sessionID !== params.sessionID || audit.qsoID !== v.qsoID ||
      audit.requestID !== params.requestID || audit.revision !== s.revision) return false;
  if (operation === "deletion") return v.currentTarget === null;
  const target = object(v.currentTarget);
  return validFullQSO(target, params, v.qsoID) && canonicalJSON(target!.ruleIdentity) === canonicalJSON(s.ruleIdentity) &&
    target!.referenceDataVersion === s.referenceDataVersion;
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
  if (method === "contest_catalog") valid = !!v && text(v.workspaceGeneration, 128) && Array.isArray(v.rules) && v.rules.length <= 4 && v.rules.every(validRule);
  else if (method === "contest_sessions") valid = !!v && Array.isArray(v.sessions) && v.sessions.length <= 1_000 && v.sessions.every(x => validSession(x));
  else if (method === "contest_open" || method === "contest_draft_get") {
    const s = object(v?.session), d = object(v?.draft); valid = !!v && validSession(s, params) && s?.sessionID === params.sessionID && validDraft(d, s!, undefined, s?.rule as ContestRuleMetadata) && d?.revision === s?.revision;
  } else if (["contest_create", "contest_draft_apply", "contest_serial_reserve", "contest_qso_commit"].includes(method)) {
    const s = object(v?.session), d = object(v?.draft), receipt = object(v?.receipt);
    valid = !!v && validSession(s, params) && validDraft(d, params, params.draftID, s?.rule as ContestRuleMetadata) && validReceipt(receipt, params) && s?.revision === d?.revision && s?.revision === receipt?.committedRevision;
    if (valid && method === "contest_create") valid = params.expectedRevision === 0 && s?.sessionID === params.sessionID;
    if (valid && method === "contest_qso_commit") valid = validLogQSO(v!.qso, params) && object(v!.qso)?.mode === object(s?.rule)?.mode && validScoreSummary(v!.score, params, s?.revision as number) && !("multiplierLabels" in object(v!.score)!);
  } else if (method === "contest_qso_get") {
    valid = !!v && exact(v, ["sessionID", "workspaceGeneration", "revision", "qso"]) && sameContext(v, params) && v.revision === params.expectedRevision && validFullQSO(v.qso, params, params.qsoID);
  } else if (method === "contest_qso_correct") {
    valid = validQSOChange(v, params, "correction");
  } else if (method === "contest_qso_delete") {
    valid = validQSOChange(v, params, "deletion");
  } else if (method === "contest_operation_receipt") valid = !!v && (v.status === "not_found" || v.status === "committed" && validReceipt(v.receipt, params));
  else if (method === "contest_log_page") valid = !!v && sameContext(v, params) && v.revision === params.expectedRevision && Array.isArray(v.qsos) && v.qsos.length <= 200 && v.qsos.every(x => validLogQSO(x, params)) && uint(v.total) && v.offset === params.offset && v.limit === params.limit;
  else if (method === "contest_score") valid = validScore(v, params, params.expectedRevision as number);
  else if (method === "contest_export_prepare") valid = validPreparedExport(v, params);
  else if (method === "contest_export_read") valid = validExportChunk(v, params);
  else if (method === "contest_export_release") valid = !!v && exact(v, ["artifactID", "released"]) && v.artifactID === params.exportID && typeof v.released === "boolean";
  if (!valid) throw new Error(`Malformed or stale ${method} response.`);
  return value as T;
}

export type ContestMutation = { method: "contest_create" | "contest_draft_apply" | "contest_serial_reserve" | "contest_qso_commit" | "contest_qso_correct" | "contest_qso_delete"; scope: ContestMutationScope; payload: Record<string, unknown> };
export class ContestServerError extends Error {
  constructor(readonly code: string, message: string, readonly outcome: "confirmed" | "uncertain") { super(message); this.name = "ContestServerError"; }
}
export class ContestMutationUncertain extends Error {
  constructor(readonly operation: ContestMutation, readonly cause: unknown) { super("The save reply was not confirmed. Check the original operation receipt before continuing."); this.name = "ContestMutationUncertain"; }
}

function decodeBase64(value: string, expectedLength: number): Uint8Array {
  if (!globalThis.atob || !globalThis.btoa || value.length !== 4 * Math.ceil(expectedLength / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Contest export chunk encoding is invalid.");
  }
  const binary = globalThis.atob(value);
  if (globalThis.btoa(binary) !== value || binary.length > expectedLength) throw new Error("Contest export chunk encoding is invalid.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure contest export verification is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
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
  qso(session: ContestSessionSummary, qsoID: string) { return this.read<ContestQSOReadResult>("contest_qso_get", { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, expectedRevision: session.revision, qsoID }); }
  prepareExport(request: ContestExportPrepareRequest) {
    if (!validExportPrepareRequest(request)) throw new Error("Contest export preparation request is invalid or oversized.");
    return this.read<ContestPreparedExport>("contest_export_prepare", request);
  }
  readExport(request: ContestExportReadRequest) {
    const raw = object(request);
    if (!raw || !exact(raw, ["exportID", "sessionID", "workspaceGeneration", "offset", "length"]) ||
        !LOWER_UUID.test(request.exportID) || !LOWER_UUID.test(request.sessionID) || !LOWER_UUID.test(request.workspaceGeneration) ||
        !uint(request.offset) || !uint(request.length) || request.length <= 0 || request.length > MAX_EXPORT_CHUNK) {
      throw new Error("Contest export read request is invalid or oversized.");
    }
    return this.read<ContestExportChunk>("contest_export_read", request);
  }
  releaseExport(prepared: ContestPreparedExport) {
    return this.read<ContestExportReleaseResult>("contest_export_release", {
      exportID: prepared.artifactID, sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration,
    });
  }
  async readPreparedExport(prepared: ContestPreparedExport): Promise<Uint8Array> {
    if (prepared.byteLength > MAX_EXPORT_BYTES || prepared.chunkLimit <= 0 || prepared.chunkLimit > MAX_EXPORT_CHUNK) {
      throw new Error("Prepared contest export exceeds client limits.");
    }
    const bytes = new Uint8Array(prepared.byteLength);
    let offset = 0;
    while (offset < prepared.byteLength) {
      const length = Math.min(prepared.chunkLimit, prepared.byteLength - offset);
      const chunk = await this.readExport({ exportID: prepared.artifactID, sessionID: prepared.sessionID,
        workspaceGeneration: prepared.workspaceGeneration, offset, length });
      if (chunk.revision !== prepared.revision || chunk.byteLength !== prepared.byteLength || chunk.sha256 !== prepared.sha256) {
        throw new Error("Contest export chunk coordinate changed.");
      }
      const decoded = decodeBase64(chunk.dataBase64, length);
      if (decoded.length !== length || chunk.eof !== (offset + length === prepared.byteLength)) {
        throw new Error("Contest export chunk boundary is invalid.");
      }
      bytes.set(decoded, offset); offset += length;
    }
    if (await sha256Bytes(bytes) !== prepared.sha256) throw new Error("Contest export digest mismatch.");
    return bytes;
  }
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
  async applyDraft(session: ContestSessionSummary, draftID: string, fields: ContestDraftFields) { validateDraftFields(fields, session.rule); return this.mutate<ContestDraftResult>(await this.operation("contest_draft_apply", session.sessionID, session.workspaceGeneration, session.revision, { fields }, draftID)); }
  async reserveSerial(session: ContestSessionSummary, draftID: string) { return this.mutate<ContestDraftResult>(await this.operation("contest_serial_reserve", session.sessionID, session.workspaceGeneration, session.revision, {}, draftID)); }
  async commitQSO(session: ContestSessionSummary, draftID: string) { return this.mutate<ContestCommitResult>(await this.operation("contest_qso_commit", session.sessionID, session.workspaceGeneration, session.revision, {}, draftID)); }
  async correctQSO(session: ContestSessionSummary, qso: ContestFullQSO, reason: string) {
    if (!validFullQSO(qso, { sessionID: session.sessionID }) || qso.mode !== session.rule.mode || canonicalJSON(qso.ruleIdentity) !== canonicalJSON(session.rule.identity) ||
        qso.referenceDataVersion !== session.referenceDataVersion || !text(reason, 1_024) || !reason.trim()) throw new Error("Contest correction contains an invalid or oversized field.");
    const { entity: _serverResolvedEntity, ...correction } = qso;
    return this.mutate<ContestQSOChangeResult>(await this.operation("contest_qso_correct", session.sessionID, session.workspaceGeneration, session.revision, { qso: correction, reason }));
  }
  async deleteQSO(session: ContestSessionSummary, qsoID: string, reason: string) {
    if (!text(qsoID, 128) || !text(reason, 1_024) || !reason.trim()) throw new Error("Contest deletion contains an invalid or oversized field.");
    return this.mutate<ContestQSOChangeResult>(await this.operation("contest_qso_delete", session.sessionID, session.workspaceGeneration, session.revision, { qsoID, reason }));
  }
  retry(operation: ContestMutation) { canonicalJSON(operation.payload); if (!utcOperationISO(operation.scope.operationTimestamp)) throw new Error("Contest operation timestamp must be a canonical UTC ISO timestamp."); return this.mutate<ContestCreateResult | ContestDraftResult | ContestCommitResult | ContestQSOChangeResult>(operation); }
  receipt(operation: ContestMutation) { const { sessionID, workspaceGeneration, requestID, payloadDigest } = operation.scope; return this.read<ContestOperationReceiptResult>("contest_operation_receipt", { sessionID, workspaceGeneration, requestID, payloadDigest }); }
}

export function validateCreateInput(input: ContestCreateInput) {
  if (!text(input.name, 128) || !validIdentity(input.ruleIdentity) || !text(input.referenceDataVersion, 160) ||
      !text(input.station.callsign, 32) || !text(input.station.cqZone, 8) || !text(input.station.dxccEntity, 160) ||
      !text(input.operator.callsign, 32) || !text(input.operator.category, 80)) throw new Error("Contest session contains an invalid or oversized field.");
}
