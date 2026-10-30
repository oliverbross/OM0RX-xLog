import { contestKeyBindingActions, contestKeyBindingContexts, normalizeContestKey, type ContestKeyBinding } from "./contestKeyBindings";

export const contestSurfacePanelIDs = ["active-qso", "qrz-details", "band-maps", "world-map", "callsign-intelligence", "monitor", "propagation",
  "awards", "chaser-dx", "rotor", "station-control", "logbook", "dx-cluster", "score-reporting", "messages"] as const;
export type ContestSurfacePanelID = typeof contestSurfacePanelIDs[number];
export const contestInputFieldIDs = ["callsign", "sent", "receive", "other_1", "other_2"] as const;
export type ContestInputFieldID = typeof contestInputFieldIDs[number];

type Revision = number;
type DraftRevision = { draftID: string; expectedDraftRevision: Revision };
export type ContestSurfaceAction =
  | { action: "spot_select"; params: DraftRevision & { spotID: string } }
  | { action: "spot_confirm" | "spot_delete"; params: DraftRevision & { spotID: string } }
  | { action: "spot_set_marked"; params: DraftRevision & { spotID: string; marked: boolean } }
  | { action: "spot_set_marked_only"; params: DraftRevision & { markedOnly: boolean } }
  | { action: "spot_set_show_worked"; params: DraftRevision & { showWorked: boolean } }
  | { action: "entry_set_text"; params: DraftRevision & { field: "callsign" | "sentReport" | "receivedReport"; value: string } }
  | { action: "entry_cw_callsign"; params: DraftRevision & { sourceEpoch: string; spotID: string; spotVersion: string } }
  | { action: "entry_set_exchange"; params: DraftRevision & { fieldID: string; value: string } }
  | { action: "entry_set_frequency_text"; params: DraftRevision & { value: string; callsignCommand?: true } }
  | { action: "entry_set_band"; params: DraftRevision & { value: string } }
  | { action: "entry_set_mode"; params: DraftRevision & { value: string; callsignCommand?: true } }
  | { action: "entry_reserve_serial" | "entry_commit" | "entry_clear" | "entry_edit_last"; params: DraftRevision }
  | { action: "entry_spot" | "entry_mark_spot" | "entry_tune_spot"; params: DraftRevision }
  | { action: "entry_step_spot"; params: DraftRevision & { direction: "previous" | "next"; multiplierOnly?: boolean } }
  | { action: "entry_step_vfo"; params: DraftRevision & { direction: "up" | "down" } }
  | { action: "entry_return_cq_frequency"; params: DraftRevision }
  | { action: "entry_operator_arm"; params: DraftRevision & { armed: boolean } }
  | { action: "entry_operator_style"; params: DraftRevision & { value: "run" | "search-and-pounce" } }
  | { action: "entry_set_cw_speed"; params: DraftRevision & { value: number } }
  | { action: "entry_send_cw_text"; params: DraftRevision & { value: string } }
  | { action: "entry_focus"; params: DraftRevision & { fieldID: ContestInputFieldID } }
  | { action: "entry_operator_key"; params: DraftRevision & { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" |
      "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Escape"; focusedField: ContestInputFieldID | null; shifted?: boolean } }
  | { action: "assistance_query"; params: DraftRevision & { inputCallsign: string } }
  | { action: "assistance_download" | "assistance_refresh"; params: DraftRevision }
  | { action: "assistance_select"; params: DraftRevision & { kind: "scp" | "history" | "log" | "cluster"; candidateID: string } }
  | { action: "log_export_cabrillo" | "log_export_adif" | "log_export_edi"; params: Record<string, never> }
  | { action: "log_import_adif"; params: { sourceName: string; records: ContestADIFImportRecord[] } }
  | { action: "log_recalculate"; params: { expectedSessionRevision: Revision } }
  | { action: "log_page"; params: { offset: number; limit: number } }
  | { action: "log_search"; params: { query:string } }
  | { action: "log_focus"; params: { qsoID:string; callsign:string } }
  | { action: "log_correct_call"; params: { qsoID:string; expectedSessionRevision:number; expectedCall:string; callsign:string } }
  | { action: "log_edit_begin" | "log_edit_begin_delete" | "log_edit_cancel"; params: { qsoID: string } }
  | { action: "log_edit_set_text"; params: { qsoID: string; field: "callsign" | "sentReport" | "receivedReport" |
      "timestamp" | "operator" | "name" | "qth" | "comment" | "receiveFrequency" | "power" |
      "correctionReason" | "deletionReason"; value: string } }
  | { action: "log_edit_set_exchange"; params: { qsoID: string; fieldID: string; value: string } }
  | { action: "log_edit_set_frequency_text"; params: { qsoID: string; value: string } }
  | { action: "log_edit_set_band"; params: { qsoID: string; value: string } }
  | { action: "log_edit_confirm_delete"; params: { qsoID: string; confirmed: boolean } }
  | { action: "log_edit_save" | "log_edit_delete"; params: { qsoID: string; expectedSessionRevision: Revision } }
  | { action: "score_configure"; params: { service: "hamscore" | "contestonlinescore"; username: string;
      password: string; intervalMinutes: number; enabled: boolean } }
  | { action: "score_send_now"; params: Record<string, never> };

export type ContestADIFImportRecord = { qsoID: string; timestamp: string; frequencyHz: number; mode: "SSB";
  fields: { callsign: string; sent: string; receive: string; other_1: string; other_2: string } };

export type ContestSurfaceActionEnvelope = ContestSurfaceAction & {
  operatingContext: string;
  scope: "contesting";
  sessionID: string;
  workspaceGeneration: string;
  panelID: ContestSurfacePanelID;
  projectionRevision: Revision;
  requestID: string;
};
export type ContestSurfaceUnavailableProjection = { schemaVersion: 1; status: "unavailable"; reason?: string };
export type ContestSurfaceReceivedField = { id: string; label: string; value: string; required: boolean; maximumUTF8Bytes: number;
  enabled?: boolean; readOnly?: boolean };
export type ContestManualRow = { qsoID: string; TS: string; Call: string; Freq: string; SNT: string; RCV: string;
  M1: string; ZN: string; M2: string; prefix: string; Points: string };
export type ContestLogEditDetails = { rxFrequency: string; contest: string; country: string; stationCall: string;
  name: string; qth: string; comment: string; receivedNumber: string; sentNumber: string; points: string; power: string;
  zone: string; section: string; check: string; precedence: string; multiplier1: string; multiplier2: string; multiplier3: string;
  wpx: string; exchange: string; run: string; radio: string; grid: string; misc: string; roverQTH: string };
export type ContestLogInlineEdit =
  | { kind: "text"; field: "callsign" | "sentReport" | "receivedReport" | "timestamp"; value: string; maximumUTF8Bytes: number }
  | { kind: "exchange"; fieldID: string; value: string; maximumUTF8Bytes: number }
  | { kind: "frequency"; value: string; maximumUTF8Bytes: number };
export type ContestExchangeWarning = {fieldID:string;message:string;kind:"mismatch"|"conflict"};
export type ContestPluginLogRow = { qsoID: string; values: string[]; isDupe?: boolean; exchangeWarnings?:ContestExchangeWarning[];
  inlineEdits?: (ContestLogInlineEdit | null)[] };
export type ContestManualContext = { operator: string; cwSpeedWpm: number | null; cwSpeedStepWpm: number; country: string | null; cqZone: number | null; ituZone: number | null;
  headingDegrees: number | null; longPathHeadingDegrees: number | null; distanceKm: number | null; qsos: number; multipliers: number; total: number; scoringComplete?: boolean };
export type ContestEntryMultiplierStatus = "new-zone-and-country" | "new-zone" | "new-country" | "no-new-multiplier";
export type ContestEntryLaneContext = { mode:"SO2V"|"SO2R"; laneID:"laneA"|"laneB"; bindingVersion:number;
  binding:null|{radioID:"radio1"|"radio2";receiverID:string;vfo:string;sliceID:string|null;generation:string|number} };
export type ContestEntrySurfaceProjection = { schemaVersion: 1; status: "ready";
  manual?: ContestManualContext;
  session: { name: string; ruleName: string; mode: string; laneContext?:ContestEntryLaneContext };
  draft: { draftID: string; revision: number; callsign: string; sentReport: string; receivedReport: string;
    receivedFields: ContestSurfaceReceivedField[]; frequencyHz: number | null; frequencyText: string; frequencyError: string;
    band: string; mode: string; dupe: { state: "unchecked" | "clear" | "duplicate"; reason: string };
    validation: { errors: string[]; warnings: string[] }; reservedSerial: number | null; exchangeWarnings?:ContestExchangeWarning[];
    multiplierStatus?: ContestEntryMultiplierStatus };
  busy: boolean; dirty: boolean; uncertain: boolean };
export type ContestEntrySurfaceProjectionV2 = Omit<ContestEntrySurfaceProjection, "schemaVersion"> & { schemaVersion: 2;
  descriptor: { reportsVisible?: boolean; bands: string[]; modes: ("CW" | "SSB" | "RTTY" | "AM" | "FM")[];
    enterPolicy?: "manual" | "esm";
    allowDuplicateCommit?: boolean; automaticSerial?: boolean; advanceOnSpace?: ContestInputFieldID[];
    spaceNext?: Partial<Record<ContestInputFieldID, ContestInputFieldID>>; keyBindings?: ContestKeyBinding[];
    reportFields?: ContestSurfaceReceivedField[];
    sentFields: ContestSurfaceReceivedField[];
    serial: { requirement: "none" | "requiredForCommit"; allocatedFieldID: string | null; reservedSerial: number | null } };
  operator: null | { output: "simulation-only" | "xlog-native" | "test-simulation"; outputAvailable: boolean;
    outputUnavailableReason: string | null; armed: boolean; style: "run" | "search-and-pounce";
    status: "disarmed" | "armed" | "waiting" | "uncertain"; pending: "reserve-serial" | "send" | "commit" | null;
    focusedField: ContestInputFieldID | null;
    tabNext: Partial<Record<ContestInputFieldID, ContestInputFieldID>>;
    tabPrevious: Partial<Record<ContestInputFieldID, ContestInputFieldID>>;
    functionKeys: { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
      macro: string; highlighted: boolean }[];
    autoCQ?: { active: boolean; delaySeconds: number; remainingMs: number | null };
    fldigi?: { transmit_release_required: boolean; transmit_release_uncertain: boolean; configuration_error: string | null; status: string };
    readiness: { canSendCQ: boolean; canSendCall: boolean; canSendDuplicate: boolean; canReserveCall: boolean;
      canReserveCommit: boolean; canCommit: boolean };
    trace: { operationID: string; mode: "CW" | "SSB" | "AM" | "FM"; macro: string;
      text: string; status: "pending" | "confirmed" | "failed" | "stopped" }[] } };
export type ContestCallCandidate = { candidateID: string; callsign: string };
export type ContestCheckSurfaceProjection = { schemaVersion: 1; status: "ready"; draftID: string; draftRevision: number;
  loggedCalls?: string[]; clusterCalls?: string[];
  loggedCandidates?: ContestCallCandidate[]; clusterCandidates?: ContestCallCandidate[];
  inputCallsign: string; scp: { source: string | null; candidates: { candidateID: string; callsign: string }[];
    availability?: "ready" | "not_imported" | "invalid_cache" | "replacing" | "stopped" | "status_unavailable";
    notice?: string | null; error?: string | null };
  history: { source: string | null; rows: { candidateID: string; callsign: string;
    fields: { id: string; label: string; value: string }[] }[] }; busy: boolean };
export type ContestStatisticsScore = null | {
  qsos: number; points: number; multipliers: number; claimedScore: number; multiplierLabels: string[];
  multiplierDisplayLabels: string[]; sourceVerification: "verified" | "provisional" | "unverified"; scoringComplete?: boolean };
export type ContestStatisticsSurfaceProjectionV1 = { schemaVersion: 1; status: "ready";
  score: ContestStatisticsScore; busy: boolean };
export type ContestStatisticsRow = { band: string; qsos: number; calls: number; cw: number; phone: number;
  digital: number; wpx: number; points: number; dupes?:number|null };
export type ContestCQWWStatisticsRow = { band: string; qsos: number; points: number; countries: number; zones: number; dupes?:number|null };
export type ContestStatisticsSurfaceProjectionV3 = { schemaVersion: 3; status: "ready"; score: ContestStatisticsScore; busy: boolean } & (
  { layout?: "generic"; rows: ContestStatisticsRow[]; total: ContestStatisticsRow } |
  { layout: "cq_ww"; rows: ContestCQWWStatisticsRow[]; total: ContestCQWWStatisticsRow });
export type ContestStatisticsSurfaceProjection = ContestStatisticsSurfaceProjectionV1 | ContestStatisticsSurfaceProjectionV3;
// Rates are computed from the full Python-owned contest log, never a displayed log page.
export type ContestRatesSurfaceProjection = { schemaVersion: 1; status: "ready";
  lastHourQsoPerHour: number | null; last10QsoPerHour: number | null; last100QsoPerHour: number | null;
  sinceHourUTC: number; sinceHourQso: number; runQso: number; searchAndPounceQso: number;
  hourRunQso: number; hourSearchAndPounceQso: number; hourly?:{hourUTC:string;qsos:number}[];lastQsoAt?:string|null;
  contestStartAt?:string|null;contestEndAt?:string|null;contestScheduleSource?:"settings"|"cq-ww-calendar"; busy: boolean };
export type ContestScoreReportingSurfaceProjection = { schemaVersion: 1; status: "ready";
  score: ContestStatisticsScore; intervalMinutes: number; reportingEnabled: boolean; availability: "available" | "unavailable";
  reason: string; service: "hamscore" | "contestonlinescore"; username: string; credentialSaved: boolean;
  reportState: "disabled" | "scheduled" | "posting" | "sent" | "failed" | "paused"; lastOutcome: string;
  nextAttempt: string | null; services: { id: "hamscore" | "contestonlinescore" | "contest-run"; name: string; url: string;
    transportSecurity: "https" | "legacy-http" }[]; busy: boolean };
type ContestMatrixSurfaceProjectionV1 = { schemaVersion: 1; status: "ready"; title: string;
  bands: string[]; rows: { label: string; counts: Record<string, number>; total: number }[]; total: number; busy: boolean };
export type ContestMatrixSurfaceProjectionV4 = { schemaVersion: 4; status: "ready"; title: string;
  draftID?:string;draftRevision?:number;
  tracker: "dxcc" | "zone"; zoneSystem: "cq" | "itu" | null;
  current: { dxcc: string | null; cqZone: number | null; ituZone: number | null };
  bands: string[]; configuredBands?: string[]; currentBand?: string | null;
  rows: { label: string; counts: Record<string, number>; total: number;continent?:string|null;
    availableSpots?:Record<string,ContestAvailableMultiplierSpot[]> }[]; total: number; busy: boolean };
export type ContestAvailableMultiplierSpot = {spotID:string;callsign:string;frequencyKHz:number;mode:string;
  contestDupe:boolean|null;contestMultiplierCount:number|null;contestCountryMultiplier:boolean|null;contestZoneMultiplier:boolean|null};
export type ContestMatrixSurfaceProjection = ContestMatrixSurfaceProjectionV1 | ContestMatrixSurfaceProjectionV4;
export type ContestSurfaceSpot = { id: string; receivedAt: number; clusterName: string; spotter: string;
  spotterContinent: string | null; frequencyKHz: number; frequencyText: string; callsign: string; comment: string;
  band: string; mode: string; country: string; adif: number | null; continent: string; cqZone: number | null;
  ituZone: number | null; latitude?: number | null; longitude?: number | null;
  callStatus: string; dxccStatus: string; workedBefore: number | null; specialTags: string[];
  score: number; contestPoints: number | null; contestDupe: boolean | null; contestMultiplierCount: number | null;
  contestCountryMultiplier: boolean | null; contestZoneMultiplier: boolean | null;
  scoreReasons: string[]; aggregateCount: number; aggregateSpotters: string[]; source: string;
  statusHex: string; bandHex: string; modeHex: string; marked: boolean };
export type ContestSpotSurfaceProjection = { schemaVersion: 2; status: "ready"; draftID: string; draftRevision: number;
  radioFrequencyHz: number | null; connectedClusters: number; loadedSpots: number; selectedSpotID: string | null;
  configuredClusters: { serverID: string; serverName: string; enabled: boolean }[];
  connections: { serverID: string; serverName: string; phase: string; error: string | null }[];
  contestSessionID?: string; supportedBands?: string[]; allowedModeGroups?: Array<"cw" | "data" | "phone">;
  bandSegments?: string[]; markedOnly: boolean; showWorked?: boolean; spots: ContestSurfaceSpot[]; busy: boolean };
export type ContestRemoteVFOSurfaceProjection = { schemaVersion: 1; status: "ready";
  radioFrequencyHz: number | null; contestFrequencyHz: number | null; band: string; mode: string; busy: boolean };
export type ContestLogSurfaceProjection = { schemaVersion: 1; status: "ready"; sessionRevision: number;
  canExportCabrillo: boolean; canExportAdif?: boolean; canExportEdi?: boolean;
  exchangeLayout?: "plugin";
  searchQuery?:string; focusedQsoID?:string;
  manualRows?: ContestManualRow[]; partialRows?: ContestManualRow[];
  pluginColumns?: string[]; pluginRows?: ContestPluginLogRow[]; pluginPartialRows?: ContestPluginLogRow[];
  page: { offset: number; limit: number; total: number; rows: { qsoID: string; workedAt: string; callsign: string; band: string;
    mode: string; sentExchange: string; receivedExchange: string; points: number; multiplierLabels: string[] }[] };
  editing: null | { editorProfile?: "cq_ww_ssb"; reportsVisible?: boolean; details?: ContestLogEditDetails; qsoID: string; workedAt: string; operator: string; callsign: string; name?: string; qth?: string; comment?: string; band: string; mode: string; sentReport: string; receivedReport: string;
    entryFields?: ContestSurfaceReceivedField[]; receivedFields: ContestSurfaceReceivedField[]; frequencyHz: number | null; editFrequencyText: string; frequencyError: string;
    receiveFrequencyHz?: number | null; editReceiveFrequencyText?: string; receiveFrequencyError?: string; editPower?: string; powerError?: string;
    correctionReason: string; confirmDelete: boolean; deletionReason: string }; busy: boolean };
export type ContestMessagesSurfaceProjection = { schemaVersion: 1; status: "ready";
  messages: { kind: "error" | "notice"; text: string }[]; busy: boolean };
export type ContestSurfaceProjection = ContestSurfaceUnavailableProjection | ContestEntrySurfaceProjection | ContestEntrySurfaceProjectionV2 |
  ContestCheckSurfaceProjection | ContestStatisticsSurfaceProjection | ContestRatesSurfaceProjection | ContestMatrixSurfaceProjection |
  ContestLogSurfaceProjection | ContestSpotSurfaceProjection | ContestRemoteVFOSurfaceProjection | ContestScoreReportingSurfaceProjection |
  ContestMessagesSurfaceProjection;

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
const validTabMap = (value: unknown) => record(value) && Object.keys(value).length <= contestInputFieldIDs.length &&
  Object.entries(value).every(([from, to]) => oneOf(from, contestInputFieldIDs) && oneOf(to, contestInputFieldIDs));
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => actual.includes(key));
};
const optionalKeys = (value: Record<string, unknown>, keys: readonly string[], optional: readonly string[]) =>
  exact(value, [...keys, ...optional.filter(key => key in value)]);
const manualRowsValid = (value: unknown) => Array.isArray(value) && value.length <= 500 && value.every(row => record(row) &&
  exact(row, ["qsoID", "TS", "Call", "Freq", "SNT", "RCV", "M1", "ZN", "M2", "prefix", "Points"]) && Object.values(row).every(item => text(item, 160, true)));
const pluginColumnsValid = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 32 &&
  value.every(column => text(column, 64) && column === column.trim()) && new Set(value).size === value.length &&
  value.filter(column => column === "Call").length === 1;
const inlineEditValid = (value: unknown) => value === null || record(value) &&
  optionalKeys(value, ["kind", "value", "maximumUTF8Bytes"], value.kind === "text" ? ["field"] : value.kind === "exchange" ? ["fieldID"] : []) &&
  oneOf(value.kind, ["text", "exchange", "frequency"]) && uint(value.maximumUTF8Bytes, 1024) && (value.maximumUTF8Bytes as number) > 0 &&
  text(value.value, value.maximumUTF8Bytes as number, true) && (value.kind !== "text" || oneOf(value.field, ["callsign", "sentReport", "receivedReport", "timestamp"])) &&
  (value.kind !== "exchange" || text(value.fieldID, 64));
const exchangeWarningsValid=(value:unknown)=>Array.isArray(value)&&value.length<=32&&value.every(item=>record(item)&&
  exact(item,["fieldID","message","kind"])&&text(item.fieldID,64)&&text(item.message,512)&&oneOf(item.kind,["mismatch","conflict"]));
const pluginRowsValid = (value: unknown, columns: number, maximum: number) => Array.isArray(value) && value.length <= maximum &&
  value.every(row => record(row) && optionalKeys(row, ["qsoID", "values"], ["inlineEdits", "isDupe","exchangeWarnings"]) && text(row.qsoID, 160) &&
    (row.exchangeWarnings===undefined||exchangeWarningsValid(row.exchangeWarnings))&&
    Array.isArray(row.values) && row.values.length === columns && row.values.every(item => text(item, 512, true)) &&
    (!("isDupe" in row) || typeof row.isDupe === "boolean") &&
    (!("inlineEdits" in row) || Array.isArray(row.inlineEdits) && row.inlineEdits.length === columns && row.inlineEdits.every(inlineEditValid)));
const uniqueArray=(value:unknown,maximum:number,item:(value:unknown)=>boolean)=>Array.isArray(value)&&value.length>0&&
  value.length<=maximum&&value.every(item)&&new Set(value).size===value.length;
const manualContextValid = (value: unknown) => record(value) && optionalKeys(value, ["operator", "cwSpeedWpm", "cwSpeedStepWpm", "country", "cqZone", "ituZone", "headingDegrees", "longPathHeadingDegrees", "distanceKm", "qsos", "multipliers", "total"], ["scoringComplete"]) &&
  (value.scoringComplete === undefined || typeof value.scoringComplete === "boolean") &&
  text(value.operator, 32, true) && (value.country === null || text(value.country, 160, true)) &&
  typeof value.cwSpeedStepWpm === "number" && Number.isInteger(value.cwSpeedStepWpm) && value.cwSpeedStepWpm >= 1 && value.cwSpeedStepWpm <= 10 &&
  ["cwSpeedWpm", "cqZone", "ituZone", "headingDegrees", "longPathHeadingDegrees", "distanceKm"].every(key => value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0) &&
  ["qsos", "multipliers", "total"].every(key => uint(value[key]));
const draft = (value: Record<string, unknown>, extras: string[], optional: string[] = []) => optionalKeys(value, ["draftID", "expectedDraftRevision", ...extras], optional) &&
  text(value.draftID, 160) && uint(value.expectedDraftRevision);
const qso = (value: Record<string, unknown>, extras: string[]) => exact(value, ["qsoID", ...extras]) && text(value.qsoID, 160);
const texts = (value: unknown, maximumCount: number, maximumBytes: number) => Array.isArray(value) && value.length <= maximumCount &&
  value.every(item => text(item, maximumBytes, true));
const optionalFrequency = (value: unknown) => value === null || uint(value, 100_000_000_000);
const canonicalISO = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const validReceivedFields = (value: unknown) => Array.isArray(value) && value.length <= 16 && value.every(item => {
  const field = record(item) ? item : undefined;
  return !!field && optionalKeys(field, ["id", "label", "value", "required", "maximumUTF8Bytes"], ["enabled", "readOnly"]) && text(field.id, 64) &&
    text(field.label, 160) && typeof field.required === "boolean" && uint(field.maximumUTF8Bytes, 1024) &&
    (field.maximumUTF8Bytes as number) > 0 && text(field.value, field.maximumUTF8Bytes as number, true) &&
    (field.enabled === undefined || typeof field.enabled === "boolean") && (field.readOnly === undefined || typeof field.readOnly === "boolean");
});

function validEntryLaneContext(value:unknown) {
  if(!record(value)||!exact(value,["mode","laneID","bindingVersion","binding"])||!oneOf(value.mode,["SO2V","SO2R"])||
    !oneOf(value.laneID,["laneA","laneB"])||!uint(value.bindingVersion))return false;
  const binding=value.binding;
  return binding===null||record(binding)&&exact(binding,["radioID","receiverID","vfo","sliceID","generation"])&&
    oneOf(binding.radioID,["radio1","radio2"])&&text(binding.receiverID,128)&&text(binding.vfo,128)&&
    (binding.sliceID===null||text(binding.sliceID,128))&&(uint(binding.generation)||text(binding.generation,128));
}

function validEntryProjection(value: Record<string, unknown>) {
  const session = record(value.session) ? value.session : undefined, draftValue = record(value.draft) ? value.draft : undefined;
  const dupe = record(draftValue?.dupe) ? draftValue.dupe : undefined, validation = record(draftValue?.validation) ? draftValue.validation : undefined;
  return optionalKeys(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain"], ["manual"]) &&
    (!("manual" in value) || manualContextValid(value.manual)) &&
    !!session && optionalKeys(session, ["name", "ruleName", "mode"],["laneContext"]) && text(session.name, 128) && text(session.ruleName, 128) && text(session.mode, 16) &&
    (session.laneContext===undefined||validEntryLaneContext(session.laneContext))&&
    !!draftValue && optionalKeys(draftValue, ["draftID", "revision", "callsign", "sentReport", "receivedReport", "receivedFields", "frequencyHz", "frequencyText", "frequencyError", "band", "mode", "dupe", "validation", "reservedSerial"],["exchangeWarnings", "multiplierStatus"]) &&
    (draftValue.multiplierStatus===undefined||oneOf(draftValue.multiplierStatus,["new-zone-and-country","new-zone","new-country","no-new-multiplier"]))&&
    (draftValue.exchangeWarnings===undefined||exchangeWarningsValid(draftValue.exchangeWarnings))&&
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
  const autoCQ = record(operator?.autoCQ) ? operator.autoCQ : undefined;
  const readiness = record(operator?.readiness) ? operator.readiness : undefined;
  const draftValue = record(value.draft) ? value.draft : undefined;
  const reportFieldsValid = descriptor?.reportFields === undefined || validReceivedFields(descriptor.reportFields);
  const sentFieldsValid = validReceivedFields(descriptor?.sentFields);
  const projectedFieldIDs = new Set([...(Array.isArray(descriptor?.reportFields) ? descriptor.reportFields : []),
    ...(Array.isArray(descriptor?.sentFields) ? descriptor.sentFields : [])].map(item => record(item) ? item.id : null));
  const serialValid = !!serial && exact(serial, ["requirement", "allocatedFieldID", "reservedSerial"]) &&
    oneOf(serial.requirement, ["none", "requiredForCommit"]) &&
    (serial.requirement === "none" ? serial.allocatedFieldID === null : serial.allocatedFieldID === null ||
      text(serial.allocatedFieldID, 64) && projectedFieldIDs.has(serial.allocatedFieldID)) &&
    (serial.reservedSerial === null || uint(serial.reservedSerial)) && serial.reservedSerial === draftValue?.reservedSerial;
  const keyBindingsValid = descriptor?.keyBindings === undefined || Array.isArray(descriptor.keyBindings) && descriptor.keyBindings.length <= 32 &&
    new Set(descriptor.keyBindings.map(item => {
      const binding = record(item) ? item : undefined;
      return binding ? `${binding.context}:${binding.key}` : "";
    })).size === descriptor.keyBindings.length && descriptor.keyBindings.every(item => {
      const binding = record(item) ? item : undefined;
      return !!binding && exact(binding, ["context", "key", "action"]) && oneOf(binding.context, contestKeyBindingContexts) &&
        text(binding.key, 64) && normalizeContestKey(binding.key as string) === binding.key && oneOf(binding.action, contestKeyBindingActions);
    });
  const advanceOnSpaceValid = descriptor?.advanceOnSpace === undefined || Array.isArray(descriptor.advanceOnSpace) &&
    descriptor.advanceOnSpace.length <= contestInputFieldIDs.length && new Set(descriptor.advanceOnSpace).size === descriptor.advanceOnSpace.length &&
    descriptor.advanceOnSpace.every(item => oneOf(item, contestInputFieldIDs));
  const spaceNextValid = descriptor?.spaceNext === undefined || record(descriptor.spaceNext) &&
    Object.keys(descriptor.spaceNext).length <= contestInputFieldIDs.length &&
    Object.entries(descriptor.spaceNext).every(([from, to]) => oneOf(from, contestInputFieldIDs) && oneOf(to, contestInputFieldIDs));
  const operatorValid = value.operator === null || !!operator &&
    optionalKeys(operator, ["output", "outputAvailable", "outputUnavailableReason", "armed", "style", "status", "pending", "focusedField", "tabNext", "tabPrevious", "functionKeys", "readiness", "trace"], ["autoCQ", "fldigi"]) &&
    (operator.fldigi === undefined || record(operator.fldigi) && exact(operator.fldigi,["transmit_release_required","transmit_release_uncertain","configuration_error","status"]) &&
      typeof operator.fldigi.transmit_release_required === "boolean" && typeof operator.fldigi.transmit_release_uncertain === "boolean" &&
      (operator.fldigi.configuration_error === null || text(operator.fldigi.configuration_error,2048,true)) && text(operator.fldigi.status,512,true)) &&
    oneOf(operator.output, ["simulation-only", "xlog-native", "test-simulation"]) && typeof operator.outputAvailable === "boolean" &&
    (operator.outputUnavailableReason === null || text(operator.outputUnavailableReason, 512)) &&
    (operator.outputAvailable ? operator.outputUnavailableReason === null : operator.outputUnavailableReason !== null) &&
    typeof operator.armed === "boolean" && oneOf(operator.style, ["run", "search-and-pounce"]) &&
    oneOf(operator.status, ["disarmed", "armed", "waiting", "uncertain"]) &&
    (operator.pending === null || oneOf(operator.pending, ["reserve-serial", "send", "commit"])) &&
    (operator.focusedField === null || oneOf(operator.focusedField, contestInputFieldIDs)) &&
    validTabMap(operator.tabNext) && validTabMap(operator.tabPrevious) &&
    Array.isArray(operator.functionKeys) && operator.functionKeys.length <= 12 && new Set(operator.functionKeys.map(item => {
      const key = record(item) ? item : undefined; return key?.key;
    })).size === operator.functionKeys.length &&
    operator.functionKeys.every(item => { const key = record(item) ? item : undefined; return !!key && exact(key, ["key", "macro", "highlighted"]) &&
      oneOf(key.key, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]) &&
      text(key.macro, 160, true) && typeof key.highlighted === "boolean"; }) &&
    !!readiness && exact(readiness, ["canSendCQ", "canSendCall", "canSendDuplicate", "canReserveCall", "canReserveCommit", "canCommit"]) &&
    Object.values(readiness).every(item => typeof item === "boolean") && Array.isArray(operator.trace) && operator.trace.length <= 24 &&
    (operator.autoCQ === undefined || !!autoCQ && exact(autoCQ, ["active", "delaySeconds", "remainingMs"]) && typeof autoCQ.active === "boolean" &&
      typeof autoCQ.delaySeconds === "number" && Number.isFinite(autoCQ.delaySeconds) && autoCQ.delaySeconds >= 1 && autoCQ.delaySeconds <= 3600 &&
      (autoCQ.remainingMs === null || uint(autoCQ.remainingMs, 3_600_000))) &&
    operator.trace.every(item => { const trace = record(item) ? item : undefined; return !!trace &&
      exact(trace, ["operationID", "mode", "macro", "text", "status"]) && text(trace.operationID, 160) &&
      oneOf(trace.mode, ["CW", "SSB", "AM", "FM"]) && text(trace.macro, 160, true) &&
      text(trace.text, 4096, true) && oneOf(trace.status, ["pending", "confirmed", "failed", "stopped"]); });
  return optionalKeys(value, ["schemaVersion", "status", "session", "draft", "busy", "dirty", "uncertain", "descriptor", "operator"], ["manual"]) &&
    validEntryProjection(base) && !!descriptor && optionalKeys(descriptor, ["bands", "modes", "sentFields", "serial"], ["enterPolicy", "reportFields", "reportsVisible", "allowDuplicateCommit", "automaticSerial", "advanceOnSpace", "spaceNext", "keyBindings"]) &&
    (descriptor.enterPolicy===undefined||oneOf(descriptor.enterPolicy,["manual","esm"])) &&
    (!("reportsVisible" in descriptor) || typeof descriptor.reportsVisible === "boolean") &&
    (!("allowDuplicateCommit" in descriptor) || typeof descriptor.allowDuplicateCommit === "boolean") &&
    (!("automaticSerial" in descriptor) || typeof descriptor.automaticSerial === "boolean") &&
    texts(descriptor.bands, 64, 16) && new Set(descriptor.bands as string[]).size === (descriptor.bands as string[]).length &&
    Array.isArray(descriptor.modes) && descriptor.modes.length <= 5 &&
    descriptor.modes.every(item => oneOf(item, ["CW", "SSB", "RTTY", "AM", "FM"])) &&
    new Set(descriptor.modes).size === descriptor.modes.length && reportFieldsValid && sentFieldsValid && serialValid && advanceOnSpaceValid && spaceNextValid && keyBindingsValid && operatorValid;
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
    optionalKeys(scp, ["source", "candidates"], ["availability", "notice", "error"]) && (scp.source === null || text(scp.source, 160)) &&
    (scp.availability === undefined || oneOf(scp.availability, ["ready", "not_imported", "invalid_cache", "replacing", "stopped", "status_unavailable"])) &&
    (scp.notice === undefined || scp.notice === null || text(scp.notice, 512, true)) &&
    (scp.error === undefined || scp.error === null || text(scp.error, 512, true)) && Array.isArray(scp.candidates) &&
    scp.candidates.length <= 64 && scp.candidates.every(item => { const candidate = record(item) ? item : undefined; return !!candidate &&
      exact(candidate, ["candidateID", "callsign"]) && text(candidate.candidateID, 160) && text(candidate.callsign, 32); }) &&
    !!history && exact(history, ["source", "rows"]) && (history.source === null || text(history.source, 160)) && Array.isArray(history.rows) &&
    history.rows.length <= 64 && history.rows.every(item => { const row = record(item) ? item : undefined; return !!row &&
      exact(row, ["candidateID", "callsign", "fields"]) && text(row.candidateID, 160) && text(row.callsign, 32) && Array.isArray(row.fields) &&
      row.fields.length <= 16 && row.fields.every(entry => { const field = record(entry) ? entry : undefined; return !!field &&
        exact(field, ["id", "label", "value"]) && text(field.id, 64) && text(field.label, 160) && text(field.value, 1024, true); }); }) &&
    typeof value.busy === "boolean";
}
function validStatisticsScore(value: unknown, signedPoints = false) {
  const score = record(value) ? value : undefined;
  return value === null || !!score &&
    optionalKeys(score, ["qsos", "points", "multipliers", "claimedScore", "multiplierLabels", "multiplierDisplayLabels", "sourceVerification"], ["scoringComplete"]) &&
    (score.scoringComplete === undefined || typeof score.scoringComplete === "boolean") &&
    uint(score.qsos) && (signedPoints ? Number.isSafeInteger(score.points) : uint(score.points)) && uint(score.multipliers) &&
    uint(score.claimedScore) && texts(score.multiplierLabels, 10_000, 160) && texts(score.multiplierDisplayLabels, 10_000, 160) &&
    oneOf(score.sourceVerification, ["verified", "provisional", "unverified"]);
}
function validStatisticsProjection(value: Record<string, unknown>) {
  return exact(value, ["schemaVersion", "status", "score", "busy"]) && typeof value.busy === "boolean" && validStatisticsScore(value.score);
}
function validStatisticsRow(value: unknown, total: boolean): value is ContestStatisticsRow {
  if (!record(value) || !optionalKeys(value, ["band", "qsos", "calls", "cw", "phone", "digital", "wpx", "points"],["dupes"]) ||
      !text(value.band, 16) || (total ? value.band !== "TOTAL" : value.band === "TOTAL") ||
      !uint(value.qsos) || !uint(value.calls) || !uint(value.cw) || !uint(value.phone) || !uint(value.digital) || !uint(value.wpx) ||
      !Number.isSafeInteger(value.points) || !validDupeCount(value)) return false;
  return (value.calls as number) <= (value.qsos as number) && (value.wpx as number) <= (value.qsos as number) &&
    (value.cw as number) + (value.phone as number) + (value.digital as number) <= (value.qsos as number);
}
function validCQWWStatisticsRow(value: unknown, total: boolean): value is ContestCQWWStatisticsRow {
  return record(value) && optionalKeys(value, ["band", "qsos", "points", "countries", "zones"],["dupes"]) && text(value.band, 16) && validDupeCount(value) &&
    (total ? value.band === "TOTAL" : value.band !== "TOTAL") && uint(value.qsos) && Number.isSafeInteger(value.points) &&
    uint(value.countries) && uint(value.zones) && (value.countries as number) <= (value.qsos as number) &&
    (value.zones as number) <= (value.qsos as number);
}
function validStatisticsProjectionV3(value: Record<string, unknown>) {
  const cqWW = value.layout === "cq_ww";
  if (!(cqWW ? exact(value, ["schemaVersion", "status", "layout", "score", "rows", "total", "busy"])
      : optionalKeys(value, ["schemaVersion", "status", "score", "rows", "total", "busy"], ["layout"])) ||
      (!cqWW && value.layout !== undefined && value.layout !== "generic") || typeof value.busy !== "boolean" ||
      !validStatisticsScore(value.score, true) || !Array.isArray(value.rows) || value.rows.length > 64 ||
      !value.rows.every(row => cqWW ? validCQWWStatisticsRow(row, false) : validStatisticsRow(row, false)) ||
      !(cqWW ? validCQWWStatisticsRow(value.total, true) : validStatisticsRow(value.total, true))) return false;
  if (!consistentDupeTotals(value.rows as ContestStatisticsRow[],value.total as ContestStatisticsRow)) return false;
  if (cqWW) {
    const rows = value.rows as ContestCQWWStatisticsRow[], total = value.total as ContestCQWWStatisticsRow;
    if (new Set(rows.map(row => row.band)).size !== rows.length) return false;
    const sums = rows.reduce((result, row) => ({ qsos:result.qsos+row.qsos, points:result.points+row.points,
      countries:result.countries+row.countries, zones:result.zones+row.zones }), {qsos:0,points:0,countries:0,zones:0});
    const score = value.score as Exclude<ContestStatisticsScore, null> | null;
    return Object.values(sums).every(Number.isSafeInteger) && (["qsos","points","countries","zones"] as const)
      .every(key => total[key] === sums[key]) && !!score && score.qsos === total.qsos && score.points === total.points &&
      score.multipliers === total.countries + total.zones;
  }
  const rows = value.rows as ContestStatisticsRow[], total = value.total as ContestStatisticsRow;
  if (new Set(rows.map(row => row.band)).size !== rows.length) return false;
  const sums = rows.reduce((result, row) => ({ qsos: result.qsos + row.qsos, calls: result.calls + row.calls,
    cw: result.cw + row.cw, phone: result.phone + row.phone, digital: result.digital + row.digital,
    wpx: result.wpx + row.wpx, points: result.points + row.points }),
    { qsos: 0, calls: 0, cw: 0, phone: 0, digital: 0, wpx: 0, points: 0 });
  if (Object.values(sums).some(sum => !Number.isSafeInteger(sum)) || total.calls > sums.calls ||
      !(["qsos", "cw", "phone", "digital", "wpx", "points"] as const).every(key => total[key] === sums[key])) return false;
  const score = value.score as Exclude<ContestStatisticsScore, null> | null;
  return !!score && score.qsos === total.qsos && score.points === total.points;
}
function validDupeCount(row:Record<string,unknown>) {
  return row.dupes==null||uint(row.dupes)&&(row.dupes as number)<=(row.qsos as number);
}
function consistentDupeTotals(rows:{dupes?:number|null}[],total:{dupes?:number|null}) {
  if (total.dupes===undefined) return rows.every(row=>row.dupes===undefined);
  if (rows.some(row=>row.dupes===undefined)) return false;
  if (rows.some(row=>row.dupes===null)) return total.dupes===null;
  const sum=rows.reduce((result,row)=>result+(row.dupes??0),0);
  return Number.isSafeInteger(sum)&&total.dupes===sum;
}
function validLogProjection(value: Record<string, unknown>) {
  const page = record(value.page) ? value.page : undefined, editing = record(value.editing) ? value.editing : undefined;
  const pageRows = Array.isArray(page?.rows) ? page.rows : [], pluginLayout = value.exchangeLayout === "plugin";
  const pluginColumns = pluginColumnsValid(value.pluginColumns) ? value.pluginColumns : undefined;
  return optionalKeys(value, ["schemaVersion", "status", "sessionRevision", "canExportCabrillo", "page", "editing", "busy"],
      ["canExportAdif", "canExportEdi", "manualRows", "partialRows", "exchangeLayout", "pluginColumns", "pluginRows", "pluginPartialRows", "searchQuery", "focusedQsoID"]) &&
    (value.searchQuery===undefined||text(value.searchQuery,32,true)) && (value.focusedQsoID===undefined||text(value.focusedQsoID,160,true)) &&
    typeof value.canExportCabrillo === "boolean" && (value.canExportAdif === undefined || typeof value.canExportAdif === "boolean") &&
    (value.canExportEdi === undefined || typeof value.canExportEdi === "boolean") &&
    (!("exchangeLayout" in value) || value.exchangeLayout === "plugin") &&
    (pluginLayout ? !!pluginColumns && pluginRowsValid(value.pluginRows, pluginColumns.length, 20) &&
        pluginRowsValid(value.pluginPartialRows, pluginColumns.length, 500) && !("manualRows" in value) && !("partialRows" in value)
      : !("pluginColumns" in value) && !("pluginRows" in value) && !("pluginPartialRows" in value) &&
        ["manualRows", "partialRows"].every(key => !(key in value) || manualRowsValid(value[key]))) && uint(value.sessionRevision) &&
    !!page && exact(page, ["offset", "limit", "total", "rows"]) && uint(page.offset, 1_000_000) && uint(page.limit, 20) &&
    uint(page.total, 1_000_000) && Array.isArray(page.rows) && pageRows.length <= 20 && pageRows.every(item => { const row = record(item) ? item : undefined;
      return !!row && exact(row, ["qsoID", "workedAt", "callsign", "band", "mode", "sentExchange", "receivedExchange", "points", "multiplierLabels"]) &&
        text(row.qsoID, 160) && canonicalISO(row.workedAt) && text(row.callsign, 32) && text(row.band, 16) && text(row.mode, 16) &&
        text(row.sentExchange, 2048, true) && text(row.receivedExchange, 2048, true) && uint(row.points) && texts(row.multiplierLabels, 32, 160); }) &&
    (!pluginLayout || Array.isArray(value.pluginRows) && value.pluginRows.length === pageRows.length && value.pluginRows.every((item, index) =>
      record(item) && record(pageRows[index]) && item.qsoID === pageRows[index].qsoID)) &&
    (value.editing === null || !!editing && optionalKeys(editing, ["qsoID", "workedAt", "operator", "callsign", "band", "mode", "sentReport", "receivedReport", "receivedFields", "frequencyHz", "editFrequencyText", "frequencyError", "correctionReason", "confirmDelete", "deletionReason"], ["editorProfile", "entryFields", "reportsVisible", "details", "name", "qth", "comment", "receiveFrequencyHz", "editReceiveFrequencyText", "receiveFrequencyError", "editPower", "powerError"]) &&
      (!("reportsVisible" in editing) || typeof editing.reportsVisible === "boolean") &&
      (!("details" in editing) || validLogEditDetails(editing.details)) &&
      text(editing.qsoID, 160) && text(editing.workedAt, 32) && text(editing.operator, 32, true) && text(editing.callsign, 32, true) &&
      (!('name' in editing) || text(editing.name, 20, true)) && (!('qth' in editing) || text(editing.qth, 25, true)) &&
      (!('comment' in editing) || text(editing.comment, 60, true)) && text(editing.band, 16) && text(editing.mode, 16) && text(editing.sentReport, 160, true) &&
      text(editing.receivedReport, 160, true) && (!("entryFields" in editing) || validReceivedFields(editing.entryFields)) &&
      validReceivedFields(editing.receivedFields) && optionalFrequency(editing.frequencyHz) &&
      text(editing.editFrequencyText, 11, true) && text(editing.frequencyError, 512, true) && text(editing.correctionReason, 1024, true) &&
      (editing.editorProfile === undefined || editing.editorProfile === "cq_ww_ssb") &&
      (editing.receiveFrequencyHz === undefined || editing.receiveFrequencyHz === null || uint(editing.receiveFrequencyHz, 100_000_000_000)) &&
      (editing.editReceiveFrequencyText === undefined || text(editing.editReceiveFrequencyText, 12, true)) &&
      (editing.receiveFrequencyError === undefined || text(editing.receiveFrequencyError, 512, true)) &&
      (editing.editPower === undefined || text(editing.editPower, 8, true)) &&
      (editing.powerError === undefined || text(editing.powerError, 512, true)) &&
      typeof editing.confirmDelete === "boolean" && text(editing.deletionReason, 1024, true)) && typeof value.busy === "boolean";
}

const logEditDetailKeys = ["rxFrequency", "contest", "country", "stationCall", "name", "qth", "comment", "receivedNumber",
  "sentNumber", "points", "power", "zone", "section", "check", "precedence", "multiplier1", "multiplier2", "multiplier3",
  "wpx", "exchange", "run", "radio", "grid", "misc", "roverQTH"] as const;
function validLogEditDetails(value: unknown): value is ContestLogEditDetails {
  return record(value) && exact(value, logEditDetailKeys) && logEditDetailKeys.every(key => text(value[key], 2048, true));
}

function validRatesProjection(value: Record<string, unknown>) {
  const rateKeys = ["lastHourQsoPerHour", "last10QsoPerHour", "last100QsoPerHour"];
  const countKeys = ["sinceHourQso", "runQso", "searchAndPounceQso", "hourRunQso", "hourSearchAndPounceQso"];
  return optionalKeys(value, ["schemaVersion", "status", ...rateKeys, "sinceHourUTC", ...countKeys, "busy"],["hourly","lastQsoAt","contestStartAt","contestEndAt","contestScheduleSource"]) &&
    (value.contestScheduleSource===undefined||oneOf(value.contestScheduleSource,["settings","cq-ww-calendar"]))&&
    (value.hourly===undefined||Array.isArray(value.hourly)&&value.hourly.length<=168&&value.hourly.every(item=>record(item)&&exact(item,["hourUTC","qsos"])&&canonicalISO(item.hourUTC)&&uint(item.qsos)))&&
    (value.lastQsoAt===undefined||value.lastQsoAt===null||canonicalISO(value.lastQsoAt))&&
    ["contestStartAt","contestEndAt"].every(key=>value[key]===undefined||value[key]===null||canonicalISO(value[key]))&&
    (value.contestEndAt==null||typeof value.contestStartAt==="string"&&String(value.contestEndAt)>value.contestStartAt)&&
    rateKeys.every(key => value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0) &&
    uint(value.sinceHourUTC, 23) && countKeys.every(key => uint(value[key])) && typeof value.busy === "boolean";
}
function availableMultiplierSpotValid(value:unknown){
  return record(value)&&exact(value,["spotID","callsign","frequencyKHz","mode","contestDupe","contestMultiplierCount","contestCountryMultiplier","contestZoneMultiplier"])&&
    text(value.spotID,128)&&text(value.callsign,32)&&text(value.mode,16)&&typeof value.frequencyKHz==="number"&&Number.isFinite(value.frequencyKHz)&&value.frequencyKHz>0&&value.frequencyKHz<=1_300_000&&
    [value.contestDupe,value.contestCountryMultiplier,value.contestZoneMultiplier].every(item=>item===null||typeof item==="boolean")&&
    (value.contestMultiplierCount===null||uint(value.contestMultiplierCount,10));
}
/** Version-one family matrices retain full band/mode/UTC-block identity. */
export function validLegacyMultiplierScope(value:unknown):value is string {
  if(typeof value!=="string"||!text(value,64))return false;
  if(!value.includes("UTC block"))return text(value,16);
  return /^(?:160m|80m|40m|20m|15m|10m|6m|4m|2m|1\.25m|70cm|33cm|23cm|13cm|9cm|6cm|3cm|1\.25cm|6mm|4mm|2\.5mm|2mm|1mm) \/ (?:(?:CW|PH|OTHER) \/ )?UTC block [0-7](?![\s\S])/.test(value);
}
function validMatrixProjection(value: Record<string, unknown>) {
  const bands = value.bands;
  const version = value.schemaVersion;
  if (version !== 1 && version !== 4) return false;
  const required = version === 1 ? ["schemaVersion", "status", "title", "bands", "rows", "total", "busy"] :
    ["schemaVersion", "status", "title", "tracker", "zoneSystem", "current", "bands", "rows", "total", "busy"];
  const optional = version === 4 ? ["configuredBands", "currentBand","draftID","draftRevision"] : [];
  if (!optionalKeys(value, required, optional) || !text(value.title, 160) ||
      !Array.isArray(bands) || bands.length > 32 || !bands.every(band => version===1?validLegacyMultiplierScope(band):text(band,16)) || new Set(bands).size !== bands.length ||
      !Array.isArray(value.rows) || value.rows.length > 10_000 || !uint(value.total) || typeof value.busy !== "boolean") return false;
  if (version === 4) {
    const current = record(value.current) ? value.current : undefined;
    if (!current || !exact(current, ["dxcc", "cqZone", "ituZone"]) ||
        value.draftID!==undefined&&(!text(value.draftID,160)||!uint(value.draftRevision))||
        value.draftRevision!==undefined&&!text(value.draftID,160)||
        value.tracker !== "dxcc" && value.tracker !== "zone" ||
        value.tracker === "dxcc" && value.zoneSystem !== null ||
        value.tracker === "zone" && value.zoneSystem !== "cq" && value.zoneSystem !== "itu" ||
        current.dxcc !== null && !text(current.dxcc, 160) ||
        value.configuredBands !== undefined && (!Array.isArray(value.configuredBands) ||
          !value.configuredBands.every(band => text(band, 16) && (bands as string[]).includes(band as string))) ||
        value.currentBand !== undefined && value.currentBand !== null && (!text(value.currentBand, 16) || !(bands as string[]).includes(value.currentBand as string)) ||
        ![current.cqZone, current.ituZone].every(zone => zone === null || uint(zone, 90))) return false;
  }
  const labels = new Set<string>();
  return value.rows.every(item => {
    if (!record(item) || !optionalKeys(item, ["label", "counts", "total"],version===4?["continent","availableSpots"]:[]) || !text(item.label, 160) ||
        item.continent!==undefined&&item.continent!==null&&!text(item.continent,8,true)||
        item.availableSpots!==undefined&&(!record(item.availableSpots)||!Object.entries(item.availableSpots).every(([band,spots])=>
          bands.includes(band)&&Array.isArray(spots)&&spots.length<=500&&spots.every(availableMultiplierSpotValid)))||
        labels.has(item.label as string) || !record(item.counts) || !exact(item.counts, bands) ||
        !Object.values(item.counts).every(count => uint(count)) || !uint(item.total)) return false;
    labels.add(item.label as string); return true;
  });
}
function validSpotProjection(value: Record<string, unknown>) {
  if (!optionalKeys(value, ["schemaVersion", "status", "draftID", "draftRevision", "radioFrequencyHz", "connectedClusters", "loadedSpots",
      "selectedSpotID", "configuredClusters", "connections", "markedOnly", "spots", "busy"],
      ["contestSessionID", "supportedBands", "allowedModeGroups", "bandSegments", "showWorked"]) ||
      !text(value.draftID, 160) || !uint(value.draftRevision) || !optionalFrequency(value.radioFrequencyHz) ||
      !uint(value.connectedClusters) || !uint(value.loadedSpots) || !Array.isArray(value.spots) || value.spots.length > 2_000 ||
      value.selectedSpotID !== null && !text(value.selectedSpotID, 128) || typeof value.markedOnly !== "boolean" ||
      value.showWorked !== undefined && typeof value.showWorked !== "boolean" || typeof value.busy !== "boolean" ||
      value.contestSessionID !== undefined && !text(value.contestSessionID, 160) ||
      value.supportedBands !== undefined && !uniqueArray(value.supportedBands,64,item=>text(item,16)) ||
      value.allowedModeGroups !== undefined && !uniqueArray(value.allowedModeGroups,3,item=>oneOf(item,["cw","data","phone"])) ||
      value.bandSegments !== undefined && !(Array.isArray(value.bandSegments) && value.bandSegments.length <= 64 &&
        value.bandSegments.every(item => text(item, 512)))) return false;
  if (!Array.isArray(value.configuredClusters) || value.configuredClusters.length > 32 || !value.configuredClusters.every(item => record(item) &&
      exact(item, ["serverID", "serverName", "enabled"]) && text(item.serverID, 128) && text(item.serverName, 160) && typeof item.enabled === "boolean") ||
      !Array.isArray(value.connections) || value.connections.length > 32 || !value.connections.every(item => record(item) &&
      exact(item, ["serverID", "serverName", "phase", "error"]) && text(item.serverID, 128) && text(item.serverName, 160) && text(item.phase, 32) &&
      (item.error === null || text(item.error, 512, true)))) return false;
  const ids = new Set<string>();
  return value.spots.every(item => {
    if (!record(item) || !optionalKeys(item, ["id", "receivedAt", "clusterName", "spotter", "spotterContinent", "frequencyKHz",
        "frequencyText", "callsign", "comment", "band", "mode", "country", "adif", "continent", "cqZone", "ituZone",
        "callStatus", "dxccStatus", "workedBefore", "specialTags", "score", "contestPoints", "contestDupe", "contestMultiplierCount",
        "contestCountryMultiplier", "contestZoneMultiplier", "scoreReasons", "aggregateCount",
        "aggregateSpotters", "source", "statusHex", "bandHex", "modeHex", "marked"], ["latitude", "longitude"]) ||
        (("latitude" in item) !== ("longitude" in item)) ||
        ("latitude" in item && !((item.latitude === null && item.longitude === null) ||
          typeof item.latitude === "number" && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90 &&
          typeof item.longitude === "number" && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180)) ||
        !text(item.id, 128) || ids.has(item.id as string) ||
        !["receivedAt", "frequencyKHz", "score"].every(key => typeof item[key] === "number" && Number.isFinite(item[key]) && (item[key] as number) >= 0) ||
        item.contestPoints !== null && (typeof item.contestPoints !== "number" || !Number.isFinite(item.contestPoints) || item.contestPoints < 0) ||
        item.contestDupe !== null && typeof item.contestDupe !== "boolean" ||
        item.contestMultiplierCount !== null && !uint(item.contestMultiplierCount) ||
        item.contestCountryMultiplier !== null && typeof item.contestCountryMultiplier !== "boolean" ||
        item.contestZoneMultiplier !== null && typeof item.contestZoneMultiplier !== "boolean" ||
        !uint(item.aggregateCount) || !["clusterName", "spotter", "frequencyText", "comment", "country", "continent", "callStatus",
          "dxccStatus", "source", "statusHex", "bandHex", "modeHex"].every(key => text(item[key], 512, true)) ||
        !text(item.callsign, 32) || !text(item.band, 16) || !text(item.mode, 16) ||
        !["spotterContinent", "adif", "cqZone", "ituZone", "workedBefore"].every(key => item[key] === null ||
          (key === "spotterContinent" ? text(item[key], 32, true) : uint(item[key]))) ||
        !texts(item.specialTags, 32, 64) || !texts(item.scoreReasons, 64, 160) || !texts(item.aggregateSpotters, 64, 64) ||
        typeof item.marked !== "boolean") return false;
    ids.add(item.id as string); return true;
  });
}
function validRemoteVFOProjection(value: Record<string, unknown>) {
  return exact(value, ["schemaVersion", "status", "radioFrequencyHz", "contestFrequencyHz", "band", "mode", "busy"]) &&
    optionalFrequency(value.radioFrequencyHz) && optionalFrequency(value.contestFrequencyHz) &&
    text(value.band, 16) && text(value.mode, 16) && typeof value.busy === "boolean";
}
function validScoreReportingProjection(value: Record<string, unknown>) {
  const services = value.services;
  return exact(value, ["schemaVersion", "status", "score", "intervalMinutes", "reportingEnabled", "availability", "reason", "service", "username",
      "credentialSaved", "reportState", "lastOutcome", "nextAttempt", "services", "busy"]) &&
    (value.score === null || validStatisticsScore(value.score)) && uint(value.intervalMinutes, 1_440) && (value.intervalMinutes as number) >= 1 &&
    typeof value.reportingEnabled === "boolean" && oneOf(value.availability, ["available", "unavailable"]) && text(value.reason, 512) &&
    oneOf(value.service, ["hamscore", "contestonlinescore"]) && text(value.username, 128, true) && typeof value.credentialSaved === "boolean" &&
    oneOf(value.reportState, ["disabled", "scheduled", "posting", "sent", "failed", "paused"]) && text(value.lastOutcome, 512) &&
    (value.nextAttempt === null || text(value.nextAttempt, 64)) &&
    Array.isArray(services) && services.length === 3 && services.every(service => record(service) &&
      exact(service, ["id", "name", "url", "transportSecurity"]) && oneOf(service.id, ["hamscore", "contestonlinescore", "contest-run"]) &&
      text(service.name, 80) && text(service.url, 256) && oneOf(service.transportSecurity, ["https", "legacy-http"])) &&
    typeof value.busy === "boolean";
}
function validMessagesProjection(value: Record<string, unknown>) {
  return exact(value, ["schemaVersion", "status", "messages", "busy"]) && Array.isArray(value.messages) && value.messages.length <= 32 &&
    value.messages.every(item => record(item) && exact(item, ["kind", "text"]) && oneOf(item.kind, ["error", "notice"]) && text(item.text, 512)) &&
    typeof value.busy === "boolean";
}

export function validContestSurfaceProjection(panelID: ContestSurfacePanelID, value: unknown): value is ContestSurfaceProjection {
  const projection = record(value) ? value : undefined;
  if (!projection || typeof projection.status !== "string") return false;
  if ((panelID === "active-qso" || panelID === "qrz-details") && projection.schemaVersion === 2 && projection.status === "ready") return validEntryProjectionV2(projection);
  if (panelID === "propagation" && projection.schemaVersion === 3 && projection.status === "ready") return validStatisticsProjectionV3(projection);
  if ((panelID === "awards" || panelID === "chaser-dx") && projection.schemaVersion === 4 && projection.status === "ready") return validMatrixProjection(projection);
  if ((panelID === "band-maps" || panelID === "world-map" || panelID === "dx-cluster") && projection.schemaVersion === 2 && projection.status === "ready") return validSpotProjection(projection);
  if (projection.schemaVersion !== 1) return false;
  if (projection.status === "unavailable") return optionalKeys(projection, ["schemaVersion", "status"],["reason"]) &&
    (projection.reason===undefined||text(projection.reason,512));
  if (projection.status !== "ready") return false;
  if (panelID === "active-qso" || panelID === "qrz-details") return validEntryProjection(projection);
  if (panelID === "callsign-intelligence") return validCheckProjection(projection);
  if (panelID === "propagation") return validStatisticsProjection(projection);
  if (panelID === "monitor") return validRatesProjection(projection);
  if (panelID === "awards" || panelID === "chaser-dx") return validMatrixProjection(projection);
  if (panelID === "logbook") return validLogProjection(projection);
  if (panelID === "station-control") return validRemoteVFOProjection(projection);
  if (panelID === "score-reporting") return validScoreReportingProjection(projection);
  if (panelID === "messages") return validMessagesProjection(projection);
  return false;
}

function validParams(action: string, params: Record<string, unknown>) {
  if (action === "spot_select" || action === "spot_confirm" || action === "spot_delete")
    return draft(params, ["spotID"]) && text(params.spotID, 128);
  if (action === "spot_set_marked") return draft(params, ["spotID", "marked"]) && text(params.spotID, 128) && typeof params.marked === "boolean";
  if (action === "spot_set_marked_only") return draft(params, ["markedOnly"]) && typeof params.markedOnly === "boolean";
  if (action === "spot_set_show_worked") return draft(params, ["showWorked"]) && typeof params.showWorked === "boolean";
  if (action === "entry_set_text") return draft(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport"]) && text(params.value, 160, true);
  if (action === "entry_cw_callsign") return draft(params,["sourceEpoch","spotID","spotVersion"]) &&
    [params.sourceEpoch,params.spotID,params.spotVersion].every(validContestSurfaceUUID);
  if (action === "entry_set_exchange") return draft(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "entry_set_frequency_text") return draft(params, ["value"], ["callsignCommand"]) && text(params.value, 11, true) &&
    (params.callsignCommand === undefined || params.callsignCommand === true);
  if (action === "entry_set_band") return draft(params, ["value"]) && text(params.value, 16);
  if (action === "entry_set_mode") return draft(params, ["value"], ["callsignCommand"]) && text(params.value, 16) &&
    (params.callsignCommand === undefined || params.callsignCommand === true);
  if (action === "entry_reserve_serial" || action === "entry_commit" || action === "entry_clear" || action === "entry_edit_last") return draft(params, []);
  if (action === "entry_spot" || action === "entry_mark_spot" || action === "entry_tune_spot") return draft(params, []);
  if (action === "entry_step_spot") return draft(params, ["direction"],["multiplierOnly"]) && oneOf(params.direction, ["previous", "next"]) && (params.multiplierOnly===undefined||typeof params.multiplierOnly==="boolean");
  if (action === "entry_step_vfo") return draft(params, ["direction"]) && oneOf(params.direction, ["up", "down"]);
  if (action === "entry_return_cq_frequency") return draft(params, []);
  if (action === "entry_operator_arm") return draft(params, ["armed"]) && typeof params.armed === "boolean";
  if (action === "entry_operator_style") return draft(params, ["value"]) && oneOf(params.value, ["run", "search-and-pounce"]);
  if (action === "entry_set_cw_speed") return draft(params, ["value"]) && uint(params.value, 100) && (params.value as number) >= 5;
  if (action === "entry_send_cw_text") return draft(params, ["value"]) && text(params.value, 80) && /^[\x20-\x7e]+$/.test(String(params.value));
  if (action === "entry_focus") return draft(params, ["fieldID"]) && oneOf(params.fieldID, contestInputFieldIDs);
  if (action === "entry_operator_key") return draft(params, ["key", "focusedField"], ["shifted"]) &&
    typeof params.key === "string" && /^(?:F(?:[1-9]|1[0-2])|Enter|Escape)$/.test(params.key) &&
    (params.focusedField === null || oneOf(params.focusedField, contestInputFieldIDs)) &&
    (params.shifted === undefined || typeof params.shifted === "boolean" && params.key === "F1");
  if (action === "assistance_query") return draft(params, ["inputCallsign"]) && text(params.inputCallsign, 32, true);
  if (action === "assistance_download" || action === "assistance_refresh") return draft(params, []);
  if (action === "assistance_select") return draft(params, ["kind", "candidateID"]) &&
    oneOf(params.kind, ["scp", "history", "log", "cluster"]) && text(params.candidateID, 160);
  if (action === "log_export_cabrillo" || action === "log_export_adif" || action === "log_export_edi") return exact(params, []);
  if (action === "log_import_adif") return exact(params, ["sourceName", "records"]) && text(params.sourceName, 255) &&
    Array.isArray(params.records) && params.records.length > 0 && params.records.length <= 20 && params.records.every(item =>
      record(item) && exact(item, ["qsoID", "timestamp", "frequencyHz", "mode", "fields"]) && validContestSurfaceUUID(item.qsoID) &&
      text(item.timestamp, 19) && uint(item.frequencyHz, 100_000_000_000) && item.mode === "SSB" && record(item.fields) &&
      exact(item.fields, ["callsign", "sent", "receive", "other_1", "other_2"]) && text(item.fields.callsign, 32) &&
      text(item.fields.sent, 16) && text(item.fields.receive, 16) && text(item.fields.other_1, 32) && text(item.fields.other_2, 16));
  if (action === "log_recalculate") return exact(params, ["expectedSessionRevision"]) && uint(params.expectedSessionRevision);
  if (action === "log_page") return exact(params, ["offset", "limit"]) && uint(params.offset, 1_000_000) &&
    uint(params.limit, 20) && (params.limit as number) > 0;
  if (action === "log_search") return exact(params,["query"]) && text(params.query,32,true);
  if (action === "log_focus") return qso(params,["callsign"]) && text(params.callsign,32);
  if (action === "log_correct_call") return qso(params,["expectedSessionRevision","expectedCall","callsign"]) &&
    uint(params.expectedSessionRevision) && text(params.expectedCall,32) && text(params.callsign,32);
  if (action === "log_edit_begin" || action === "log_edit_begin_delete" || action === "log_edit_cancel") return qso(params, []);
  if (action === "log_edit_set_text") return qso(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport", "timestamp", "operator", "name", "qth", "comment", "receiveFrequency", "power", "correctionReason", "deletionReason"]) && text(params.value, 1024, true);
  if (action === "log_edit_set_exchange") return qso(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "log_edit_set_frequency_text") return qso(params, ["value"]) && text(params.value, 11, true);
  if (action === "log_edit_set_band") return qso(params, ["value"]) && text(params.value, 16);
  if (action === "log_edit_confirm_delete") return qso(params, ["confirmed"]) && typeof params.confirmed === "boolean";
  if (action === "log_edit_save" || action === "log_edit_delete") return qso(params, ["expectedSessionRevision"]) && uint(params.expectedSessionRevision);
  if (action === "score_configure") return exact(params, ["service", "username", "password", "intervalMinutes", "enabled"]) &&
    oneOf(params.service, ["hamscore", "contestonlinescore"]) && text(params.username, 128, true) && text(params.password, 8192, true) &&
    uint(params.intervalMinutes, 60) && (params.intervalMinutes as number) >= 1 && typeof params.enabled === "boolean";
  if (action === "score_send_now") return exact(params, []);
  return false;
}

export function validContestSurfaceActionEnvelope(value: unknown): value is ContestSurfaceActionEnvelope {
  const envelope = record(value) ? value : undefined;
  const keys = ["operatingContext", "scope", "sessionID", "workspaceGeneration", "panelID", "projectionRevision", "requestID", "action", "params"];
  const action = typeof envelope?.action === "string" ? envelope.action : "";
  const panel = typeof envelope?.panelID === "string" ? envelope.panelID : "";
  const params = record(envelope?.params) ? envelope.params : undefined;
  const panelMatches = action.startsWith("spot_") ? panel === "band-maps" || panel === "dx-cluster" || ["world-map","awards","chaser-dx"].includes(panel) && action === "spot_select" : action.startsWith("entry_") ? panel === "active-qso" : action.startsWith("assistance_")
    ? panel === "callsign-intelligence" : action.startsWith("log_") ? panel === "logbook" : action.startsWith("score_") ? panel === "score-reporting" : false;
  return !!envelope && exact(envelope, keys) && validContestSurfaceUUID(envelope.operatingContext) && envelope.scope === "contesting" &&
      validContestSurfaceUUID(envelope.sessionID) && validContestSurfaceUUID(envelope.workspaceGeneration) && oneOf(panel, contestSurfacePanelIDs) &&
      uint(envelope.projectionRevision) && validContestSurfaceUUID(envelope.requestID) && !!params && panelMatches && validParams(action, params);
}
export function validateContestSurfaceActionEnvelope(value: unknown): asserts value is ContestSurfaceActionEnvelope {
  if (!validContestSurfaceActionEnvelope(value)) throw new Error("The contest surface action envelope could not be verified.");
}
