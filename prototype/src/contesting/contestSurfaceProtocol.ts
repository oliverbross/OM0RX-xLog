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
  | { action: "entry_operator_key"; params: DraftRevision & { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" |
      "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Escape"; focusedField: "callsign" | "exchange" | null } }
  | { action: "assistance_query"; params: DraftRevision & { inputCallsign: string } }
  | { action: "assistance_select"; params: DraftRevision & { kind: "scp" | "history"; candidateID: string } }
  | { action: "log_page"; params: { offset: number } }
  | { action: "log_edit_begin" | "log_edit_cancel"; params: { qsoID: string } }
  | { action: "log_edit_set_text"; params: { qsoID: string; field: "callsign" | "sentReport" | "receivedReport" |
      "correctionReason" | "deletionReason"; value: string } }
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
export type ContestEntrySurfaceProjection = { schemaVersion: 1; status: "ready";
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
  operator: null | { output: "simulation-only"; armed: boolean; style: "run" | "search-and-pounce";
    status: "disarmed" | "armed" | "waiting" | "uncertain"; pending: "reserve-serial" | "send" | "commit" | null;
    focusedField: "callsign" | "exchange" | null;
    functionKeys: { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
      macro: "CQ" | "EXCH" | "QRZ" | "AGN" | "HISCALL" | "MYCALL" | "QSOB4" }[];
    readiness: { canSendCQ: boolean; canSendCall: boolean; canSendDuplicate: boolean; canReserveCall: boolean;
      canReserveCommit: boolean; canCommit: boolean };
    trace: { operationID: string; mode: "CW" | "SSB" | "AM" | "FM"; macro: "CQ" | "EXCH" | "QRZ" | "AGN" |
      "HISCALL" | "MYCALL" | "QSOB4"; text: string; status: "pending" | "confirmed" | "failed" | "stopped" }[] } };
export type ContestCheckSurfaceProjection = { schemaVersion: 1; status: "ready"; draftID: string; draftRevision: number;
  inputCallsign: string; scp: { source: string | null; candidates: { candidateID: string; callsign: string }[] };
  history: { source: string | null; rows: { candidateID: string; callsign: string;
    fields: { id: string; label: string; value: string }[] }[] }; busy: boolean };
export type ContestStatisticsSurfaceProjection = { schemaVersion: 1; status: "ready"; score: null | {
  qsos: number; points: number; multipliers: number; claimedScore: number; multiplierLabels: string[];
  multiplierDisplayLabels: string[]; sourceVerification: "verified" | "provisional" | "unverified" }; busy: boolean };
export type ContestRateMetricProjection = { qsoCount: number; spanSeconds: number | null; qsosPerHour: number | null };
export type ContestOperatorStylesProjection = { run: number; searchAndPounce: number; unknown: number };
export type ContestBandStatisticsProjection = { band: string; loggedQSOs: number; acceptedQSOs: number; distinctCallsigns: number;
  modes: { cw: number; phone: number; digital: number; other: number }; distinctWPXPrefixes: number; creditedPoints: number };
export type ContestRateSurfaceProjection = { schemaVersion: 1; status: "ready"; sessionRevision: number; asOfUTC: string;
  fullLogQSOs: number; loggedQSOs: number; acceptedQSOs: number; duplicateQSOs: number; invalidQSOs: number; currentHourQSOs: number;
  operatorStyles: { total: ContestOperatorStylesProjection; currentHour: ContestOperatorStylesProjection };
  trailing60Minutes: ContestRateMetricProjection; latest10: ContestRateMetricProjection | null; latest100: ContestRateMetricProjection | null; busy: boolean };
export type ContestStatisticsSurfaceProjectionV2 = { schemaVersion: 2; status: "ready"; score: ContestStatisticsSurfaceProjection["score"];
  busy: boolean; sessionRevision: number; asOfUTC: string; fullLogQSOs: number; loggedQSOs: number; acceptedQSOs: number;
  duplicateQSOs: number; invalidQSOs: number; bands: ContestBandStatisticsProjection[]; total: ContestBandStatisticsProjection };
export type ContestLogSurfaceProjection = { schemaVersion: 1; status: "ready"; sessionRevision: number;
  page: { offset: number; limit: number; total: number; rows: { qsoID: string; workedAt: string; callsign: string; band: string;
    mode: string; sentExchange: string; receivedExchange: string; points: number; multiplierLabels: string[] }[] };
  editing: null | { qsoID: string; callsign: string; band: string; mode: string; sentReport: string; receivedReport: string;
    receivedFields: ContestSurfaceReceivedField[]; frequencyHz: number | null; editFrequencyText: string; frequencyError: string;
    correctionReason: string; confirmDelete: boolean; deletionReason: string }; busy: boolean };
export type ContestSurfaceProjection = ContestSurfaceUnavailableProjection | ContestEntrySurfaceProjection | ContestEntrySurfaceProjectionV2 |
  ContestCheckSurfaceProjection | ContestStatisticsSurfaceProjection | ContestStatisticsSurfaceProjectionV2 | ContestRateSurfaceProjection | ContestLogSurfaceProjection;

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
  return exact(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain"]) &&
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
    operator.output === "simulation-only" && typeof operator.armed === "boolean" && oneOf(operator.style, ["run", "search-and-pounce"]) &&
    oneOf(operator.status, ["disarmed", "armed", "waiting", "uncertain"]) &&
    (operator.pending === null || oneOf(operator.pending, ["reserve-serial", "send", "commit"])) &&
    (operator.focusedField === null || oneOf(operator.focusedField, ["callsign", "exchange"])) &&
    Array.isArray(operator.functionKeys) && operator.functionKeys.length <= 12 && new Set(operator.functionKeys.map(item => {
      const key = record(item) ? item : undefined; return key?.key;
    })).size === operator.functionKeys.length &&
    operator.functionKeys.every(item => { const key = record(item) ? item : undefined; return !!key && exact(key, ["key", "macro"]) &&
      oneOf(key.key, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]) &&
      oneOf(key.macro, ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"]); }) &&
    !!readiness && exact(readiness, ["canSendCQ", "canSendCall", "canSendDuplicate", "canReserveCall", "canReserveCommit", "canCommit"]) &&
    Object.values(readiness).every(item => typeof item === "boolean") && Array.isArray(operator.trace) && operator.trace.length <= 24 &&
    operator.trace.every(item => { const trace = record(item) ? item : undefined; return !!trace &&
      exact(trace, ["operationID", "mode", "macro", "text", "status"]) && text(trace.operationID, 160) &&
      oneOf(trace.mode, ["CW", "SSB", "AM", "FM"]) && oneOf(trace.macro, ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"]) &&
      text(trace.text, 1024, true) && oneOf(trace.status, ["pending", "confirmed", "failed", "stopped"]); });
  return exact(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain", "descriptor", "operator"]) &&
    validEntryProjection(base) && !!descriptor && exact(descriptor, ["bands", "modes", "sentFields", "serial"]) &&
    texts(descriptor.bands, 32, 16) && new Set(descriptor.bands as string[]).size === (descriptor.bands as string[]).length &&
    Array.isArray(descriptor.modes) && descriptor.modes.length <= 5 &&
    descriptor.modes.every(item => oneOf(item, ["CW", "SSB", "RTTY", "AM", "FM"])) &&
    new Set(descriptor.modes).size === descriptor.modes.length && sentFieldsValid && serialValid && operatorValid;
}
function validCheckProjection(value: Record<string, unknown>) {
  const scp = record(value.scp) ? value.scp : undefined, history = record(value.history) ? value.history : undefined;
  return exact(value, ["schemaVersion", "status", "draftID", "draftRevision", "inputCallsign", "scp", "history", "busy"]) &&
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
const finiteNonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function validRateMetricProjection(value: unknown, expectedCount?: number) {
  const metric = record(value) ? value : undefined;
  return !!metric && exact(metric, ["qsoCount", "spanSeconds", "qsosPerHour"]) && uint(metric.qsoCount) &&
    (expectedCount === undefined || metric.qsoCount === expectedCount) &&
    (metric.spanSeconds === null || finiteNonnegative(metric.spanSeconds)) && (metric.qsosPerHour === null || finiteNonnegative(metric.qsosPerHour));
}
function validOperatorStylesProjection(value: unknown, expected: number) {
  const styles = record(value) ? value : undefined;
  return !!styles && exact(styles, ["run", "searchAndPounce", "unknown"]) && uint(styles.run) && uint(styles.searchAndPounce) && uint(styles.unknown) &&
    Number(styles.run) + Number(styles.searchAndPounce) + Number(styles.unknown) === expected;
}
function validSummaryProjection(value: Record<string, unknown>) {
  return uint(value.sessionRevision) && canonicalISO(value.asOfUTC) && uint(value.fullLogQSOs) && uint(value.loggedQSOs) &&
    Number(value.fullLogQSOs) >= Number(value.loggedQSOs) && uint(value.acceptedQSOs) && uint(value.duplicateQSOs) && uint(value.invalidQSOs) &&
    Number(value.acceptedQSOs) + Number(value.duplicateQSOs) + Number(value.invalidQSOs) === Number(value.loggedQSOs);
}
function validRateProjection(value: Record<string, unknown>) {
  const styles = record(value.operatorStyles) ? value.operatorStyles : undefined;
  return exact(value, ["schemaVersion", "status", "sessionRevision", "asOfUTC", "fullLogQSOs", "loggedQSOs", "acceptedQSOs", "duplicateQSOs", "invalidQSOs", "currentHourQSOs", "operatorStyles", "trailing60Minutes", "latest10", "latest100", "busy"]) &&
    validSummaryProjection(value) && uint(value.currentHourQSOs) && Number(value.currentHourQSOs) <= Number(value.loggedQSOs) && !!styles &&
    exact(styles, ["total", "currentHour"]) && validOperatorStylesProjection(styles.total, Number(value.loggedQSOs)) &&
    validOperatorStylesProjection(styles.currentHour, Number(value.currentHourQSOs)) && validRateMetricProjection(value.trailing60Minutes) &&
    Number((value.trailing60Minutes as Record<string, unknown>).qsoCount) <= Number(value.loggedQSOs) &&
    (Number(value.loggedQSOs) >= 10 ? validRateMetricProjection(value.latest10, 10) : value.latest10 === null) &&
    (Number(value.loggedQSOs) >= 100 ? validRateMetricProjection(value.latest100, 100) : value.latest100 === null) && typeof value.busy === "boolean";
}
function validBandStatisticsProjection(value: unknown, total = false) {
  const band = record(value) ? value : undefined, modes = record(band?.modes) ? band.modes : undefined;
  return !!band && exact(band, ["band", "loggedQSOs", "acceptedQSOs", "distinctCallsigns", "modes", "distinctWPXPrefixes", "creditedPoints"]) &&
    (total ? band.band === "total" : text(band.band, 16) && band.band !== "total") && uint(band.loggedQSOs) && uint(band.acceptedQSOs) && Number(band.acceptedQSOs) <= Number(band.loggedQSOs) &&
    uint(band.distinctCallsigns) && Number(band.distinctCallsigns) <= Number(band.loggedQSOs) && !!modes && exact(modes, ["cw", "phone", "digital", "other"]) &&
    [modes.cw, modes.phone, modes.digital, modes.other].every(item => uint(item)) &&
    Number(modes.cw) + Number(modes.phone) + Number(modes.digital) + Number(modes.other) === Number(band.loggedQSOs) &&
    uint(band.distinctWPXPrefixes) && Number(band.distinctWPXPrefixes) <= Number(band.loggedQSOs) && Number.isSafeInteger(band.creditedPoints);
}
function validStatisticsProjectionV2(value: Record<string, unknown>) {
  if (!exact(value, ["schemaVersion", "status", "score", "busy", "sessionRevision", "asOfUTC", "fullLogQSOs", "loggedQSOs", "acceptedQSOs", "duplicateQSOs", "invalidQSOs", "bands", "total"]) ||
      !validSummaryProjection(value) || typeof value.busy !== "boolean" || !Array.isArray(value.bands) || value.bands.length > 64 ||
      !value.bands.every(row => validBandStatisticsProjection(row)) || new Set(value.bands.map(row => (row as Record<string, unknown>).band)).size !== value.bands.length ||
      !validBandStatisticsProjection(value.total, true)) return false;
  const scoreOnly = { schemaVersion: 1, status: "ready", score: value.score, busy: value.busy };
  if (!validStatisticsProjection(scoreOnly)) return false;
  const total = value.total as Record<string, unknown>, totalModes = total.modes as Record<string, unknown>, sums = value.bands.reduce((sum, row) => { const band = row as Record<string, unknown>, modes = band.modes as Record<string, unknown>;
    return { logged: sum.logged + Number(band.loggedQSOs), accepted: sum.accepted + Number(band.acceptedQSOs), points: sum.points + Number(band.creditedPoints),
      cw: sum.cw + Number(modes.cw), phone: sum.phone + Number(modes.phone), digital: sum.digital + Number(modes.digital), other: sum.other + Number(modes.other) }; },
    { logged: 0, accepted: 0, points: 0, cw: 0, phone: 0, digital: 0, other: 0 });
  return sums.logged === total.loggedQSOs && sums.accepted === total.acceptedQSOs && sums.points === total.creditedPoints &&
    sums.cw === totalModes.cw && sums.phone === totalModes.phone && sums.digital === totalModes.digital && sums.other === totalModes.other &&
    total.loggedQSOs === value.loggedQSOs && total.acceptedQSOs === value.acceptedQSOs &&
    (value.score === null || (value.score as Record<string, unknown>).qsos === value.fullLogQSOs);
}
function validLogProjection(value: Record<string, unknown>) {
  const page = record(value.page) ? value.page : undefined, editing = record(value.editing) ? value.editing : undefined;
  return exact(value, ["schemaVersion", "status", "sessionRevision", "page", "editing", "busy"]) && uint(value.sessionRevision) &&
    !!page && exact(page, ["offset", "limit", "total", "rows"]) && uint(page.offset, 1_000_000) && uint(page.limit, 20) &&
    uint(page.total, 1_000_000) && Array.isArray(page.rows) && page.rows.length <= 20 && page.rows.every(item => { const row = record(item) ? item : undefined;
      return !!row && exact(row, ["qsoID", "workedAt", "callsign", "band", "mode", "sentExchange", "receivedExchange", "points", "multiplierLabels"]) &&
        text(row.qsoID, 160) && canonicalISO(row.workedAt) && text(row.callsign, 32) && text(row.band, 16) && text(row.mode, 16) &&
        text(row.sentExchange, 2048, true) && text(row.receivedExchange, 2048, true) && uint(row.points) && texts(row.multiplierLabels, 32, 160); }) &&
    (value.editing === null || !!editing && exact(editing, ["qsoID", "callsign", "band", "mode", "sentReport", "receivedReport", "receivedFields", "frequencyHz", "editFrequencyText", "frequencyError", "correctionReason", "confirmDelete", "deletionReason"]) &&
      text(editing.qsoID, 160) && text(editing.callsign, 32, true) && text(editing.band, 16) && text(editing.mode, 16) && text(editing.sentReport, 160, true) &&
      text(editing.receivedReport, 160, true) && validReceivedFields(editing.receivedFields) && optionalFrequency(editing.frequencyHz) &&
      text(editing.editFrequencyText, 11, true) && text(editing.frequencyError, 512, true) && text(editing.correctionReason, 1024, true) &&
      typeof editing.confirmDelete === "boolean" && text(editing.deletionReason, 1024, true)) && typeof value.busy === "boolean";
}

export function validContestSurfaceProjection(panelID: ContestSurfacePanelID, value: unknown): value is ContestSurfaceProjection {
  const projection = record(value) ? value : undefined;
  if (!projection || typeof projection.status !== "string") return false;
  if (panelID === "active-qso" && projection.schemaVersion === 2 && projection.status === "ready") return validEntryProjectionV2(projection);
  if (panelID === "propagation" && projection.schemaVersion === 2 && projection.status === "ready") return validStatisticsProjectionV2(projection);
  if (projection.schemaVersion !== 1) return false;
  if (projection.status === "unavailable") return exact(projection, ["schemaVersion", "status"]);
  if (projection.status !== "ready") return false;
  if (panelID === "active-qso") return validEntryProjection(projection);
  if (panelID === "callsign-intelligence") return validCheckProjection(projection);
  if (panelID === "propagation") return validStatisticsProjection(projection);
  if (panelID === "monitor") return validRateProjection(projection);
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
  if (action === "entry_operator_key") return draft(params, ["key", "focusedField"]) &&
    typeof params.key === "string" && /^(?:F(?:[1-9]|1[0-2])|Enter|Escape)$/.test(params.key) &&
    (params.focusedField === null || oneOf(params.focusedField, ["callsign", "exchange"]));
  if (action === "assistance_query") return draft(params, ["inputCallsign"]) && text(params.inputCallsign, 32, true);
  if (action === "assistance_select") return draft(params, ["kind", "candidateID"]) &&
    oneOf(params.kind, ["scp", "history"]) && text(params.candidateID, 160);
  if (action === "log_page") return exact(params, ["offset"]) && uint(params.offset, 1_000_000);
  if (action === "log_edit_begin" || action === "log_edit_cancel") return qso(params, []);
  if (action === "log_edit_set_text") return qso(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport", "correctionReason", "deletionReason"]) && text(params.value, 1024, true);
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
