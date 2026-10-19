export const contestSurfacePanelIDs = ["active-qso", "band-maps", "callsign-intelligence", "monitor", "propagation",
  "alerts", "awards", "chaser-dx", "rotor", "station-control", "logbook", "dx-cluster"] as const;
export type ContestSurfacePanelID = typeof contestSurfacePanelIDs[number];

type Revision = number;
type DraftRevision = { draftID: string; expectedDraftRevision: Revision };
export type ContestSurfaceAction =
  | { action: "entry_set_text"; params: DraftRevision & { field: "callsign" | "sentReport" | "receivedReport"; value: string } }
  | { action: "entry_set_exchange"; params: DraftRevision & { fieldID: string; value: string } }
  | { action: "entry_set_frequency_text"; params: DraftRevision & { value: string } }
  | { action: "entry_set_band" | "entry_set_mode"; params: DraftRevision & { value: string } }
  | { action: "entry_reserve_serial" | "entry_commit"; params: DraftRevision }
  | { action: "entry_operator_arm"; params: DraftRevision & { armed: boolean } }
  | { action: "entry_operator_style"; params: DraftRevision & { value: "run" | "search-and-pounce" } }
  | { action: "entry_set_cw_speed"; params: DraftRevision & { value: number } }
  | { action: "entry_operator_key"; params: DraftRevision & { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" |
      "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Escape"; focusedField: "callsign" | "exchange" | null } }
  | { action: "assistance_query"; params: DraftRevision & { inputCallsign: string } }
  | { action: "assistance_select"; params: DraftRevision & { kind: "scp" | "history" | "log" | "cluster"; candidateID: string } }
  | { action: "log_page"; params: { offset: number } }
  | { action: "log_edit_begin" | "log_edit_cancel"; params: { qsoID: string } }
  | { action: "log_edit_set_text"; params: { qsoID: string; field: "callsign" | "sentReport" | "receivedReport" |
      "timestamp" | "operator" | "correctionReason" | "deletionReason"; value: string } }
  | { action: "log_edit_set_exchange"; params: { qsoID: string; fieldID: string; value: string } }
  | { action: "log_edit_set_frequency_text"; params: { qsoID: string; value: string } }
  | { action: "log_edit_set_band"; params: { qsoID: string; value: string } }
  | { action: "log_edit_confirm_delete"; params: { qsoID: string; confirmed: boolean } }
  | { action: "log_edit_save" | "log_edit_delete"; params: { qsoID: string; expectedSessionRevision: Revision } };

export type ContestSurfaceActionEnvelope = ContestSurfaceAction & {
  operatingContext: string;
  scope: "contesting";
  sessionID: string;
  workspaceGeneration: string;
  panelID: ContestSurfacePanelID;
  projectionRevision: Revision;
  requestID: string;
};
export type ContestSurfaceUnavailableProjection = { schemaVersion: 1; status: "unavailable" };
export type ContestSurfaceReceivedField = { id: string; label: string; value: string; required: boolean; maximumUTF8Bytes: number };
export type ContestManualRow = { qsoID: string; TS: string; Call: string; Freq: string; SNT: string; RCV: string; ZN: string; SentNr: string; prefix: string; Points: string };
export type ContestManualContext = { operator: string; cwSpeedWpm: number | null; country: string | null; cqZone: number | null; ituZone: number | null;
  headingDegrees: number | null; longPathHeadingDegrees: number | null; distanceKm: number | null; qsos: number; multipliers: number; total: number };
export type ContestEntrySurfaceProjection = { schemaVersion: 1; status: "ready";
  manual?: ContestManualContext;
  session: { name: string; ruleName: string; mode: string };
  draft: { draftID: string; revision: number; callsign: string; sentReport: string; receivedReport: string;
    receivedFields: ContestSurfaceReceivedField[]; frequencyHz: number | null; frequencyText: string; frequencyError: string;
    band: string; mode: string; dupe: { state: "unchecked" | "clear" | "duplicate"; reason: string };
    validation: { errors: string[]; warnings: string[] }; reservedSerial: number | null };
  busy: boolean; dirty: boolean; uncertain: boolean };
export type ContestEntrySurfaceProjectionV2 = Omit<ContestEntrySurfaceProjection, "schemaVersion"> & { schemaVersion: 2;
  descriptor: { bands: string[]; modes: ("CW" | "SSB" | "RTTY" | "AM" | "FM")[];
    sentFields: { id: string; label: string; value: string; required: boolean; maximumUTF8Bytes: number }[];
    serial: { requirement: "none" | "requiredForCommit"; allocatedFieldID: string | null; reservedSerial: number | null } };
  operator: null | { output: "simulation-only" | "xlog-native"; armed: boolean; style: "run" | "search-and-pounce";
    status: "disarmed" | "armed" | "waiting" | "uncertain"; pending: "reserve-serial" | "send" | "commit" | null;
    focusedField: "callsign" | "exchange" | null;
    functionKeys: { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
      macro: string }[];
    readiness: { canSendCQ: boolean; canSendCall: boolean; canSendDuplicate: boolean; canReserveCall: boolean;
      canReserveCommit: boolean; canCommit: boolean };
    trace: { operationID: string; mode: "CW" | "SSB" | "AM" | "FM"; macro: "CQ" | "EXCH" | "QRZ" | "AGN" |
      "HISCALL" | "MYCALL" | "QSOB4"; text: string; status: "pending" | "confirmed" | "failed" | "stopped" }[] } };
export type ContestCallCandidate = { candidateID: string; callsign: string };
export type ContestCheckSurfaceProjection = { schemaVersion: 1; status: "ready"; draftID: string; draftRevision: number;
  loggedCalls?: string[]; clusterCalls?: string[];
  loggedCandidates?: ContestCallCandidate[]; clusterCandidates?: ContestCallCandidate[];
  inputCallsign: string; scp: { source: string | null; candidates: { candidateID: string; callsign: string }[] };
  history: { source: string | null; rows: { candidateID: string; callsign: string;
    fields: { id: string; label: string; value: string }[] }[] }; busy: boolean };
export type ContestStatisticsSurfaceProjection = { schemaVersion: 1; status: "ready"; score: null | {
  qsos: number; points: number; multipliers: number; claimedScore: number; multiplierLabels: string[];
  multiplierDisplayLabels: string[]; sourceVerification: "verified" | "provisional" | "unverified" }; busy: boolean };
// Rates are computed from the full Python-owned contest log, never a displayed log page.
export type ContestRatesSurfaceProjection = { schemaVersion: 1; status: "ready";
  lastHourQsoPerHour: number | null; last10QsoPerHour: number | null; last100QsoPerHour: number | null;
  sinceMinuteQsoPerHour: number | null; runQso: number; searchAndPounceQso: number;
  hourRunQso: number; hourSearchAndPounceQso: number; busy: boolean };
export type ContestMatrixSurfaceProjection = { schemaVersion: 1; status: "ready"; title: string;
  bands: string[]; rows: { label: string; counts: Record<string, number>; total: number }[]; total: number; busy: boolean };
export type ContestLogSurfaceProjection = { schemaVersion: 1; status: "ready"; sessionRevision: number;
  manualRows?: ContestManualRow[]; partialRows?: ContestManualRow[];
  page: { offset: number; limit: number; total: number; rows: { qsoID: string; workedAt: string; callsign: string; band: string;
    mode: string; sentExchange: string; receivedExchange: string; points: number; multiplierLabels: string[] }[] };
  editing: null | { qsoID: string; workedAt: string; operator: string; callsign: string; band: string; mode: string; sentReport: string; receivedReport: string;
    receivedFields: ContestSurfaceReceivedField[]; frequencyHz: number | null; editFrequencyText: string; frequencyError: string;
    correctionReason: string; confirmDelete: boolean; deletionReason: string }; busy: boolean };
export type ContestSurfaceProjection = ContestSurfaceUnavailableProjection | ContestEntrySurfaceProjection | ContestEntrySurfaceProjectionV2 |
  ContestCheckSurfaceProjection | ContestStatisticsSurfaceProjection | ContestRatesSurfaceProjection | ContestMatrixSurfaceProjection | ContestLogSurfaceProjection;

export const validContestSurfaceUUID = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const text = (value: unknown, maximum: number, allowEmpty = false) => typeof value === "string" &&
  (allowEmpty || value.trim().length > 0) && bytes(value) <= maximum;
const uint = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) &&
  (value as number) >= 0 && (value as number) <= maximum;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === "string" && choices.includes(value as T);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => actual.includes(key));
};
const optionalKeys = (value: Record<string, unknown>, keys: readonly string[], optional: readonly string[]) =>
  exact(value, [...keys, ...optional.filter(key => key in value)]);
const manualRowsValid = (value: unknown) => Array.isArray(value) && value.length <= 500 && value.every(row => record(row) &&
  exact(row, ["qsoID", "TS", "Call", "Freq", "SNT", "RCV", "ZN", "SentNr", "prefix", "Points"]) && Object.values(row).every(item => text(item, 160, true)));
const manualContextValid = (value: unknown) => record(value) && exact(value, ["operator", "cwSpeedWpm", "country", "cqZone", "ituZone", "headingDegrees", "longPathHeadingDegrees", "distanceKm", "qsos", "multipliers", "total"]) &&
  text(value.operator, 32, true) && (value.country === null || text(value.country, 160, true)) &&
  ["cwSpeedWpm", "cqZone", "ituZone", "headingDegrees", "longPathHeadingDegrees", "distanceKm"].every(key => value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0) &&
  ["qsos", "multipliers", "total"].every(key => uint(value[key]));
const draft = (value: Record<string, unknown>, extras: string[]) => exact(value, ["draftID", "expectedDraftRevision", ...extras]) &&
  text(value.draftID, 160) && uint(value.expectedDraftRevision);
const qso = (value: Record<string, unknown>, extras: string[]) => exact(value, ["qsoID", ...extras]) && text(value.qsoID, 160);
const texts = (value: unknown, maximumCount: number, maximumBytes: number) => Array.isArray(value) && value.length <= maximumCount &&
  value.every(item => text(item, maximumBytes, true));
const optionalFrequency = (value: unknown) => value === null || uint(value, 100_000_000_000);
const canonicalISO = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const validReceivedFields = (value: unknown) => Array.isArray(value) && value.length <= 16 && value.every(item => {
  const field = record(item) ? item : undefined;
  return !!field && exact(field, ["id", "label", "value", "required", "maximumUTF8Bytes"]) && text(field.id, 64) &&
    text(field.label, 160) && typeof field.required === "boolean" && uint(field.maximumUTF8Bytes, 1024) &&
    (field.maximumUTF8Bytes as number) > 0 && text(field.value, field.maximumUTF8Bytes as number, true);
});

function validEntryProjection(value: Record<string, unknown>) {
  const session = record(value.session) ? value.session : undefined, draftValue = record(value.draft) ? value.draft : undefined;
  const dupe = record(draftValue?.dupe) ? draftValue.dupe : undefined, validation = record(draftValue?.validation) ? draftValue.validation : undefined;
  return optionalKeys(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain"], ["manual"]) &&
    (!("manual" in value) || manualContextValid(value.manual)) &&
    !!session && exact(session, ["name", "ruleName", "mode"]) && text(session.name, 128) && text(session.ruleName, 128) && text(session.mode, 16) &&
    !!draftValue && exact(draftValue, ["draftID", "revision", "callsign", "sentReport", "receivedReport", "receivedFields", "frequencyHz", "frequencyText", "frequencyError", "band", "mode", "dupe", "validation", "reservedSerial"]) &&
    text(draftValue.draftID, 160) && uint(draftValue.revision) && text(draftValue.callsign, 32, true) && text(draftValue.sentReport, 160, true) &&
    text(draftValue.receivedReport, 160, true) && validReceivedFields(draftValue.receivedFields) && optionalFrequency(draftValue.frequencyHz) &&
    text(draftValue.frequencyText, 11, true) && text(draftValue.frequencyError, 512, true) && text(draftValue.band, 16) && text(draftValue.mode, 16) &&
    !!dupe && exact(dupe, ["state", "reason"]) && oneOf(dupe.state, ["unchecked", "clear", "duplicate"]) && text(dupe.reason, 512, true) &&
    !!validation && exact(validation, ["errors", "warnings"]) && texts(validation.errors, 32, 512) && texts(validation.warnings, 32, 512) &&
    (draftValue.reservedSerial === null || uint(draftValue.reservedSerial)) && typeof value.busy === "boolean" &&
    typeof value.dirty === "boolean" && typeof value.uncertain === "boolean";
}
function validEntryProjectionV2(value: Record<string, unknown>) {
  const base: Record<string, unknown> = { ...value, schemaVersion: 1 };
  delete base.descriptor; delete base.operator;
  const descriptor = record(value.descriptor) ? value.descriptor : undefined;
  const serial = record(descriptor?.serial) ? descriptor.serial : undefined;
  const operator = record(value.operator) ? value.operator : undefined;
  const readiness = record(operator?.readiness) ? operator.readiness : undefined;
  const draftValue = record(value.draft) ? value.draft : undefined;
  const sentFieldIDs = new Set<string>();
  const sentFieldsValid = Array.isArray(descriptor?.sentFields) && descriptor.sentFields.length <= 16 && descriptor.sentFields.every(item => {
    const field = record(item) ? item : undefined;
    if (!field || !exact(field, ["id", "label", "value", "required", "maximumUTF8Bytes"]) || !text(field.id, 64) ||
        sentFieldIDs.has(field.id as string) || !text(field.label, 160) || typeof field.required !== "boolean" ||
        !uint(field.maximumUTF8Bytes, 1024) || (field.maximumUTF8Bytes as number) < 1 ||
        !text(field.value, Math.min(field.maximumUTF8Bytes as number, 1024), true)) return false;
    sentFieldIDs.add(field.id as string); return true;
  });
  const serialValid = !!serial && exact(serial, ["requirement", "allocatedFieldID", "reservedSerial"]) &&
    oneOf(serial.requirement, ["none", "requiredForCommit"]) &&
    (serial.requirement === "none" ? serial.allocatedFieldID === null : text(serial.allocatedFieldID, 64) && sentFieldIDs.has(serial.allocatedFieldID as string)) &&
    (serial.reservedSerial === null || uint(serial.reservedSerial)) && serial.reservedSerial === draftValue?.reservedSerial;
  const operatorValid = value.operator === null || !!operator &&
    exact(operator, ["output", "armed", "style", "status", "pending", "focusedField", "functionKeys", "readiness", "trace"]) &&
    oneOf(operator.output, ["simulation-only", "xlog-native"]) && typeof operator.armed === "boolean" && oneOf(operator.style, ["run", "search-and-pounce"]) &&
    oneOf(operator.status, ["disarmed", "armed", "waiting", "uncertain"]) &&
    (operator.pending === null || oneOf(operator.pending, ["reserve-serial", "send", "commit"])) &&
    (operator.focusedField === null || oneOf(operator.focusedField, ["callsign", "exchange"])) &&
    Array.isArray(operator.functionKeys) && operator.functionKeys.length <= 12 && new Set(operator.functionKeys.map(item => {
      const key = record(item) ? item : undefined; return key?.key;
    })).size === operator.functionKeys.length &&
    operator.functionKeys.every(item => { const key = record(item) ? item : undefined; return !!key && exact(key, ["key", "macro"]) &&
      oneOf(key.key, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]) && text(key.macro, 160, true); }) &&
    !!readiness && exact(readiness, ["canSendCQ", "canSendCall", "canSendDuplicate", "canReserveCall", "canReserveCommit", "canCommit"]) &&
    Object.values(readiness).every(item => typeof item === "boolean") && Array.isArray(operator.trace) && operator.trace.length <= 24 &&
    operator.trace.every(item => { const trace = record(item) ? item : undefined; return !!trace &&
      exact(trace, ["operationID", "mode", "macro", "text", "status"]) && text(trace.operationID, 160) &&
      oneOf(trace.mode, ["CW", "SSB", "AM", "FM"]) && oneOf(trace.macro, ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"]) &&
      text(trace.text, 1024, true) && oneOf(trace.status, ["pending", "confirmed", "failed", "stopped"]); });
  return optionalKeys(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain", "descriptor", "operator"], ["manual"]) &&
    validEntryProjection(base) && !!descriptor && exact(descriptor, ["bands", "modes", "sentFields", "serial"]) &&
    texts(descriptor.bands, 32, 16) && new Set(descriptor.bands as string[]).size === (descriptor.bands as string[]).length &&
    Array.isArray(descriptor.modes) && descriptor.modes.length <= 5 &&
    descriptor.modes.every(item => oneOf(item, ["CW", "SSB", "RTTY", "AM", "FM"])) &&
    new Set(descriptor.modes).size === descriptor.modes.length && sentFieldsValid && serialValid && operatorValid;
}
function validCallCandidates(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!record(item) || !exact(item, ["candidateID", "callsign"]) || !text(item.candidateID, 160) ||
        typeof item.callsign !== "string" || !/^[A-Z0-9/]{1,32}$/.test(item.callsign) || ids.has(item.candidateID as string)) return false;
    ids.add(item.candidateID as string); return true;
  });
}
function validCheckProjection(value: Record<string, unknown>) {
  const scp = record(value.scp) ? value.scp : undefined, history = record(value.history) ? value.history : undefined;
  return optionalKeys(value, ["schemaVersion", "status", "draftID", "draftRevision", "inputCallsign", "scp", "history", "busy"], ["loggedCalls", "clusterCalls", "loggedCandidates", "clusterCandidates"]) &&
    ["loggedCandidates", "clusterCandidates"].every(key => !(key in value) || validCallCandidates(value[key])) &&
    ["loggedCalls", "clusterCalls"].every(key => !(key in value) || texts(value[key], 500, 32)) &&
    text(value.draftID, 160) && uint(value.draftRevision) && text(value.inputCallsign, 32, true) && !!scp &&
    exact(scp, ["source", "candidates"]) && (scp.source === null || text(scp.source, 160)) && Array.isArray(scp.candidates) &&
    scp.candidates.length <= 64 && scp.candidates.every(item => { const candidate = record(item) ? item : undefined; return !!candidate &&
      exact(candidate, ["candidateID", "callsign"]) && text(candidate.candidateID, 160) && text(candidate.callsign, 32); }) &&
    !!history && exact(history, ["source", "rows"]) && (history.source === null || text(history.source, 160)) && Array.isArray(history.rows) &&
    history.rows.length <= 64 && history.rows.every(item => { const row = record(item) ? item : undefined; return !!row &&
      exact(row, ["candidateID", "callsign", "fields"]) && text(row.candidateID, 160) && text(row.callsign, 32) && Array.isArray(row.fields) &&
      row.fields.length <= 16 && row.fields.every(entry => { const field = record(entry) ? entry : undefined; return !!field &&
        exact(field, ["id", "label", "value"]) && text(field.id, 64) && text(field.label, 160) && text(field.value, 1024, true); }); }) &&
    typeof value.busy === "boolean";
}
function validStatisticsProjection(value: Record<string, unknown>) {
  const score = record(value.score) ? value.score : undefined;
  return exact(value, ["schemaVersion", "status", "score", "busy"]) && typeof value.busy === "boolean" && (value.score === null || !!score &&
    exact(score, ["qsos", "points", "multipliers", "claimedScore", "multiplierLabels", "multiplierDisplayLabels", "sourceVerification"]) &&
    uint(score.qsos) && uint(score.points) && uint(score.multipliers) && uint(score.claimedScore) && texts(score.multiplierLabels, 10_000, 160) &&
    texts(score.multiplierDisplayLabels, 10_000, 160) &&
    oneOf(score.sourceVerification, ["verified", "provisional", "unverified"]));
}
function validLogProjection(value: Record<string, unknown>) {
  const page = record(value.page) ? value.page : undefined, editing = record(value.editing) ? value.editing : undefined;
  return optionalKeys(value, ["schemaVersion", "status", "sessionRevision", "page", "editing", "busy"], ["manualRows", "partialRows"]) &&
    ["manualRows", "partialRows"].every(key => !(key in value) || manualRowsValid(value[key])) && uint(value.sessionRevision) &&
    !!page && exact(page, ["offset", "limit", "total", "rows"]) && uint(page.offset, 1_000_000) && uint(page.limit, 20) &&
    uint(page.total, 1_000_000) && Array.isArray(page.rows) && page.rows.length <= 20 && page.rows.every(item => { const row = record(item) ? item : undefined;
      return !!row && exact(row, ["qsoID", "workedAt", "callsign", "band", "mode", "sentExchange", "receivedExchange", "points", "multiplierLabels"]) &&
        text(row.qsoID, 160) && canonicalISO(row.workedAt) && text(row.callsign, 32) && text(row.band, 16) && text(row.mode, 16) &&
        text(row.sentExchange, 2048, true) && text(row.receivedExchange, 2048, true) && uint(row.points) && texts(row.multiplierLabels, 32, 160); }) &&
    (value.editing === null || !!editing && exact(editing, ["qsoID", "workedAt", "operator", "callsign", "band", "mode", "sentReport", "receivedReport", "receivedFields", "frequencyHz", "editFrequencyText", "frequencyError", "correctionReason", "confirmDelete", "deletionReason"]) &&
      text(editing.qsoID, 160) && text(editing.workedAt, 32) && text(editing.operator, 32, true) && text(editing.callsign, 32, true) && text(editing.band, 16) && text(editing.mode, 16) && text(editing.sentReport, 160, true) &&
      text(editing.receivedReport, 160, true) && validReceivedFields(editing.receivedFields) && optionalFrequency(editing.frequencyHz) &&
      text(editing.editFrequencyText, 11, true) && text(editing.frequencyError, 512, true) && text(editing.correctionReason, 1024, true) &&
      typeof editing.confirmDelete === "boolean" && text(editing.deletionReason, 1024, true)) && typeof value.busy === "boolean";
}

function validRatesProjection(value: Record<string, unknown>) {
  const rateKeys = ["lastHourQsoPerHour", "last10QsoPerHour", "last100QsoPerHour", "sinceMinuteQsoPerHour"];
  const countKeys = ["runQso", "searchAndPounceQso", "hourRunQso", "hourSearchAndPounceQso"];
  return exact(value, ["schemaVersion", "status", ...rateKeys, ...countKeys, "busy"]) &&
    rateKeys.every(key => value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0) &&
    countKeys.every(key => uint(value[key])) && typeof value.busy === "boolean";
}
function validMatrixProjection(value: Record<string, unknown>) {
  const bands = value.bands;
  if (!exact(value, ["schemaVersion", "status", "title", "bands", "rows", "total", "busy"]) || !text(value.title, 160) ||
      !Array.isArray(bands) || bands.length > 32 || !bands.every(band => text(band, 16)) || new Set(bands).size !== bands.length ||
      !Array.isArray(value.rows) || value.rows.length > 10_000 || !uint(value.total) || typeof value.busy !== "boolean") return false;
  const labels = new Set<string>();
  return value.rows.every(item => {
    if (!record(item) || !exact(item, ["label", "counts", "total"]) || !text(item.label, 160) ||
        labels.has(item.label as string) || !record(item.counts) || !exact(item.counts, bands) ||
        !Object.values(item.counts).every(count => uint(count)) || !uint(item.total)) return false;
    labels.add(item.label as string); return true;
  });
}

export function validContestSurfaceProjection(panelID: ContestSurfacePanelID, value: unknown): value is ContestSurfaceProjection {
  const projection = record(value) ? value : undefined;
  if (!projection || typeof projection.status !== "string") return false;
  if (panelID === "active-qso" && projection.schemaVersion === 2 && projection.status === "ready") return validEntryProjectionV2(projection);
  if (projection.schemaVersion !== 1) return false;
  if (projection.status === "unavailable") return exact(projection, ["schemaVersion", "status"]);
  if (projection.status !== "ready") return false;
  if (panelID === "active-qso") return validEntryProjection(projection);
  if (panelID === "callsign-intelligence") return validCheckProjection(projection);
  if (panelID === "propagation") return validStatisticsProjection(projection);
  if (panelID === "monitor") return validRatesProjection(projection);
  if (panelID === "awards" || panelID === "chaser-dx") return validMatrixProjection(projection);
  if (panelID === "logbook") return validLogProjection(projection);
  return false;
}

function validParams(action: string, params: Record<string, unknown>) {
  if (action === "entry_set_text") return draft(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport"]) && text(params.value, 160, true);
  if (action === "entry_set_exchange") return draft(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "entry_set_frequency_text") return draft(params, ["value"]) && text(params.value, 11, true);
  if (action === "entry_set_band" || action === "entry_set_mode") return draft(params, ["value"]) && text(params.value, 16);
  if (action === "entry_reserve_serial" || action === "entry_commit") return draft(params, []);
  if (action === "entry_operator_arm") return draft(params, ["armed"]) && typeof params.armed === "boolean";
  if (action === "entry_operator_style") return draft(params, ["value"]) && oneOf(params.value, ["run", "search-and-pounce"]);
  if (action === "entry_set_cw_speed") return draft(params, ["value"]) && uint(params.value, 100) && (params.value as number) >= 5;
  if (action === "entry_operator_key") return draft(params, ["key", "focusedField"]) &&
    typeof params.key === "string" && /^(?:F(?:[1-9]|1[0-2])|Enter|Escape)$/.test(params.key) &&
    (params.focusedField === null || oneOf(params.focusedField, ["callsign", "exchange"]));
  if (action === "assistance_query") return draft(params, ["inputCallsign"]) && text(params.inputCallsign, 32, true);
  if (action === "assistance_select") return draft(params, ["kind", "candidateID"]) &&
    oneOf(params.kind, ["scp", "history", "log", "cluster"]) && text(params.candidateID, 160);
  if (action === "log_page") return exact(params, ["offset"]) && uint(params.offset, 1_000_000);
  if (action === "log_edit_begin" || action === "log_edit_cancel") return qso(params, []);
  if (action === "log_edit_set_text") return qso(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport", "timestamp", "operator", "correctionReason", "deletionReason"]) && text(params.value, 1024, true);
  if (action === "log_edit_set_exchange") return qso(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "log_edit_set_frequency_text") return qso(params, ["value"]) && text(params.value, 11, true);
  if (action === "log_edit_set_band") return qso(params, ["value"]) && text(params.value, 16);
  if (action === "log_edit_confirm_delete") return qso(params, ["confirmed"]) && typeof params.confirmed === "boolean";
  if (action === "log_edit_save" || action === "log_edit_delete") return qso(params, ["expectedSessionRevision"]) && uint(params.expectedSessionRevision);
  return false;
}

export function validContestSurfaceActionEnvelope(value: unknown): value is ContestSurfaceActionEnvelope {
  const envelope = record(value) ? value : undefined;
  const keys = ["operatingContext", "scope", "sessionID", "workspaceGeneration", "panelID", "projectionRevision", "requestID", "action", "params"];
  const action = typeof envelope?.action === "string" ? envelope.action : "";
  const panel = typeof envelope?.panelID === "string" ? envelope.panelID : "";
  const params = record(envelope?.params) ? envelope.params : undefined;
  const panelMatches = action.startsWith("entry_") ? panel === "active-qso" : action.startsWith("assistance_")
    ? panel === "callsign-intelligence" : action.startsWith("log_") ? panel === "logbook" : false;
  return !!envelope && exact(envelope, keys) && validContestSurfaceUUID(envelope.operatingContext) && envelope.scope === "contesting" &&
      validContestSurfaceUUID(envelope.sessionID) && validContestSurfaceUUID(envelope.workspaceGeneration) && oneOf(panel, contestSurfacePanelIDs) &&
      uint(envelope.projectionRevision) && validContestSurfaceUUID(envelope.requestID) && !!params && panelMatches && validParams(action, params);
}
export function validateContestSurfaceActionEnvelope(value: unknown): asserts value is ContestSurfaceActionEnvelope {
  if (!validContestSurfaceActionEnvelope(value)) throw new Error("The contest surface action envelope could not be verified.");
}
