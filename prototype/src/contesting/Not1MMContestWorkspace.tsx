import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Download, Radio, Trophy } from "lucide-react";
import BandMaps, { type BandMapSpot } from "../live/BandMaps";
import ClusterPanel from "../live/ClusterPanel";
import { useSharedCW } from "../live/useSharedCW";
import { ContestAssistancePanel, type ContestSCPPanelSurface, type SCPSelectionScope } from "./ContestAssistancePanel";
import { ContestSetupPanel, newContestSetup, restoredESMPreferences, type ContestSetupDocument, type ContestSetupMacro, type SetupView } from "./ContestSetupPanel";
import { canonicalJSON, ContestMutationUncertain, ContestServerError, type ContestMutation } from "./client";
import { ContestEntryFields, ContestLogTable, ContestScoreSummary, ContestTextField, type ContestLogRow } from "./ContestPresentation";
import { nativeContestExportSave, type ContestExportSavePrepared } from "./contestExportSave";
import type { ContestRequest } from "./types";
import { contestInputFieldIDs, contestSurfacePanelIDs, type ContestInputFieldID, type ContestSurfaceActionEnvelope, type ContestSurfacePanelID,
  type ContestSurfaceProjection, type ContestManualRow, type ContestManualContext, type ContestPluginLogRow,
  type ContestStatisticsRow, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import type { ContestTransitionController } from "./ContestWorkspace";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";
import { openContestCallHistoryWindow, openContestSurfaceWindow } from "./contestSurfaceNative";
import { openContestSetupService } from "./contestSetupServices";
import { openContestSetupDialog, useContestSetupDialogs, type ContestDigitalSave, type ContestDigitalSnapshot } from "./contestSetupDialogs";
import { defaultContestKeyBindings, encodeContestKeyBindings, readContestKeyBindings, validateContestKeyBindings } from "./contestKeyBindings";
import { setContestCWSpeed } from "./contestStationControl";
import { configureContestGroupChat, openContestGroupChatWindow } from "./contestGroupChat";
import "./ContestWorkspace.css";

type Data = Record<string, any>;
type ContestFunctionKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Field = { id: string; label: string; accessibleName: string; value: string; visible: boolean; readOnly: boolean; enabled: boolean };
type Score = { qsos: number; points: number; countries: number; zones: number; multipliers?: number; uniqueCalls?: number; prefixes?: number; sections?: number; headquarters?: number; total: number };
type StatisticsState = { sessionID: string; revision: number; rows: ContestStatisticsRow[]; total: ContestStatisticsRow };
type Projection = {
  sessionID: string; engine: "not1mm-python"; pluginID: string; pluginName?: string; reservedSerial?: number | null; sourceRevision: string; referenceID: string;
  workspaceGeneration: string; revision: number; draftID: string; fields: Field[]; frequencyHz: number; mode: string; band: number;
  focus: string; tabNext: Record<string, string>; tabPrevious: Record<string, string>; advanceOnSpace?: string[]; run: boolean;
  functionKeys: Array<{ id: string; highlighted: boolean; label?: string; template?: string }>; dupe: boolean; dupeExplanation?: string; countryResolved: boolean;
  matrixTrackers?: Array<"countries" | "zones">;
  ruleIdentity?: { id: string; version: string; edition: string; sourceRevision: string };
  supportedBands?: string[]; supportedModes?: Array<"CW" | "SSB" | "RTTY" | "AM" | "FM">; allowDuplicateCommit?: boolean;
  columns?: string[];
  history: string; score: Score; operator?: string; roverLocation?: string; cwSpeedWpm?: number | null; callContext?: Partial<ContestManualContext> & {callsign?:string};
};
type Session = { sessionID: string; workspaceGeneration: string; name: string; pluginID: string; sourceRevision: string; revision: number };
type MutationResult = { operationID?: string; revision?: number; projection: Projection; actions?: Data[]; messages?: string[]; replayed?: boolean; outputError?: string; effectiveMacros?: ContestSetupMacro[] };
type PhoneIntentOrigin = Pick<Projection, "sessionID" | "workspaceGeneration" | "draftID" | "revision" | "sourceRevision">;
type PhoneSimulationTrace = { operationID: string; mode: "SSB"; macro: string; text: string; status: "confirmed" };
class PhoneSimulationStopped extends Error {
  constructor() { super("The contest phone simulation was stopped."); this.name = "PhoneSimulationStopped"; }
}
class PhoneSimulationClaimUncertain extends Error {
  constructor() {
    super("The phone output claim could not be confirmed. Reopen the contest session to reconcile its revision before sending another key.");
    this.name = "PhoneSimulationClaimUncertain";
  }
}
const phoneClaimReplyTimeoutMs = 2_000;
function abortPhoneWait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new PhoneSimulationStopped());
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(new PhoneSimulationStopped());
    signal.addEventListener("abort", stopped, { once: true });
    promise.then(value => { signal.removeEventListener("abort", stopped); resolve(value); },
      cause => { signal.removeEventListener("abort", stopped); reject(cause); });
  });
}
type Props = {
  request: Request;
  serviceRequest: Request;
  stationTune: (frequencyHz: number, mode: string) => Promise<unknown>;
  operatingContext: string;
  workspaceGeneration: string;
  stationCall: string;
  contestingTest?: boolean;
  radioFrequencyHz?: number;
  spots: BandMapSpot[];
  cluster: any;
  selectedSpotId?: string | null;
  onSelectedSpot?: (id: string) => void;
  onSetupViewChange?: (view: SetupView | null) => void;
  registerTransition?: (controller: ContestTransitionController | null) => void;
  registerMenuRoute?: (handler: ((route: string) => boolean | Promise<boolean>) | null) => void;
  setupOnly?: boolean;
};

const activeSessionKey = "xlog.contesting.not1mm.active-session.v1";
const setupDraftKey = "xlog.contesting.not1mm.setup-draft.v1";
const logPageSize = 20;
const bandLabels: Record<string, string> = { "1.8": "160m", "3.5": "80m", "7": "40m", "14": "20m", "21": "15m", "28": "10m" };
const contestBands = ["160m", "80m", "40m", "20m", "15m", "10m"];
const setupBandChoices = [...contestBands, "6m", "2m", "1.25m", "70cm", "33cm", "23cm"];
const contestPhoneIntentPlugins = new Set(["arrl_ss_phone", "cq_wpx_ssb", "cq_ww_ssb", "euhfc", "iaru_hf", "arrl_10m"]);
const serialPrefixPlugins = new Set(["cq_wpx_cw", "cq_wpx_ssb", "trans_tasman", "oceania_dx_cw", "oceania_dx_ssb"]);
const sweepstakesPlugins = new Set(["arrl_ss_cw", "arrl_ss_phone"]);
const contestInputFieldID = (value: unknown): value is ContestInputFieldID =>
  typeof value === "string" && contestInputFieldIDs.includes(value as ContestInputFieldID);
const contestTabMap = (value: Record<string, string>) => Object.fromEntries(Object.entries(value)
  .filter(([from, to]) => contestInputFieldID(from) && contestInputFieldID(to))) as Partial<Record<ContestInputFieldID, ContestInputFieldID>>;
const activeContestKeyBindings = (value: unknown) => {
  try { return validateContestKeyBindings(encodeContestKeyBindings(readContestKeyBindings(value))); }
  catch { return structuredClone(defaultContestKeyBindings); }
};
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest operation failed.";
const cqwwFrequency = (value: unknown): number | null => {
  const frequency = typeof value === "number" ? Math.round(value) : NaN;
  if (!Number.isSafeInteger(frequency)) return null;
  return [[1_800_000, 2_000_000], [3_500_000, 4_000_000], [7_000_000, 7_300_000],
    [14_000_000, 14_350_000], [21_000_000, 21_450_000], [28_000_000, 29_700_000]]
    .some(([low, high]) => frequency >= low && frequency <= high) ? frequency : null;
};
const manualFrequency = (value: string): number | null => {
  const mhz = Number(value.trim());
  return Number.isFinite(mhz) ? cqwwFrequency(mhz * 1_000_000) : null;
};

function restoredSetup(stationCall: string): ContestSetupDocument {
  const defaults = newContestSetup(stationCall);
  try {
    const raw = localStorage.getItem(setupDraftKey);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ContestSetupDocument>;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    return { ...defaults, ...saved,
      station: { ...defaults.station, ...(saved.station ?? {}) },
      settings: { ...defaults.settings, ...(saved.settings ?? {}) },
      preferences: { ...defaults.preferences, ...restoredESMPreferences(saved.preferences ?? {}) },
      network: { ...defaults.network, ...(saved.network ?? {}) },
      macros: Array.isArray(saved.macros) ? saved.macros : defaults.macros };
  } catch { return defaults; }
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The contest host returned an invalid response.");
  const frame = value as Data;
  if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") throw new Error("The contest host response could not be correlated.");
  if (!frame.ok) throw new ContestServerError(typeof frame.error?.code === "string" ? frame.error.code : "contest_rejected",
    typeof frame.error?.message === "string" ? frame.error.message : "The contest host rejected the operation.",
    frame.error?.outcome === "uncertain" ? "uncertain" : "confirmed");
  if (!frame.result || typeof frame.result !== "object" || Array.isArray(frame.result)) throw new Error("The contest host returned no result.");
  return frame.result as T;
}

async function payloadDigest(payload: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJSON(payload)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function projectionFields(projection: Projection | null) {
  return Object.fromEntries((projection?.fields ?? []).map(field => [field.id, field.value]));
}

function scoreSummary(score: Score | null, pluginID?: string) {
  if (!score) return null;
  const multiplierLabels = score.uniqueCalls !== undefined ? [`${score.uniqueCalls} unique calls`]
    : score.prefixes !== undefined ? [`${score.prefixes} prefixes`] : score.sections !== undefined ? [`${score.sections} sections`]
    : pluginID === "euhfc" ? [`${score.multipliers ?? 0} license years`]
    : pluginID === "iaru_hf" ? [`${score.headquarters ?? 0} headquarters`, `${score.zones} zones`]
    : [`${score.countries} countries`, `${score.zones} zones`];
  return { claimedScore: score.total, qsos: score.qsos, points: score.points,
    multipliers: score.multipliers ?? score.countries + score.zones, multiplierLabels,
    multiplierDisplayLabels: multiplierLabels, sourceVerification: "verified" as const };
}

function sameFields(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => (left[key] ?? "") === (right[key] ?? ""));
}

function canonicalWorkedAt(value: unknown) {
  const normalized = `${String(value ?? "").replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function receivedExchange(row: Data, pluginID?: string): string {
  if (pluginID === "euhfc") return String(row.NR ?? "");
  if (pluginID === "icwc_mst") return `${row.Name ?? ""} ${row.NR ?? ""}`.trim();
  if (pluginID === "cwo") return `${row.NR ?? ""} ${row.Name ?? ""}`.trim();
  if (pluginID && sweepstakesPlugins.has(pluginID)) return [row.NR, row.Prec, row.Call, row.CK, row.Sect].filter(value => value !== undefined && value !== "").join(" ");
  return String(pluginID && serialPrefixPlugins.has(pluginID) ? row.NR ?? "" : row.ZN ?? row.Exchange1 ?? "");
}
function correctionExchangeValues(row: Data, pluginID?: string) {
  if (pluginID === "cwt") {
    const name = String(row.Name ?? ""), packed = String(row.NR ?? "");
    const prefix = `${name} `;
    return { other_1: name, other_2: name && packed.toUpperCase().startsWith(prefix.toUpperCase()) ? packed.slice(prefix.length) : packed };
  }
  if (pluginID === "k1usn_sst") return { other_1: String(row.Name ?? ""), other_2: String(row.Sect ?? "") };
  return { other_1: String(row.SentNr ?? ""), other_2: receivedExchange(row, pluginID) };
}
function logRows(rows: Data[], pluginID?: string): ContestLogRow[] {
  return rows.map(row => ({
    qsoID: String(row.ID ?? ""), workedAt: canonicalWorkedAt(row.TS), callsign: String(row.Call ?? ""),
    band: bandLabels[String(row.Band)] ?? String(row.Band ?? ""), mode: String(row.Mode ?? "CW"),
    sentExchange: String(row.SentNr ?? ""), receivedExchange: receivedExchange(row, pluginID),
    points: Number(row.Points ?? 0), multiplierLabels: pluginID === "icwc_mst" || pluginID === "cwo" ? []
      : pluginID && serialPrefixPlugins.has(pluginID) ? [String(row.WPXPrefix ?? "")].filter(Boolean)
      : pluginID && sweepstakesPlugins.has(pluginID) ? [row.Sect ? `Section ${row.Sect}` : ""].filter(Boolean)
      : [String(row.CountryPrefix ?? ""), row.ZN ? `Zone ${row.ZN}` : ""].filter(Boolean),
  }));
}
function manualRows(rows: Data[]): ContestManualRow[] {
  return rows.map(row => ({ qsoID: String(row.ID ?? ""), TS: String(row.TS ?? ""), Call: String(row.Call ?? ""),
    Freq: String(row.Freq ?? ""), SNT: String(row.SNT ?? ""), RCV: String(row.RCV ?? ""), ZN: String(row.ZN ?? ""),
    SentNr: String(row.SentNr ?? ""), prefix: String(row.WPXPrefix || row.CountryPrefix || ""), Points: String(row.Points ?? "") }));
}
const pluginColumnFields: Record<string, string> = {
  "YYYY-MM-DD HH:MM:SS": "TS", Snt: "SNT", Rcv: "RCV", RcvNr: "NR", WPX: "WPXPrefix",
  PFX: "WPXPrefix", M1: "IsMultiplier1", M2: "IsMultiplier2", PTS: "Points",
};
function not1mmLogColumns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return [];
  const columns = value.map(column => typeof column === "string" ? column : "");
  return columns.every(column => column.trim() && column === column.trim() && new TextEncoder().encode(column).length <= 64) &&
    new Set(columns).size === columns.length && columns.filter(column => column === "Call").length === 1 ? columns : [];
}
function not1mmLogRows(rows: Data[], columns: string[]): ContestPluginLogRow[] {
  return rows.map(row => ({ qsoID: String(row.ID ?? ""), values: columns.map(column => {
    const value = row[pluginColumnFields[column] ?? column];
    if (column === "M1" || column === "M2") return value && value !== "0" ? "✓" : "";
    return String(value ?? "");
  }) }));
}

function partialCandidates(kind: "log" | "cluster", calls: unknown[], query: string) {
  if (!/^[A-Z0-9/]{1,32}$/.test(query)) return [];
  return [...new Set(calls.map(call => String(call ?? "").trim().toUpperCase())
    .filter(call => /^[A-Z0-9/]{1,32}$/.test(call) && call.includes(query)))].slice(0, 500)
    .map(callsign => ({ candidateID: `${kind}:${callsign}`, callsign }));
}

function contestSurfaceSpots(spots: BandMapSpot[]) {
  const ids = new Set<string>();
  return spots.slice(0, 2_000).flatMap(spot => {
    const id=String(spot.id??""),callsign=String(spot.callsign??"").trim().toUpperCase(),frequencyKHz=Number(spot.frequencyKHz),
      band=String(spot.band??"").trim(),mode=String(spot.mode??"").trim();
    if(!id.trim()||new TextEncoder().encode(id).length>128||ids.has(id)||!callsign||new TextEncoder().encode(callsign).length>32||
        !band||new TextEncoder().encode(band).length>16||!mode||new TextEncoder().encode(mode).length>16||
        !Number.isFinite(frequencyKHz)||frequencyKHz<0)return [];
    ids.add(id);
    const bounded=(value:unknown,maximum=512)=>{const text=String(value??"");return new TextEncoder().encode(text).length<=maximum?text:"";};
    const uintOrNull=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null;
    const strings=(value:unknown,maximum:number,bytes:number)=>Array.isArray(value)?value.filter(item=>typeof item==="string").slice(0,maximum).map(item=>bounded(item,bytes)):[];
    return [{id,receivedAt:Math.max(0,Number(spot.receivedAt)||0),clusterName:bounded(spot.clusterName),spotter:bounded(spot.spotter),
      spotterContinent:spot.spotterContinent==null?null:bounded(spot.spotterContinent,32),frequencyKHz,
      frequencyText:bounded(spot.frequencyText),callsign,comment:bounded(spot.comment),band,mode,
      country:bounded(spot.country),adif:uintOrNull(spot.adif),continent:bounded(spot.continent),cqZone:uintOrNull(spot.cqZone),
      ituZone:uintOrNull(spot.ituZone),callStatus:bounded(spot.callStatus),dxccStatus:bounded(spot.dxccStatus),
      workedBefore:uintOrNull(spot.workedBefore),specialTags:strings(spot.specialTags,32,64),score:Math.max(0,Number(spot.score)||0),
      scoreReasons:strings(spot.scoreReasons,64,160),aggregateCount:uintOrNull(spot.aggregateCount)??0,
      aggregateSpotters:strings(spot.aggregateSpotters,64,64),source:bounded(spot.source),statusHex:bounded(spot.statusHex),
      bandHex:bounded(spot.bandHex),modeHex:bounded(spot.modeHex)}];
  });
}

function multiplierMatrix(title: string, tracker: "dxcc" | "zone", values: Data[], busy: boolean,
    current: { dxcc: string | null; cqZone: number | null; ituZone: number | null }, zoneSystem: "cq" | "itu" | null) {
  const rows = new Map<string, Record<string, number>>();
  for (const item of values) {
    const label = String(item.value ?? "").trim() || "Unknown";
    const band = bandLabels[String(item.band)] ?? String(item.band ?? "");
    if (!contestBands.includes(band)) continue;
    const counts = rows.get(label) ?? Object.fromEntries(contestBands.map(value => [value, 0]));
    counts[band] = Number(item.qsos ?? 0); rows.set(label, counts);
  }
  return { schemaVersion: 4 as const, status: "ready" as const, title, tracker, zoneSystem, current, bands: contestBands,
    rows: [...rows.entries()].map(([label, counts]) => ({ label, counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0) })), total: rows.size, busy };
}

/** Keep volatile decoder counters/activity out of the setup mailbox revision fence. */
function boundedDigitalSnapshot(value: unknown): ContestDigitalSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>, configuration = source.configuration as Record<string, unknown> | undefined;
  if (!configuration || typeof configuration.enabled !== "boolean" || typeof configuration.address !== "string" ||
      typeof configuration.port !== "number" || typeof source.running !== "boolean" || typeof source.status !== "string" ||
      typeof source.receive_only !== "boolean") return undefined;
  return { configuration: { enabled: configuration.enabled, address: configuration.address, port: configuration.port },
    running: source.running, status: source.status, receive_only: source.receive_only };
}

export function Not1MMContestWorkspace({ request, serviceRequest, stationTune, operatingContext, workspaceGeneration, stationCall, radioFrequencyHz, spots, cluster,
  selectedSpotId, onSelectedSpot, onSetupViewChange, registerTransition, registerMenuRoute, setupOnly = false, contestingTest = false }: Props) {
  const [catalog, setCatalog] = useState<Data[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null), projectionRef = useRef<Projection | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({}), fieldsRef = useRef<Record<string, string>>({});
  const [rows, setRows] = useState<Data[]>([]), [score, setScore] = useState<Score | null>(null), [matrices, setMatrices] = useState<Data>({});
  const [statistics, setStatistics] = useState<StatisticsState | null | undefined>(null);
  const [rates, setRates] = useState<Data | null>(null);
  const [partial, setPartial] = useState<{sessionID:string;revision:number;query:string;rows:Data[]} | null>(null);
  const [manager, setManager] = useState(true), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [startupPending, setStartupPending] = useState(true);
  const [retiring, setRetiring] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [create, setCreate] = useState({ name: "CQ WW CW", cqZone: "15" });
  const [setup, setSetup] = useState<ContestSetupDocument>(() => restoredSetup(stationCall));
  const [digitalSnapshot, setDigitalSnapshot] = useState<ContestDigitalSnapshot | undefined>();
  const configuredBands = useMemo(() => {
    const selected = Array.isArray(setup.preferences.bands) ? setup.preferences.bands : contestBands;
    const supported = projection?.supportedBands?.length ? projection.supportedBands : setupBandChoices;
    return setupBandChoices.filter(band => selected.includes(band) && supported.includes(band));
  }, [setup.preferences.bands, projection?.supportedBands]);
  const [effectiveMacros, setEffectiveMacros] = useState<ContestSetupMacro[] | undefined>();
  const [phoneSimulationArmed, setPhoneSimulationArmed] = useState(false);
  const [phoneSimulationPending, setPhoneSimulationPending] = useState(false);
  const [phoneSimulationTrace, setPhoneSimulationTrace] = useState<PhoneSimulationTrace[]>([]);
  const phoneSimulationControllerRef = useRef<AbortController | null>(null);
  const phoneSimulationRecoveryRef = useRef<Promise<boolean> | null>(null);
  const [autoCQDeadlineMs, setAutoCQDeadlineMs] = useState<number | null>(null);
  const [autoCQNowMs, setAutoCQNowMs] = useState(() => Date.now());
  const autoCQActiveRef = useRef(false), autoCQTimerRef = useRef<number | null>(null);
  const autoCQHostActionRef = useRef<(method: string, extra?: Record<string, unknown>, throwFailures?: boolean,
    contestSurfaceRequestID?: string) => Promise<unknown>>(async () => null);
  const [manualFrequencyMHz, setManualFrequencyMHz] = useState("");
  const [editing, setEditing] = useState<Data | null>(null), [editCall, setEditCall] = useState(""), [editZone, setEditZone] = useState("");
  const [editTimestamp, setEditTimestamp] = useState(""), [editFrequencyMHz, setEditFrequencyMHz] = useState("");
  const [editOperator, setEditOperator] = useState(""), [editSent, setEditSent] = useState(""), [editReceived, setEditReceived] = useState("");
  const [editSentExchange, setEditSentExchange] = useState("");
  const [correctionReason, setCorrectionReason] = useState("Operator correction"), [deletionReason, setDeletionReason] = useState("Operator deletion");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logOffset, setLogOffset] = useState(0), [logTotal, setLogTotal] = useState(0);
  const [scpSurface, setSCPSurface] = useState<ContestSCPPanelSurface | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusRef = useRef("callsign");
  const spotCursorRef = useRef<{ context: string; spotID: string | null }>({ context: "", spotID: null });
  const editVersionRef = useRef(0);
  const flushDraftRef = useRef<() => Promise<Projection | null>>(async () => projectionRef.current);
  const cw = useSharedCW(projection?.sessionID ?? "not1mm-no-session", retiring, setupOnly);
  projectionRef.current = projection; fieldsRef.current = fields;
  const observedFrequencyHz = cqwwFrequency(radioFrequencyHz);
  const fallbackFrequencyHz = manualFrequency(manualFrequencyMHz);
  const operationFrequencyHz = observedFrequencyHz ?? fallbackFrequencyHz;
  const spotSelectionContext = `${operatingContext}/${workspaceGeneration}/${projection?.sessionID ?? "no-session"}`;
  const spotIDSignature = spots.map(spot => String(spot.id)).join("\u001f");
  useEffect(() => {
    const available = new Set(spots.map(spot => String(spot.id)));
    const selected = selectedSpotId == null ? null : String(selectedSpotId);
    const cursor = spotCursorRef.current;
    if (cursor.context !== spotSelectionContext) {
      spotCursorRef.current = { context: spotSelectionContext, spotID: selected !== null && available.has(selected) ? selected : null };
    } else if (selected !== null && available.has(selected) && selected !== cursor.spotID) {
      spotCursorRef.current = { context: spotSelectionContext, spotID: selected };
    } else if (cursor.spotID !== null && !available.has(cursor.spotID)) {
      spotCursorRef.current = { context: spotSelectionContext, spotID: null };
    }
  }, [spotSelectionContext, spotIDSignature, selectedSpotId]);
  const configuredAutoCQDelay = Number(setup.preferences.autoCQDelay ?? 15);
  const autoCQDelaySeconds = Number.isFinite(configuredAutoCQDelay) ? Math.min(3600, Math.max(1, configuredAutoCQDelay)) : 15;
  const phoneSimulationAvailable = Boolean(contestingTest && projection?.pluginID && contestPhoneIntentPlugins.has(projection.pluginID) && projection.mode === "SSB");
  useEffect(() => {
    phoneSimulationRecoveryRef.current = null;
    setPhoneSimulationArmed(false); setPhoneSimulationPending(false); setPhoneSimulationTrace([]);
  }, [contestingTest, projection?.sessionID, projection?.pluginID, projection?.mode]);
  const rememberSetup = (document: ContestSetupDocument) => {
    setSetup(document);
    try { localStorage.setItem(setupDraftKey, JSON.stringify(document)); } catch { /* storage is optional */ }
  };

  const result = async <T,>(method: string, params: Record<string, unknown> = {}) => unwrap<T>(await request(method, params));
  const partialQuery = (fields.callsign ?? "").trim().toUpperCase();
  const loggedCandidates = partialCandidates("log",
    partial?.sessionID === projection?.sessionID && partial?.revision === projection?.revision && partial?.query === partialQuery
      ? partial?.rows.map(row => row.Call) ?? [] : [], partialQuery);
  const clusterCandidates = partialCandidates("cluster", spots.map(spot => spot.callsign), partialQuery);
  useEffect(() => {
    let cancelled = false;
    if (!projection || !/^[A-Z0-9/]{1,32}$/.test(partialQuery)) { setPartial(null); return; }
    const {sessionID, revision} = projection;
    void result<Data>("contest_check_partial", {sessionID, expectedRevision:revision, query:partialQuery, limit:500})
      .then(value => { if (!cancelled) setPartial({sessionID, revision, query:partialQuery, rows:Array.isArray(value.rows)?value.rows:[]}); })
      .catch(() => { if (!cancelled) setPartial(null); });
    return () => { cancelled = true; };
  }, [projection?.sessionID, projection?.revision, partialQuery, request]);
  const acceptProjection = (next: Projection, inputVersion?: number) => {
    projectionRef.current = next; focusRef.current = next.focus; setProjection(next);
    const values = inputVersion !== undefined && editVersionRef.current !== inputVersion
      ? fieldsRef.current : projectionFields(next);
    fieldsRef.current = values; setFields(values);
  };
  const acceptSessionProjection = (next: Projection) => {
    if (projectionRef.current?.sessionID !== next.sessionID) {
      setRows([]); setLogOffset(0); setLogTotal(0); setPartial(null); setScore(null); setStatistics(null);
      setMatrices({}); setRates(null); setEditing(null);
    }
    acceptProjection(next);
  };
  const admitRates = (next: Data, sessionID: string, revision: number) => {
    const current = projectionRef.current;
    if (current?.sessionID !== sessionID || current.revision !== revision ||
        next.sessionID !== sessionID || next.revision !== revision) return false;
    setRates(next);
    return true;
  };
  const admitStatistics = (next: Data, sessionID: string, revision: number) => {
    const current = projectionRef.current;
    if (current?.sessionID !== sessionID || current.revision !== revision) return false;
    if (next.sessionID !== sessionID || next.revision !== revision) return false;
    const raw = next.statistics;
    if (raw === undefined) { setStatistics(undefined); return true; }
    const exactStatistics = !!raw && typeof raw === "object" && !Array.isArray(raw) &&
      Object.keys(raw).length === 2 && "rows" in raw && "total" in raw;
    const candidate = { schemaVersion: 3 as const, status: "ready" as const, score: scoreSummary(next.score as Score, current.pluginID),
      rows: raw?.rows, total: raw?.total, busy: false };
    if (!exactStatistics || !validContestSurfaceProjection("propagation", candidate)) {
      setStatistics(null); return false;
    }
    setStatistics({ sessionID, revision, rows: candidate.rows, total: candidate.total });
    return true;
  };
  const refresh = async (sessionID: string, next?: Projection, offset = 0) => {
    const expected = next ?? projectionRef.current;
    if (!expected || expected.sessionID !== sessionID) return;
    const revision = expected.revision;
    const [log, scoreResult, rateResult] = await Promise.all([
      result<Data>("contest_log_page", { sessionID, expectedRevision: revision,
        offset, limit: logPageSize }),
      result<Data>("contest_score", { sessionID, expectedRevision: revision }),
      result<Data>("contest_rates", { sessionID, expectedRevision: revision }),
    ]);
    const current = projectionRef.current;
    if (current?.sessionID !== sessionID || current.revision !== revision) return;
    setRows(Array.isArray(log.rows) ? log.rows : []); setLogOffset(Number(log.offset ?? offset)); setLogTotal(Number(log.total ?? 0));
    setScore(scoreResult.score as Score); setMatrices(scoreResult.matrices ?? {});
    admitStatistics(scoreResult, sessionID, revision);
    admitRates(rateResult, sessionID, revision);
  };
  useEffect(() => {
    const sessionID = projection?.sessionID;
    if (!sessionID) return;
    let cancelled = false;
    let sequence = 0;
    const timer = window.setInterval(() => {
      const requestSequence = ++sequence;
      void request("contest_rates", { sessionID }).then(value => {
        const next = unwrap<Data>(value);
        const current = projectionRef.current;
        if (cancelled || requestSequence !== sequence || !current) return;
        admitRates(next, sessionID, current.revision);
      }).catch(() => { /* Retain the last admitted snapshot until the next refresh. */ });
    }, 10_000);
    return () => { cancelled = true; sequence += 1; window.clearInterval(timer); };
  }, [projection?.sessionID, request]);
  const openSession = async (session: Session) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (projectionRef.current?.sessionID !== session.sessionID) await flushDraftRef.current();
      const opened = await result<{ projection: Projection }>("contest_open", {
        sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      });
      const setupResult = await result<{ setup: ContestSetupDocument; effectiveMacros?: ContestSetupMacro[] }>("contest_setup_get", { sessionID: session.sessionID });
      setEffectiveMacros(setupResult.effectiveMacros);
      setManualFrequencyMHz((opened.projection.frequencyHz / 1_000_000).toFixed(6));
      const current = projectionRef.current;
      const admitted = current?.sessionID === opened.projection.sessionID &&
        current.workspaceGeneration === opened.projection.workspaceGeneration && current.revision > opened.projection.revision
        ? current : opened.projection;
      acceptSessionProjection(admitted); phoneSimulationRecoveryRef.current = null;
      rememberSetup(setupResult.setup); await refresh(session.sessionID, admitted);
      localStorage.setItem(activeSessionKey, session.sessionID); if (!setupOnly) setManager(false); setEditing(null);
      await cw.controller.refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [available, list] = await Promise.all([
          result<Data>("contest_catalog"), result<{ sessions: Session[]; activeSessionID?: string | null }>("contest_sessions"),
        ]);
        if (!active) return;
        setCatalog(Array.isArray(available.plugins) ? available.plugins : []); setSessions(list.sessions);
        const stored = localStorage.getItem(activeSessionKey);
        const hostActive = list.activeSessionID
          ? list.sessions.find(session => session.sessionID === list.activeSessionID) : undefined;
        const storedActive = stored ? list.sessions.find(session => session.sessionID === stored) : undefined;
        const saved = hostActive ?? storedActive ?? (stored && list.sessions.length === 1 ? list.sessions[0] : undefined);
        if (stored && !storedActive && !hostActive) localStorage.removeItem(activeSessionKey);
        if (saved) await openSession(saved);
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        if (active) setStartupPending(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!registerTransition) return;
    registerTransition({
      freeze: () => setRetiring(true), resume: () => setRetiring(false),
      prepare: async () => {
        if (busyRef.current || editing) throw new Error("Finish the current contest edit before changing operating module.");
        await flushDraftRef.current();
        await cw.controller.stop();
      },
    });
    return () => registerTransition(null);
  }, [registerTransition, editing, cw.controller]);

  const mutate = async (method: string, base: Projection, extra: Record<string, unknown> = {}) => {
    const operationID = crypto.randomUUID();
    const payload = { sessionID: base.sessionID, operationID, expectedRevision: base.revision, draftID: base.draftID, ...extra };
    try { return await result<MutationResult>(method, payload); }
    catch (cause) {
      const durableMethods = new Set<ContestMutation["method"]>(["contest_draft_apply", "contest_focus", "contest_qso_commit", "contest_qso_correct", "contest_qso_delete"]);
      const uncertain = !(cause instanceof ContestServerError) || cause.outcome === "uncertain";
      if (uncertain && durableMethods.has(method as ContestMutation["method"])) {
        const operation: ContestMutation = { method: method as ContestMutation["method"], payload,
          scope: { sessionID: base.sessionID, workspaceGeneration: base.workspaceGeneration, requestID: operationID,
            expectedRevision: base.revision, draftID: base.draftID, payloadDigest: await payloadDigest(payload),
            operationTimestamp: new Date().toISOString() } };
        throw new ContestMutationUncertain(operation, cause);
      }
      throw cause;
    }
  };
  const flushDraft = async (supplied = projectionRef.current): Promise<Projection | null> => {
    if (!supplied) return null;
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid HF contest frequency before continuing.");
    const values = { ...fieldsRef.current }, inputVersion = editVersionRef.current;
    if (sameFields(values, projectionFields(supplied)) && operationFrequencyHz === supplied.frequencyHz) return supplied;
    const changed = await mutate("contest_draft_apply", supplied, { fields: values, frequencyHz: operationFrequencyHz });
    acceptProjection(changed.projection, inputVersion);
    return changed.projection;
  };
  flushDraftRef.current = () => flushDraft();
  const runMutation = async (operation: (base: Projection) => Promise<MutationResult>, refreshViews = true,
    flushBuffered = true, preserveConcurrentEdits = false, throwFailures = false,
    consumeOutput?: (changed: MutationResult, origin: Projection) => Promise<MutationResult>, signal?: AbortSignal,
    recoverStopped?: (recovery: Promise<boolean>) => void) => {
    let base = projectionRef.current;
    if (!base || busyRef.current || retiring) {
      if (throwFailures) throw new Error(!base ? "Open a contest session before editing it." : "The contest owner is busy.");
      return null;
    }
    const inputVersion = editVersionRef.current;
    let operationPromise: Promise<MutationResult> | null = null, committed: MutationResult | null = null, changed: MutationResult | null = null;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (flushBuffered) base = await flushDraft(base);
      if (!base) throw new Error("Open a contest session before editing it.");
      operationPromise = operation(base);
      changed = await (signal ? abortPhoneWait(operationPromise, signal) : operationPromise);
      committed = changed;
      if (changed.actions?.length && consumeOutput)
        changed = await (signal ? abortPhoneWait(consumeOutput(changed, base), signal) : consumeOutput(changed, base));
      acceptProjection(changed.projection, preserveConcurrentEdits ? inputVersion : undefined);
      if (refreshViews) await refresh(changed.projection.sessionID, changed.projection);
      for (const item of changed.messages ?? []) setNotice(item);
      if (changed.actions?.length) throw new Error("Contest output requires native operation admission; no renderer output was sent.");
      if (changed.outputError) setError(changed.outputError);
      return changed.projection;
    } catch (cause) {
      if ((cause instanceof PhoneSimulationStopped || cause instanceof PhoneSimulationClaimUncertain) && base) {
        const admitCommittedProjection = (settled: MutationResult) => {
          const current = projectionRef.current, next = settled.projection;
          const admitted = current?.sessionID === base!.sessionID && current.workspaceGeneration === base!.workspaceGeneration &&
            current.revision === base!.revision && next?.sessionID === base!.sessionID &&
            next.workspaceGeneration === base!.workspaceGeneration && settled.revision === next.revision;
          if (admitted)
            acceptProjection(next, preserveConcurrentEdits ? inputVersion : undefined);
          return admitted;
        };
        if (cause instanceof PhoneSimulationClaimUncertain && committed) admitCommittedProjection(committed);
        else if (changed) admitCommittedProjection(changed);
        else if (cause instanceof PhoneSimulationStopped && operationPromise)
          recoverStopped?.(operationPromise.then(admitCommittedProjection, () => false));
        if (cause instanceof PhoneSimulationClaimUncertain)
          recoverStopped?.(Promise.resolve(false));
      }
      if (!(cause instanceof PhoneSimulationStopped)) setError(errorMessage(cause));
      if (throwFailures && !(cause instanceof PhoneSimulationStopped)) throw cause;
      return null;
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const consumeContestPhoneSimulation = async (changed: MutationResult, origin: PhoneIntentOrigin): Promise<MutationResult> => {
    const controller = phoneSimulationControllerRef.current;
    if (!controller || controller.signal.aborted) throw new PhoneSimulationStopped();
    const operationID = changed.operationID;
    const actions = changed.actions ?? [];
    if (!operationID || changed.replayed !== false || changed.revision !== changed.projection.revision || !actions.length || actions.length > 12)
      throw new Error("The contest phone simulation result could not be verified; no output was replayed.");
    const traces: PhoneSimulationTrace[] = actions.map((action, index) => {
      const payload = typeof action.payload === "string" ? action.payload : "";
      const bytes = new TextEncoder().encode(payload).byteLength;
      const source = action.sourceMacro;
      if (action.actionID !== `${operationID}:${index}` || action.sessionID !== origin.sessionID ||
          action.draftID !== origin.draftID || action.kind !== "voice_keyer" || action.signal !== "phone" ||
          action.mode !== "SSB" || !/^F(?:[1-9]|1[0-2])$/.test(action.key) || typeof action.label !== "string" ||
          new TextEncoder().encode(action.label).byteLength > 160 || bytes > 4_096 || action.payloadUTF8Bytes !== bytes ||
          !/^[0-9a-f]{64}$/.test(action.payloadSHA256) || !/^[0-9a-f]{64}$/.test(action.sourceMacroSHA256) ||
          !source || typeof source !== "object" || source.key !== action.key || source.label !== action.label ||
          source.revision !== origin.sourceRevision)
        throw new Error("The contest phone voice-keyer intent could not be verified; no audio or PTT action was taken.");
      return { operationID: action.actionID, mode: "SSB", macro: action.label, text: payload, status: "confirmed" };
    });
    const claimParams = { sessionID: changed.projection.sessionID, operationID, revision: changed.projection.revision };
    const firstClaim = result<Data>("contest_output_claim", claimParams);
    let timer = 0;
    let claimed: Data | null = null;
    try {
      claimed = await Promise.race([firstClaim, new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("contest_phone_claim_reply_timeout")), phoneClaimReplyTimeoutMs);
      })]);
    } catch (cause) {
      const retryable = cause instanceof Error && cause.message === "contest_phone_claim_reply_timeout" ||
        cause instanceof ContestServerError && cause.outcome === "uncertain";
      if (!retryable) throw cause;
      try { claimed = await result<Data>("contest_output_claim", claimParams); }
      catch (retryCause) {
        if (retryCause instanceof ContestServerError && retryCause.outcome === "uncertain")
          throw new PhoneSimulationClaimUncertain();
        if (!(retryCause instanceof ContestServerError) || retryCause.code !== "output_consumed" || retryCause.outcome !== "confirmed")
          throw retryCause;
      }
    } finally { if (timer) window.clearTimeout(timer); }
    if (claimed && (claimed.claimed !== true || claimed.operationID !== operationID || canonicalJSON(claimed.actions) !== canonicalJSON(actions)))
      throw new Error("The contest phone simulation claim could not be verified; do not retry the key.");
    if (controller.signal.aborted || phoneSimulationControllerRef.current !== controller) throw new PhoneSimulationStopped();
    setPhoneSimulationTrace(items => [...items, ...traces].slice(-24));
    return { ...changed, actions: [] };
  };
  const hostAction = async (method: string, extra: Record<string, unknown> = {}, throwFailures = false,
      contestSurfaceRequestID?: string) => {
    const phoneAction = Boolean(projectionRef.current?.pluginID && contestPhoneIntentPlugins.has(projectionRef.current.pluginID) && projectionRef.current.mode === "SSB");
    if (phoneAction && (!phoneSimulationAvailable || !phoneSimulationArmed)) {
      const failure = new Error(phoneSimulationAvailable
        ? "Arm the nontransmitting phone simulation before using phone contest messages."
        : "Phone contest voice output is unavailable in production; no audio or PTT action was taken.");
      setError(failure.message); if (throwFailures) throw failure; return null;
    }
    if (phoneAction && phoneSimulationRecoveryRef.current) {
      const timeout = new Promise<false>(resolve => window.setTimeout(() => resolve(false), phoneClaimReplyTimeoutMs));
      const recovered = await Promise.race([phoneSimulationRecoveryRef.current, timeout]);
      if (!recovered) {
        const failure = new Error("The stopped phone operation is still unresolved. Reopen the contest session to reconcile its revision before sending another key.");
        setError(failure.message); if (throwFailures) throw failure; return null;
      }
      phoneSimulationRecoveryRef.current = null;
    }
    const phoneController = phoneAction ? new AbortController() : null;
    if (phoneController) { phoneSimulationControllerRef.current = phoneController; setPhoneSimulationPending(true); }
    try {
      const confirmed = await runMutation(async base => {
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid HF contest frequency before using ESM.");
    if (base.mode !== "CW")
      return mutate(method, base, { fields: fieldsRef.current, frequencyHz: operationFrequencyHz, ...extra });
    const operationID = crypto.randomUUID();
    const native = await cw.controller.executeContest({ operation: method === "contest_esm" ? "esm" : "function_key",
      operationID, sessionID: base.sessionID, expectedContestRevision: base.revision, draftID: base.draftID,
      fields: fieldsRef.current, frequencyHz: operationFrequencyHz, ...extra,
      ...(contestSurfaceRequestID ? { contestSurfaceRequestID } : {}) });
    const changed = native?.contestResult as (MutationResult & { operationID?: string }) | undefined;
    if (!changed?.projection || changed.operationID !== operationID) throw new Error(native?.error || "Contest CW operation was not confirmed. Use Stop and reopen the session before deciding what to do next.");
    return { ...changed, actions: [], outputError: native?.error || undefined };
      }, !phoneAction, false, false, throwFailures, phoneAction ? consumeContestPhoneSimulation : undefined, phoneController?.signal,
        recovery => { phoneSimulationRecoveryRef.current = recovery; });
      if (phoneAction && confirmed && !phoneController?.signal.aborted) void refresh(confirmed.sessionID, confirmed).catch(cause => {
        const current = projectionRef.current;
        if (current?.sessionID === confirmed.sessionID && current.revision === confirmed.revision) setError(errorMessage(cause));
      });
      return confirmed;
    }
    finally { if (phoneController && phoneSimulationControllerRef.current === phoneController) {
      phoneSimulationControllerRef.current = null; setPhoneSimulationPending(false);
    } }
  };
  autoCQHostActionRef.current = hostAction;

  const stopPhoneSimulation = () => {
    phoneSimulationControllerRef.current?.abort(); phoneSimulationControllerRef.current = null;
    setPhoneSimulationArmed(false); setPhoneSimulationPending(false);
  };

  const clearAutoCQ = () => {
    autoCQActiveRef.current = false;
    if (autoCQTimerRef.current !== null) window.clearTimeout(autoCQTimerRef.current);
    autoCQTimerRef.current = null; setAutoCQDeadlineMs(null);
  };
  const stopAutoCQ = async (stopOutput = true) => {
    clearAutoCQ();
    if (!stopOutput) return;
    if (phoneSimulationAvailable) stopPhoneSimulation(); else await cw.controller.stop();
  };
  const scheduleAutoCQ = () => {
    if (!autoCQActiveRef.current) return;
    const delayMs = autoCQDelaySeconds * 1000;
    setAutoCQNowMs(Date.now()); setAutoCQDeadlineMs(Date.now() + delayMs);
    autoCQTimerRef.current = window.setTimeout(() => { void (async () => {
      if (!autoCQActiveRef.current) return;
      try { await autoCQHostActionRef.current("contest_function_key", { key: "F1" }, true); }
      catch { clearAutoCQ(); return; }
      if (autoCQActiveRef.current) scheduleAutoCQ();
    })(); }, delayMs);
  };
  const startAutoCQ = async (contestSurfaceRequestID?: string) => {
    const active = projectionRef.current;
    if (!active) throw new Error("Open a contest before starting Auto CQ.");
    if (active.mode !== "CW" && !phoneSimulationAvailable) throw new Error("Auto CQ requires admitted CW output or Contesting Test phone simulation.");
    if (phoneSimulationAvailable ? !phoneSimulationArmed : !cw.state.armed) throw new Error("Arm the contest output before starting Auto CQ.");
    if (!active.run) await runMutation(base => mutate("contest_run_state", base, { run: true }), false, true, false, true);
    clearAutoCQ(); autoCQActiveRef.current = true; scheduleAutoCQ();
    try { await hostAction("contest_function_key", { key: "F1" }, true, contestSurfaceRequestID); }
    catch (cause) { clearAutoCQ(); throw cause; }
  };

  useEffect(() => {
    if (autoCQDeadlineMs === null) return;
    const ticker = window.setInterval(() => setAutoCQNowMs(Date.now()), 100);
    return () => window.clearInterval(ticker);
  }, [autoCQDeadlineMs]);
  useEffect(() => () => {
    autoCQActiveRef.current = false;
    if (autoCQTimerRef.current !== null) window.clearTimeout(autoCQTimerRef.current);
  }, []);
  useEffect(() => { clearAutoCQ(); }, [projection?.sessionID, projection?.mode, contestingTest, autoCQDelaySeconds]);

  useEffect(() => {
    if (!projection || editing) return;
    fieldRefs.current[projection.focus]?.focus();
  }, [projection?.focus, projection?.draftID, editing]);

  useEffect(() => {
    if (!projection || observedFrequencyHz === null || projection.frequencyHz === observedFrequencyHz || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: fieldsRef.current, frequencyHz: observedFrequencyHz,
    }), false, false, true);
  }, [observedFrequencyHz, projection?.sessionID, projection?.frequencyHz, retiring]);

  const createSession = async (document: ContestSetupDocument) => {
    const contestCall = String(document.station.Call || stationCall).trim().toUpperCase();
    if (!contestCall) throw new Error("Configure the xLog station callsign before creating a contest.");
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid HF contest frequency before creating a contest.");
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await flushDraftRef.current();
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workspaceGeneration))
        throw new Error("The current xLog workspace identity is unavailable. Reopen the workspace before creating a contest.");
      const sessionID = crypto.randomUUID();
      const created = await result<MutationResult>("contest_create", { sessionID, workspaceGeneration,
        operationID: crypto.randomUUID(), expectedRevision: 0,
        pluginID: document.pluginID, name: document.name.trim() || "CQ WW CW", station: { ...document.station, Call: contestCall },
        operator: document.operator.trim().toUpperCase() || contestCall, frequencyHz: operationFrequencyHz,
        settings: document.settings });
      const saved = await mutate("contest_setup_save", created.projection, { setup: document }) as MutationResult & { setup: ContestSetupDocument; effectiveMacros?: ContestSetupMacro[] };
      setEffectiveMacros(saved.effectiveMacros);
      acceptSessionProjection(saved.projection); rememberSetup(saved.setup); await refresh(saved.projection.sessionID, saved.projection);
      const list = await result<{ sessions: Session[] }>("contest_sessions"); setSessions(list.sessions);
      localStorage.setItem(activeSessionKey, saved.projection.sessionID); if (!setupOnly) setManager(false);
    } catch (cause) { setError(errorMessage(cause)); throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveSetup = async (document: ContestSetupDocument) => {
    if (!projectionRef.current) { rememberSetup(document); return; }
    let savedMacros: ContestSetupMacro[] | undefined;
    const saved = await runMutation(async base => {
      const response = await mutate("contest_setup_save", base, { setup: document });
      savedMacros = response.effectiveMacros;
      return response;
    },
      false, true, false, true);
    if (saved) { rememberSetup(document); setEffectiveMacros(savedMacros); }
  };
  useEffect(() => {
    if (!setupOnly) return;
    let active = true;
    const refreshDigital = () => void serviceRequest("wsjtx_snapshot").then(value => {
      if (active) setDigitalSnapshot(boundedDigitalSnapshot(value));
    }).catch(() => { if (active) setDigitalSnapshot(undefined); });
    refreshDigital(); const timer = window.setInterval(refreshDigital, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [setupOnly, serviceRequest]);
  useContestSetupDialogs({ enabled: setupOnly, context: `${operatingContext}/${workspaceGeneration}/${projection?.sessionID ?? "no-session"}`,
    document: setup, auxiliary: { roverLocation: projection?.roverLocation ?? "", activeSessionID: projection?.sessionID,
      effectiveMacros, diagnostics: {
      engine: "Not1MM Python", plugin: projection?.pluginID ?? "No open contest",
      version: projection?.ruleIdentity?.version ?? "26.10.11", source: projection?.sourceRevision ?? "7c8b499225a73f7f8f792246881bd7aefc05452f",
      reference: projection?.referenceID ?? "No active reference" }, digital: digitalSnapshot }, save: async document => {
      if (busyRef.current || retiring) throw new Error("Contest Setup is busy. Try again after it finishes.");
      await saveSetup(document);
    }, saveRover: async location => { await hostAction("contest_rover_location", { location }, true); },
    saveDigital: async ({ configuration, action }: ContestDigitalSave) => {
      if (busyRef.current || retiring) throw new Error("Contest Setup is busy. Try again after it finishes.");
      if (action === "stop") setDigitalSnapshot(boundedDigitalSnapshot(await serviceRequest("wsjtx_stop")));
      else {
        const configured = boundedDigitalSnapshot(await serviceRequest("wsjtx_configure", { configuration: { ...configuration, enabled: action === "start" ? true : configuration.enabled } }));
        setDigitalSnapshot(action === "start" ? boundedDigitalSnapshot(await serviceRequest("wsjtx_start")) : configured);
      }
    }, report: setError });

  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") { event.preventDefault(); void stopAutoCQ(); return; }
    if (!projection || busy || retiring) return;
    const target = event.target as HTMLInputElement;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === " " &&
        target.dataset.contestField === "callsign" && (fieldsRef.current.callsign ?? "").trim().toUpperCase() === "OPON") {
      event.preventDefault(); changeField("callsign", "");
      void openContestSetupDialog("operator").catch(cause => setError(errorMessage(cause))); return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === " " &&
        target.dataset.contestField === "callsign" && (fieldsRef.current.callsign ?? "").trim().toUpperCase() === "ROVE") {
      event.preventDefault(); changeField("callsign", "");
      void openContestSetupDialog("rover").catch(cause => setError(errorMessage(cause))); return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && /^F(?:[1-9]|1[0-2])$/.test(event.key)) {
      if (event.shiftKey && event.key !== "F1") return;
      event.preventDefault(); if (event.shiftKey) void startAutoCQ().catch(cause => setError(errorMessage(cause)));
      else void hostAction("contest_function_key", { key: event.key }); return;
    }
    if (event.key === "Enter") { event.preventDefault(); void hostAction("contest_esm", { field: focusRef.current }); return; }
    if (event.key === "Tab") {
      const target = event.target as HTMLInputElement, current = target.dataset.contestField;
      const next = current && (event.shiftKey ? projection.tabPrevious[current] : projection.tabNext[current]);
      if (next && fieldRefs.current[next]) { event.preventDefault(); fieldRefs.current[next]?.focus(); }
    }
  };
  const chooseSpot = async (spot: BandMapSpot, throwFailures = false) => {
    const frequencyHz = Math.round(Number(spot.frequencyKHz) * 1000);
    if (cqwwFrequency(frequencyHz) === null) {
      if (throwFailures) throw new Error("That spot has no valid HF contest frequency.");
      return;
    }
    const next = await runMutation(async base => {
      await stationTune(frequencyHz, base.mode);
      return mutate("contest_draft_apply", base, {
        fields: { ...fieldsRef.current, callsign: String(spot.callsign ?? "").toUpperCase() }, frequencyHz,
      });
    }, false, false, false, throwFailures);
    if (!next) return;
    spotCursorRef.current = { context: spotSelectionContext, spotID: String(spot.id) };
    setManualFrequencyMHz((frequencyHz / 1_000_000).toFixed(6));
    onSelectedSpot?.(String(spot.id));
    setNotice(`Loaded ${spot.callsign} after the selected radio confirmed one tune.`);
  };

  const exportCabrillo = async (throwFailures = false) => {
    const active = projectionRef.current;
    if (!active || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const prepared = await result<ContestExportSavePrepared & { filename?: string }>("contest_export_prepare", { sessionID: active.sessionID });
      const saved = await nativeContestExportSave(prepared);
      if (saved.status === "saved") setNotice(`Saved ${saved.filename}.`);
      else if (saved.status === "cancelled") setNotice("Cabrillo save cancelled.");
      else { setError(saved.message); if (throwFailures) throw new Error(saved.message); }
    } catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const beginEdit = async (qsoID: string, throwFailures = false) => {
    const active = projectionRef.current;
    const partialRows = partial?.sessionID===active?.sessionID && partial?.revision===active?.revision && partial?.query===(fieldsRef.current.callsign??"").trim().toUpperCase()?partial?.rows:[];
    const row = [...rows,...(partialRows??[])].find(item => String(item.ID) === qsoID);
    if (!row) { if (throwFailures) throw new Error("The selected contact is no longer in this log or its partial matches."); return; }
    if (busyRef.current || retiring) { if (throwFailures) throw new Error("The contest owner is busy."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      await flushDraftRef.current();
      const exchange = correctionExchangeValues(row, active?.pluginID);
      setEditing(row); setEditCall(String(row.Call ?? "")); setEditZone(exchange.other_2);
      setEditTimestamp(String(row.TS ?? "")); setEditFrequencyMHz((Number(row.Freq ?? 0) / 1000).toFixed(6));
      setEditOperator(String(row.Operator ?? "")); setEditSent(String(row.SNT ?? "")); setEditReceived(String(row.RCV ?? ""));
      setEditSentExchange(exchange.other_1); setCorrectionReason("Operator correction");
      setDeletionReason("Operator deletion"); setConfirmDelete(false);
    } catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCorrection = async (reason: string, throwFailures = false) => { if (!editing) return null;
    const frequencyHz = manualFrequency(editFrequencyMHz);
    if (frequencyHz === null) throw new Error("Enter a valid HF contest frequency before saving the correction.");
    const next = await runMutation(base => mutate("contest_qso_correct", base, { qsoID: editing.ID,
      timestamp: editTimestamp, frequencyHz, operator: editOperator,
      fields: { callsign: editCall.toUpperCase(), sent: editSent, receive: editReceived,
        other_1: editSentExchange, other_2: editZone }, reason }), true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const correct = (event: FormEvent) => { event.preventDefault();
    void saveCorrection(correctionReason).catch(cause => setError(errorMessage(cause))); };
  const deleteQSO = async (reason: string, throwFailures = false) => { if (!editing) return null;
    const next = await runMutation(base => mutate("contest_qso_delete", base, { qsoID: editing.ID, reason }),
      true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const remove = () => { if (!editing || !confirm(`Delete ${editing.Call} from this contest?`)) return;
    void deleteQSO(deletionReason).catch(cause => setError(errorMessage(cause))); };

  const scoreView = scoreSummary(score, projection?.pluginID);
  const visibleFields = projection?.fields.filter(field => field.visible) ?? [];
  const changeField = (field: string, value: string) => {
    if (field === "callsign" && autoCQActiveRef.current) void stopAutoCQ();
    editVersionRef.current += 1;
    const next = { ...fieldsRef.current, [field]: value };
    fieldsRef.current = next; setFields(next);
  };
  const focusField = (field: string) => {
    focusRef.current = field;
    if (projectionRef.current?.focus === field || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_focus", base, { field }), false, true, true);
  };
  const syncManualFrequency = () => {
    if (observedFrequencyHz !== null || fallbackFrequencyHz === null || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: fieldsRef.current, frequencyHz: fallbackFrequencyHz,
    }), false, false, true);
  };
  const loadLogPage = async (offset: number, throwFailures = false) => {
    const active = projectionRef.current;
    if (!active || busyRef.current || offset < 0) {
      if (throwFailures) throw new Error(!active ? "Open a contest session before paging its log." : "The contest owner is busy.");
      return;
    }
    busyRef.current = true; setBusy(true); setError("");
    try { await refresh(active.sessionID, active, offset); }
    catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const detachedAvailable = !!projection && projection.workspaceGeneration === workspaceGeneration;
  const activeSessionName = sessions.find(session => session.sessionID === projection?.sessionID)?.name || create.name.trim() || "CQ WW CW";
  const unavailableProjection = { schemaVersion: 1, status: "unavailable" } as const;
  const surfaceProjections = useMemo(() => {
    const unavailable = Object.fromEntries(contestSurfacePanelIDs.map(panelID => [panelID, unavailableProjection])) as
      Record<ContestSurfacePanelID, ContestSurfaceProjection>;
    if (!projection || !detachedAvailable) return unavailable;
    const currentFields = fields;
    const frequencyHz = operationFrequencyHz;
    const reservedSerial = projection.reservedSerial ?? null;
    const exchangeFields = projection.fields.filter(field => (field.id === "other_1" || field.id === "other_2") && field.visible);
    const receivedExchangeFields = exchangeFields.filter(field => field.enabled && !field.readOnly && !(field.id === "other_1" && reservedSerial !== null));
    const sentExchangeFields = projection.fields.filter(field =>
      (field.id === "other_1" || field.id === "other_2") && (field.visible && field.readOnly || field.id === "other_1" && reservedSerial !== null));
    const receivedZone = projection.fields.find(field => field.id === "other_2");
    const sentZone = projection.fields.find(field => field.id === "other_1");
    const reportsVisible = projection.fields.some(field => field.id === "sent" && field.visible);
    const editedFrequencyHz = editing ? manualFrequency(editFrequencyMHz) : null;
    const callContext = projection.callContext?.callsign === partialQuery ? projection.callContext : undefined;
    unavailable["active-qso"] = {
      schemaVersion: 2, status: "ready",
      manual: {operator:projection.operator ?? "", cwSpeedWpm:projection.cwSpeedWpm ?? null,
        country:callContext?.country ?? null, cqZone:callContext?.cqZone ?? null, ituZone:callContext?.ituZone ?? null,
        headingDegrees:callContext?.headingDegrees ?? null, longPathHeadingDegrees:callContext?.longPathHeadingDegrees ?? null,
        distanceKm:callContext?.distanceKm ?? null, qsos:projection.score.qsos, multipliers:projection.score.multipliers ?? projection.score.countries + projection.score.zones, total:projection.score.total},
      session: { name: activeSessionName, ruleName: projection.pluginName ?? projection.pluginID, mode: projection.mode },
      draft: {
        draftID: projection.draftID, revision: projection.revision, callsign: currentFields.callsign ?? "",
        sentReport: currentFields.sent ?? "", receivedReport: currentFields.receive ?? "",
        receivedFields: receivedExchangeFields.map(field => ({ id: field.id, label: field.label,
          value: currentFields[field.id] ?? "", required: true, maximumUTF8Bytes: field.id === "other_1" ? 32 : 128 })),
        frequencyHz, frequencyText: frequencyHz === null ? "" : String(frequencyHz),
        frequencyError: frequencyHz === null ? "Enter a valid HF contest frequency." : "",
        band: bandLabels[String(projection.band)] ?? String(projection.band), mode: projection.mode,
        dupe: { state: projection.dupe ? "duplicate" : "clear", reason: projection.dupe
          ? projection.dupeExplanation ?? "Worked on this band." : "Clear for this contest." },
        validation: { errors: [], warnings: projection.countryResolved ? [] : ["Country is unresolved; scoring credit may be zero."] },
        reservedSerial,
      },
      descriptor: {
        bands: configuredBands, modes: projection.supportedModes?.length ? projection.supportedModes : ["CW"], reportsVisible,
        allowDuplicateCommit: projection.allowDuplicateCommit ?? false, automaticSerial: reservedSerial !== null,
        advanceOnSpace: (projection.advanceOnSpace ?? ["callsign"]).filter(contestInputFieldID),
        keyBindings: activeContestKeyBindings(setup.preferences.keyBindings),
        sentFields: sentExchangeFields.map(field => ({ id: field.id, label: field.label,
          value: currentFields[field.id] ?? "", required: true, maximumUTF8Bytes: 32 })),
        serial: reservedSerial === null ? { requirement: "none", allocatedFieldID: null, reservedSerial: null }
          : { requirement: "requiredForCommit", allocatedFieldID: "other_1", reservedSerial },
      },
      operator: {
        output: phoneSimulationAvailable || cw.state.canonical?.provider === "test-simulation" ? "test-simulation" : "xlog-native",
        armed: phoneSimulationAvailable ? phoneSimulationArmed : projection.mode === "CW" && cw.state.armed,
        style: projection.run ? "run" : "search-and-pounce",
        status: phoneSimulationAvailable ? phoneSimulationPending ? "waiting" : phoneSimulationArmed ? "armed" : "disarmed"
          : cw.state.pending ? "waiting" : cw.state.error ? "uncertain" : cw.state.armed ? "armed" : "disarmed",
        pending: phoneSimulationAvailable && phoneSimulationPending || !phoneSimulationAvailable && cw.state.pending ? "send" : null,
        focusedField: contestInputFieldID(projection.focus) ? projection.focus : null,
        tabNext: contestTabMap(projection.tabNext), tabPrevious: contestTabMap(projection.tabPrevious),
        functionKeys: projection.mode === "CW" || phoneSimulationAvailable
          ? projection.functionKeys.map(item => ({ key: item.id as ContestFunctionKey, macro: item.label ?? item.id })) : [],
        autoCQ: { active: autoCQDeadlineMs !== null, delaySeconds: autoCQDelaySeconds,
          remainingMs: autoCQDeadlineMs === null ? null : Math.max(0, autoCQDeadlineMs - autoCQNowMs) },
        readiness: { canSendCQ: phoneSimulationAvailable ? phoneSimulationArmed : projection.mode === "CW" && cw.state.armed,
          canSendCall: phoneSimulationAvailable ? phoneSimulationArmed : projection.mode === "CW" && cw.state.armed,
          canSendDuplicate: phoneSimulationAvailable ? phoneSimulationArmed : projection.mode === "CW" && cw.state.armed,
          canReserveCall: false, canReserveCommit: false, canCommit: true },
        trace: phoneSimulationAvailable ? phoneSimulationTrace : [],
      },
      busy: busy || retiring,
      dirty: !sameFields(currentFields, projectionFields(projection)) || frequencyHz !== projection.frequencyHz,
      uncertain: false,
    };
    unavailable["qrz-details"] = unavailable["active-qso"];
    const partialRows = partial?.sessionID===projection.sessionID && partial.revision===projection.revision && partial.query===partialQuery
      ? partial.rows : [];
    const pluginColumns = not1mmLogColumns(projection.columns);
    unavailable.logbook = {
      schemaVersion: 1, status: "ready", sessionRevision: projection.revision,
      canExportCabrillo: true,
      page: { offset: logOffset, limit: logPageSize, total: logTotal, rows: logRows(rows, projection.pluginID) },
      ...(pluginColumns.length ? { exchangeLayout: "plugin" as const, pluginColumns,
        pluginRows:not1mmLogRows(rows,pluginColumns), pluginPartialRows:not1mmLogRows(partialRows,pluginColumns) }
        : { manualRows:manualRows(rows), partialRows:manualRows(partialRows) }),
      editing: editing ? {
        qsoID: String(editing.ID ?? ""), workedAt: editTimestamp, operator: editOperator, callsign: editCall, reportsVisible,
        band: bandLabels[String(editing.Band)] ?? String(editing.Band ?? ""), mode: String(editing.Mode ?? "CW"),
        sentReport: editSent, receivedReport: editReceived,
        receivedFields: [
          { id: "other_1", label: sentZone?.label || "Sent exchange", value: editSentExchange, required: true, maximumUTF8Bytes: 32 },
          { id: "other_2", label: receivedZone?.label || "Received exchange", value: editZone, required: true, maximumUTF8Bytes: 128 },
        ],
        frequencyHz: editedFrequencyHz, editFrequencyText: editedFrequencyHz === null ? "" : String(editedFrequencyHz),
        frequencyError: editedFrequencyHz === null ? "Enter a valid HF contest frequency." : "",
        correctionReason, confirmDelete, deletionReason,
      } : null,
      busy: busy || retiring,
    };
    unavailable["callsign-intelligence"] = {
      schemaVersion: 1, status: "ready", draftID: projection.draftID, draftRevision: projection.revision,
      inputCallsign: currentFields.callsign ?? "",
      loggedCalls:loggedCandidates.map(candidate => candidate.callsign),
      clusterCalls:clusterCandidates.map(candidate => candidate.callsign),
      loggedCandidates, clusterCandidates,
      scp: { source: scpSurface?.source ?? null, candidates: scpSurface?.candidates ?? [] },
      history: { source: null, rows: [] },
      busy: !!scpSurface?.busy,
    };
    const sharedSpots=contestSurfaceSpots(spots);
    const clusterSnapshot=cluster?.snapshot as Data|undefined;
    const connectedClusters=Number.isSafeInteger(clusterSnapshot?.connectedClusters)&&Number(clusterSnapshot?.connectedClusters)>=0
      ? Number(clusterSnapshot?.connectedClusters):0;
    const loadedSpots=Number.isSafeInteger(clusterSnapshot?.loadedSpots)&&Number(clusterSnapshot?.loadedSpots)>=0
      ? Number(clusterSnapshot?.loadedSpots):sharedSpots.length;
    for(const panelID of ["band-maps","dx-cluster"] as const) unavailable[panelID]={schemaVersion:1,status:"ready",
      draftID:projection.draftID,draftRevision:projection.revision,radioFrequencyHz:radioFrequencyHz??null,
      connectedClusters,loadedSpots,spots:sharedSpots,busy:busy||retiring};
    if (statistics?.sessionID === projection.sessionID && statistics.revision === projection.revision) {
      unavailable.propagation = { schemaVersion: 3, status: "ready", score: scoreView,
        rows: statistics.rows, total: statistics.total, busy: busy || retiring };
    }
    else if (statistics === undefined) unavailable.propagation = {
      schemaVersion: 1, status: "ready", score: scoreView, busy: busy || retiring,
    };
    if (rates) unavailable.monitor = { schemaVersion: 1, status: "ready",
      lastHourQsoPerHour: rates.lastHourQsoPerHour ?? null, last10QsoPerHour: rates.last10QsoPerHour ?? null,
      last100QsoPerHour: rates.last100QsoPerHour ?? null, sinceHourUTC: Number(rates.sinceHourUTC),
      sinceHourQso: Number(rates.sinceHourQso), runQso: Number(rates.runQso),
      searchAndPounceQso: Number(rates.searchAndPounceQso), hourRunQso: Number(rates.hourRunQso),
      hourSearchAndPounceQso: Number(rates.hourSearchAndPounceQso), busy: busy || retiring };
    // An empty worker matrix is a valid tracker with no worked multipliers yet.
    // Missing matrices remain unavailable for plugins that do not expose them.
    if (projection.matrixTrackers?.includes("countries") && Array.isArray(matrices.countries)) {
      unavailable.awards = multiplierMatrix("DXCC", "dxcc", matrices.countries, busy || retiring,
        { dxcc: callContext?.country ?? null, cqZone: callContext?.cqZone ?? null, ituZone: callContext?.ituZone ?? null }, null);
    }
    if (projection.matrixTrackers?.includes("zones") && Array.isArray(matrices.zones)) {
      const zoneLabel = receivedZone?.label.toUpperCase() ?? "";
      const zoneSystem = zoneLabel.includes("ITU") || zoneLabel.includes("IARU") ? "itu" as const : "cq" as const;
      unavailable["chaser-dx"] = multiplierMatrix(zoneSystem === "itu" ? "ITU Zones" : "CQ Zones", "zone", matrices.zones, busy || retiring,
        { dxcc: callContext?.country ?? null, cqZone: callContext?.cqZone ?? null, ituZone: callContext?.ituZone ?? null }, zoneSystem);
    }
    return unavailable;
  }, [projection, detachedAvailable, activeSessionName, fields, operationFrequencyHz, rows, logOffset, logTotal, editing,
    editCall, editTimestamp, editFrequencyMHz, editOperator, editSent, editReceived, editSentExchange, editZone, correctionReason, confirmDelete, deletionReason,
    busy, retiring, scpSurface, cw.state.armed, cw.state.pending, cw.state.error, phoneSimulationAvailable, phoneSimulationArmed,
    phoneSimulationPending, phoneSimulationTrace, rates, matrices, statistics, partial, partialQuery, spots, cluster, configuredBands,
    setup.settings.SentExchange, setup.preferences.keyBindings, autoCQDeadlineMs, autoCQNowMs, autoCQDelaySeconds]);

  const surfaceContext = detachedAvailable && projection ? {
    operatingContext, sessionID: projection.sessionID, workspaceGeneration: projection.workspaceGeneration,
  } : null;
  const handleSurfaceAction = async (action: ContestSurfaceActionEnvelope) => {
    const active = projectionRef.current;
    if (!active || !detachedAvailable || action.sessionID !== active.sessionID ||
        action.workspaceGeneration !== active.workspaceGeneration || action.operatingContext !== operatingContext)
      throw new Error("This detached panel no longer belongs to the active contest session.");
    if (action.action === "entry_operator_key" && action.params.key === "Escape") {
      await stopAutoCQ(); return;
    }
    if (busyRef.current || retiring) throw new Error("The contest owner is busy.");
    if (action.action.startsWith("entry_") || action.action.startsWith("assistance_") || action.action === "spot_select") {
      if (!("draftID" in action.params) || action.params.draftID !== active.draftID ||
          action.params.expectedDraftRevision !== active.revision)
        throw new Error("The contest entry changed before this action reached the owner.");
    }
    const persistFields = async (fieldID: string, value: string) => {
      if (fieldID === "callsign" && autoCQActiveRef.current) await stopAutoCQ();
      const next = { ...fieldsRef.current, [fieldID]: value };
      fieldsRef.current = next; setFields(next); editVersionRef.current += 1;
      await runMutation(base => mutate("contest_draft_apply", base, { fields: next,
        frequencyHz: operationFrequencyHz ?? base.frequencyHz }), false, false, false, true);
    };
    const requireEditing = (qsoID: string) => {
      if (!editing || String(editing.ID ?? "") !== qsoID) throw new Error("Open this contact in the shared log editor first.");
    };
    switch (action.action) {
      case "spot_select": {
        const spot=spots.find(candidate=>String(candidate.id)===action.params.spotID);
        if(!spot)throw new Error("That shared spot is no longer available.");
        await chooseSpot(spot, true); return;
      }
      case "entry_set_text": {
        const fieldID = { callsign: "callsign", sentReport: "sent", receivedReport: "receive" }[action.params.field];
        await persistFields(fieldID, action.params.field === "callsign" ? action.params.value.toUpperCase() : action.params.value); return;
      }
      case "entry_set_exchange":
        if (!active.fields.some(field => field.id === action.params.fieldID && field.visible && field.enabled && !field.readOnly))
          throw new Error("This contest entry field is not editable here.");
        await persistFields(action.params.fieldID, action.params.value.toUpperCase()); return;
      case "entry_set_frequency_text": {
        if (observedFrequencyHz !== null) throw new Error("Frequency follows the selected xLog radio and cannot be edited here.");
        const frequencyHz = /^\d+$/.test(action.params.value) ? cqwwFrequency(Number(action.params.value)) : null;
        if (frequencyHz === null) throw new Error("Enter a valid HF contest frequency in Hz.");
        setManualFrequencyMHz((frequencyHz / 1_000_000).toFixed(6));
        await runMutation(base => mutate("contest_draft_apply", base, { fields: fieldsRef.current, frequencyHz }), false, false, false, true);
        return;
      }
      case "entry_set_band":
        if (action.params.value !== (bandLabels[String(active.band)] ?? String(active.band)))
          throw new Error("Band follows the admitted contest frequency.");
        return;
      case "entry_set_mode":
        { const nextMode = action.params.value as NonNullable<Projection["supportedModes"]>[number];
        if (!active.supportedModes?.includes(nextMode)) throw new Error("This contest does not support that operating mode.");
        if (nextMode !== active.mode) {
          const previousDefault = active.mode === "SSB" ? "59" : "599";
          const modeFields = Object.fromEntries(Object.entries(fieldsRef.current).filter(([fieldID, value]) =>
            !((fieldID === "sent" || fieldID === "receive") && value === previousDefault)));
          await runMutation(base => mutate("contest_draft_apply", base, { fields: modeFields,
            frequencyHz: operationFrequencyHz ?? base.frequencyHz, mode: nextMode }), false, false, false, true);
        }
        return; }
      case "entry_reserve_serial": throw new Error("Serial numbers are allocated automatically by the contest host.");
      case "entry_clear": {
        const defaultReport = active.mode === "SSB" ? "59" : "599";
        const cleared = Object.fromEntries(active.fields.map(field => [field.id,
          field.id === "callsign" ? "" : field.id === "sent" || field.id === "receive" ? defaultReport
            : field.readOnly || field.id === "other_1" && active.reservedSerial !== null ? field.value : ""]));
        fieldsRef.current = cleared; setFields(cleared); editVersionRef.current += 1;
        await runMutation(base => mutate("contest_draft_apply", base, { fields: cleared,
          frequencyHz: operationFrequencyHz ?? base.frequencyHz }), false, true, true, true);
        return;
      }
      case "entry_step_spot": {
        if (!spots.length) throw new Error("No shared contest spots are available.");
        const cursor = spotCursorRef.current.context === spotSelectionContext ? spotCursorRef.current.spotID : null;
        const current = cursor == null ? -1 : spots.findIndex(spot => String(spot.id) === cursor);
        const nextIndex = action.params.direction === "next"
          ? current < 0 || current + 1 >= spots.length ? 0 : current + 1
          : current <= 0 ? spots.length - 1 : current - 1;
        await chooseSpot(spots[nextIndex], true); return;
      }
      case "entry_commit":
        await runMutation(base => mutate("contest_qso_commit", base, { fields: fieldsRef.current, frequencyHz: base.frequencyHz }),
          true, true, false, true); return;
      case "entry_operator_arm":
        if (!action.params.armed) clearAutoCQ();
        if (phoneSimulationAvailable) { setPhoneSimulationArmed(action.params.armed); return; }
        if (active.mode !== "CW") throw new Error("This contest does not support admitted output.");
        if (action.params.armed) await cw.controller.arm(action.requestID); else await cw.controller.stop();
        return;
      case "entry_operator_style":
        await runMutation(base => mutate("contest_run_state", base, { run: action.params.value === "run" }), false,
          true, false, true);
        return;
      case "entry_set_cw_speed": {
        if (active.mode !== "CW") throw new Error("This contest does not support CW output.");
        await setContestCWSpeed(action.params.value);
        const document = { ...setup, preferences: { ...setup.preferences, cwSpeed: action.params.value } };
        const saved = await mutate("contest_setup_save", active, { setup: document }) as MutationResult & { setup: ContestSetupDocument };
        acceptProjection(saved.projection); setSetup(saved.setup); return;
      }
      case "entry_focus":
        if (!active.fields.some(field => field.id === action.params.fieldID && field.visible && field.enabled))
          throw new Error("This contest field is not available for focus.");
        await runMutation(base => mutate("contest_focus", base, { field: action.params.fieldID }), false,
          true, true, true);
        return;
      case "entry_operator_key":
        if (action.params.key === "Enter") {
          await hostAction("contest_esm", { field: action.params.focusedField ?? active.focus }, true, action.requestID); return;
        }
        if (action.params.shifted) { await startAutoCQ(action.requestID); return; }
        await hostAction("contest_function_key", { key: action.params.key }, true, action.requestID); return;
      case "assistance_query": await persistFields("callsign", action.params.inputCallsign.toUpperCase()); return;
      case "assistance_select":
        if (action.params.kind === "log" || action.params.kind === "cluster") {
          const candidates = action.params.kind === "log" ? loggedCandidates : clusterCandidates;
          const candidate = candidates.find(item => item.candidateID === action.params.candidateID);
          if (!candidate) throw new Error("The callsign candidate is no longer available.");
          await persistFields("callsign", candidate.callsign);
        }
        else if (action.params.kind === "scp" && scpSurface) await scpSurface.selectCandidate(action.params.candidateID);
        else throw new Error("The callsign candidate set is unavailable.");
        return;
      case "log_export_cabrillo": await exportCabrillo(true); return;
      case "log_page": await loadLogPage(action.params.offset, true); return;
      case "log_edit_begin": await beginEdit(action.params.qsoID, true); return;
      case "log_edit_cancel": requireEditing(action.params.qsoID); setEditing(null); setConfirmDelete(false); return;
      case "log_edit_set_text":
        requireEditing(action.params.qsoID);
        if (action.params.field === "callsign") setEditCall(action.params.value.toUpperCase());
        else if (action.params.field === "sentReport") setEditSent(action.params.value);
        else if (action.params.field === "receivedReport") setEditReceived(action.params.value);
        else if (action.params.field === "timestamp") setEditTimestamp(action.params.value);
        else if (action.params.field === "operator") setEditOperator(action.params.value.toUpperCase());
        else if (action.params.field === "correctionReason") setCorrectionReason(action.params.value);
        else setDeletionReason(action.params.value);
        return;
      case "log_edit_set_exchange":
        requireEditing(action.params.qsoID);
        if (action.params.fieldID === "other_1") setEditSentExchange(action.params.value);
        else if (action.params.fieldID === "other_2") setEditZone(action.params.value);
        else throw new Error("This contest log field is not editable here.");
        return;
      case "log_edit_set_frequency_text": {
        requireEditing(action.params.qsoID);
        const frequencyHz = /^\d+$/.test(action.params.value) ? cqwwFrequency(Number(action.params.value)) : null;
        if (frequencyHz === null) throw new Error("Enter a valid HF contest frequency in Hz.");
        setEditFrequencyMHz((frequencyHz / 1_000_000).toFixed(6)); return;
      }
      case "log_edit_set_band":
        requireEditing(action.params.qsoID);
        if (action.params.value !== (bandLabels[String(editing?.Band)] ?? String(editing?.Band ?? "")))
          throw new Error("Band follows the corrected contact frequency.");
        return;
      case "log_edit_confirm_delete": requireEditing(action.params.qsoID); setConfirmDelete(action.params.confirmed); return;
      case "log_edit_save":
        requireEditing(action.params.qsoID);
        if (action.params.expectedSessionRevision !== active.revision) throw new Error("The contest log changed before this correction was saved.");
        if (!correctionReason.trim()) throw new Error("Enter a correction reason.");
        await saveCorrection(correctionReason.trim(), true); return;
      case "log_edit_delete":
        requireEditing(action.params.qsoID);
        if (action.params.expectedSessionRevision !== active.revision) throw new Error("The contest log changed before this deletion was saved.");
        if (!confirmDelete) throw new Error("Confirm deletion before removing this contact.");
        if (!deletionReason.trim()) throw new Error("Enter a deletion reason.");
        await deleteQSO(deletionReason.trim(), true); return;
    }
  };
  const reportSurfaceError = useCallback((message: string) => setError(message), []);
  const waitForSurfacePublication = useContestSurfaceOwner({ context: surfaceContext, projections: surfaceProjections,
    handle: handleSurfaceAction, report: reportSurfaceError });
  useEffect(() => {
    if (!setupOnly || !surfaceContext) return;
    void configureContestGroupChat(surfaceContext, {
      enabled: setup.network.multiEnabled === true,
      multicastGroup: String(setup.network.multicastGroup ?? "239.1.1.1"),
      multicastPort: Number(setup.network.multicastPort ?? 2239),
      interface: String(setup.network.interface ?? "0.0.0.0"),
      operator: setup.operator.trim().toUpperCase(),
    }).catch(cause => setError(errorMessage(cause)));
  }, [setupOnly, surfaceContext?.operatingContext, surfaceContext?.sessionID, surfaceContext?.workspaceGeneration,
    setup.network.multiEnabled, setup.network.multicastGroup, setup.network.multicastPort, setup.network.interface, setup.operator]);

  useEffect(() => {
    if (!registerMenuRoute) return;
    const handle = async (route: string) => {
      if (["contest-dialog-operator", "contest-dialog-station", "contest-dialog-configuration", "contest-dialog-digital", "contest-dialog-macros", "contest-dialog-keys", "contest-dialog-rover", "contest-dialog-about"].includes(route)) {
        if (["contest-dialog-macros", "contest-dialog-keys"].includes(route) && startupPending) return false;
        if (["contest-dialog-macros", "contest-dialog-keys"].includes(route) && !projectionRef.current) { setManager(true); setError(`Open a contest session before editing ${route === "contest-dialog-keys" ? "keys" : "macros"}.`); return true; }
        await openContestSetupDialog(route === "contest-dialog-operator" ? "operator" : route === "contest-dialog-station" ? "station" :
          route === "contest-dialog-configuration" ? "configuration" : route === "contest-dialog-digital" ? "digital" : route === "contest-dialog-macros" ? "macros" : route === "contest-dialog-keys" ? "keys" : route === "contest-dialog-rover" ? "rover" : "about");
        return true;
      }
      if (route === "contest-setup") {
        await flushDraftRef.current();
        setManager(true);
        return true;
      }
      if (route === "contest-window-call-history") {
        if (startupPending) return false;
        if (!projectionRef.current || !detachedAvailable || !surfaceContext) {
          setManager(true); setError("Open a contest session before opening Call History."); return true;
        }
        await flushDraftRef.current();
        await openContestCallHistoryWindow(surfaceContext);
        return true;
      }
      if (route === "contest-window-group-chat") {
        if (startupPending) return false;
        if (!projectionRef.current || !detachedAvailable || !surfaceContext) {
          setManager(true); setError("Open a contest session before opening Group Chat."); return true;
        }
        await openContestGroupChatWindow(surfaceContext);
        return true;
      }
      if (route === "contest-window-qrz-details" && setup.preferences.showQRZDetails !== true) {
        setManager(true);
        setError("Enable Show QRZ details in Contest Configuration → Lookup before opening this window.");
        return true;
      }
      const panelID = route.startsWith("contest-window-") ? route.slice("contest-window-".length) as ContestSurfacePanelID : null;
      if (!panelID || !contestSurfacePanelIDs.includes(panelID)) return false;
      if (startupPending) return false;
      const active = projectionRef.current;
      if (!active || !detachedAvailable || !surfaceContext) {
        setManager(true);
        setError("Open a contest session before opening its windows.");
        return true;
      }
      await flushDraftRef.current();
      await waitForSurfacePublication();
      await openContestSurfaceWindow(surfaceContext, panelID);
      return true;
    };
    registerMenuRoute(handle);
    return () => registerMenuRoute(null);
  }, [registerMenuRoute, detachedAvailable, surfaceContext?.operatingContext, surfaceContext?.sessionID,
    surfaceContext?.workspaceGeneration, startupPending, setup.preferences.showQRZDetails]);

  const applyAssistanceCallsign = (callsign: string, selection: SCPSelectionScope) => {
    const active = projectionRef.current;
    if (!active || busyRef.current || retiring || selection.ownerLeaseID !== 0 ||
        selection.sessionID !== active.sessionID || selection.workspaceGeneration !== active.workspaceGeneration ||
        selection.draftID !== active.draftID || selection.inputCallsign !== (fieldsRef.current.callsign ?? "").trim().toUpperCase()) {
      setError("The callsign suggestion no longer belongs to the active Not1MM draft.");
      return;
    }
    const nextFields = { ...fieldsRef.current, callsign };
    editVersionRef.current += 1; fieldsRef.current = nextFields; setFields(nextFields);
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: nextFields, frequencyHz: operationFrequencyHz ?? base.frequencyHz,
    }), false, false);
  };

  const cwPanel = () => projection && <section className="contest-operator" aria-label="CW controls"><header><div><strong>ESM and CW</strong><p>{cw.state.canonical?.provider === "test-simulation"
    ? "CONTESTING TEST · simulated CW only · no RF, audio, PTT, radio, or network output"
    : "Not1MM chooses the F-key action; xLog owns the armed output lease."}</p></div><span>{cw.state.message}</span></header><div className="contest-operator-controls"><button type="button" disabled={busy || cw.state.pending} onClick={() => void cw.controller.arm()}>{cw.state.canonical?.provider === "test-simulation" ? "Arm simulation" : "Arm CW"}</button><button type="button" className="contest-danger-secondary" onClick={() => void stopAutoCQ()}>Stop</button><span className={cw.state.armed ? "is-armed" : ""}>{cw.state.armed ? "Armed" : "Disarmed"}</span>{autoCQDeadlineMs !== null&&<span role="status">Auto CQ · {Math.max(0, Math.ceil((autoCQDeadlineMs-autoCQNowMs)/1000))}s</span>}</div>{cw.state.error && <p className="contest-alert is-error">{cw.state.error}</p>}<div className="contest-operator-keys">{projection.functionKeys.map(key => <button type="button" key={key.id} disabled={busy || retiring} className={key.highlighted ? "contest-primary" : undefined} onClick={() => void hostAction("contest_function_key", { key: key.id })}>{key.id}</button>)}</div></section>;
  const entryPanel: ReactNode = projection && <form className="contest-entry" aria-label={`${projection.pluginName ?? projection.pluginID} entry`} onSubmit={event => { event.preventDefault(); void runMutation(base => mutate("contest_qso_commit", base, { fields: fieldsRef.current, frequencyHz: base.frequencyHz })); }} onKeyDown={keyDown}>
    <header><div><h2><Radio size={15}/> {projection.pluginName ?? projection.pluginID} · Not1MM</h2><p>Actual pinned Python plugin · {projection.run ? "Run" : "Search & Pounce"}</p></div><span>{busy ? "Working…" : "Ready"}</span></header>
    <ContestEntryFields callsign={visibleFields.slice(0, 1).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} className="contest-call" autoComplete="off" data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } reports={visibleFields.slice(1, 3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value)}/>) } exchange={visibleFields.slice(3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } />
    <div className="contest-entry-context"><div><span>Frequency</span>{observedFrequencyHz !== null
      ? <strong>{(observedFrequencyHz / 1e6).toFixed(6)} MHz · radio observed</strong>
      : <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
          value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)} onBlur={syncManualFrequency}/>}</div><div><span>Band / mode</span><strong>{bandLabels[String(projection.band)] ?? projection.band} · {projection.mode}</strong></div><div><span>Operating style</span><button type="button" disabled={busy || retiring} onClick={() => void runMutation(base => mutate("contest_run_state", base, { run: !base.run }), false)}>{projection.run ? "Run" : "S&P"}</button></div></div>
    <div className={`contest-validation ${projection.dupe ? "is-duplicate" : "is-clear"}`}><strong>{projection.dupe ? "Duplicate" : "Dupe check"}</strong><span>{projection.countryResolved ? "Country resolved by xLog CTY data." : "Unknown country is retained; scoring credit may be zero."}</span></div>
    {cwPanel()}
    <footer><button type="button" disabled={busy || retiring} onClick={() => void hostAction("contest_esm", { field: focusRef.current })}>Enter / ESM</button><button className="contest-primary" type="submit" disabled={busy || retiring}>Log Now</button></footer>
  </form>;
  const scorePanel = <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score</h2><ContestScoreSummary score={scoreView}/></aside>;
  const checkPanel = <section className="contest-score" aria-label="Check Partial"><h2>Check Partial</h2>{projection && <ContestAssistancePanel
    request={request as ContestRequest} ownerLeaseID={0} sessionID={projection.sessionID} workspaceGeneration={projection.workspaceGeneration}
    draftID={projection.draftID} callsign={fields.callsign ?? ""} disabled={busy || retiring}
    onSelect={applyAssistanceCallsign} onSurfaceChange={setSCPSurface}/>}<p className="contest-source">{projection?.history || "Type a call to query Not1MM call history."}</p><p>{projection?.dupe
      ? projection.dupeExplanation ?? "Worked in this contest" : projection?.countryResolved ? "Country resolved · not a duplicate" : "No country match yet"}</p></section>;
  const matrixPanel = <section className="contest-score" aria-label="Country and zone matrices"><h2>Countries / zones</h2><div className="contest-multipliers">{[...(matrices.countries ?? []), ...(matrices.zones ?? [])].map((item: Data, index: number) => <span key={`${item.value}-${item.band}-${index}`}>{item.value || "Unknown"} · {bandLabels[String(item.band)] ?? item.band} · {item.qsos}</span>)}</div></section>;
  const logPanel = <section className="contest-log"><header><div><h2><BookOpen size={15}/> Contest log</h2><p>{logTotal} contacts in the Python-owned DXLOG store.</p></div><button type="button" disabled={busy} onClick={() => void exportCabrillo()}><Download size={14}/>Export Cabrillo</button></header>{editing && <form className="contest-qso-editor" onSubmit={correct}><h2>Edit {editing.Call}</h2><div className="contest-qso-fields"><ContestTextField label="Callsign" value={editCall} onChange={event => setEditCall(event.target.value.toUpperCase())}/><ContestTextField label="UTC timestamp" value={editTimestamp} onChange={event => setEditTimestamp(event.target.value)}/><ContestTextField label="Frequency MHz" inputMode="decimal" value={editFrequencyMHz} onChange={event => setEditFrequencyMHz(event.target.value)}/><ContestTextField label="Operator" value={editOperator} onChange={event => setEditOperator(event.target.value.toUpperCase())}/><ContestTextField label="Sent report" value={editSent} onChange={event => setEditSent(event.target.value)}/><ContestTextField label="Received report" value={editReceived} onChange={event => setEditReceived(event.target.value)}/><ContestTextField label={projection?.fields.find(field => field.id === "other_1")?.label || "Sent exchange"} inputMode="numeric" value={editSentExchange} onChange={event => setEditSentExchange(event.target.value)}/><ContestTextField label={projection?.fields.find(field => field.id === "other_2")?.label || "Received exchange"} value={editZone} onChange={event => setEditZone(event.target.value)}/></div><footer><button className="contest-danger" type="button" onClick={remove}>Delete</button><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="contest-primary" type="submit">Save correction</button></footer></form>}<ContestLogTable rows={logRows(rows, projection?.pluginID)} disabled={busy || retiring} onEdit={beginEdit}/><footer><button type="button" disabled={busy || logOffset === 0} onClick={() => void loadLogPage(Math.max(0, logOffset - logPageSize))}>Newer</button><span>{logTotal ? `${logOffset + 1}–${logOffset + rows.length} of ${logTotal}` : "No contacts"}</span><button type="button" disabled={busy || logOffset + rows.length >= logTotal} onClick={() => void loadLogPage(logOffset + logPageSize)}>Older</button></footer></section>;
  const bandMapPanel = <BandMaps spots={spots} radioFrequencyHz={radioFrequencyHz} compact onSelect={spot => void chooseSpot(spot)} selectionHint="Select a spot to load the active Not1MM draft and tune the selected xLog radio once."/>;
  const clusterPanel = <ClusterPanel passive snapshot={cluster} selectedSpotId={selectedSpotId ?? undefined} onRequest={serviceRequest} onSelect={spot => void chooseSpot(spot as BandMapSpot)}/>;
  const showSetup = setupOnly || manager;
  return <main className={`contest-workspace${setupOnly ? " is-setup-only" : ""}`}>
    {setupOnly && <h1 className="contest-visually-hidden">Contest Setup</h1>}
    {!setupOnly && <header className="contest-header"><div><h1>Contest Manager / Desk</h1><p>{projection
      ? `${sessions.find(session => session.sessionID === projection.sessionID)?.name ?? projection.pluginID} · actual Not1MM Python plugin · xLog station services`
      : "Actual Not1MM Python plugins · xLog station services"}</p></div><div className="contest-header-actions">{projection && <button type="button" disabled={busy} onClick={() => {
      if (manager) { setManager(false); return; }
      busyRef.current = true; setBusy(true); setError("");
      void flushDraftRef.current().then(() => setManager(true)).catch(cause => setError(errorMessage(cause)))
        .finally(() => { busyRef.current = false; setBusy(false); });
    }}>{manager ? "Back to desk" : "Select contest"}</button>}</div></header>}
    {error && <p className="contest-alert is-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></p>}
    {notice && <p className="contest-alert" role="status">{notice}</p>}
    {showSetup && observedFrequencyHz === null && <div className="contest-entry-context">
      <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
        value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)}/>
    </div>}
    {showSetup ? <ContestSetupPanel value={setup} effectiveMacros={effectiveMacros} sessions={sessions} activeSessionID={projection?.sessionID}
      catalog={catalog.map(item => ({ id: String(item.id), name: String(item.name),
        modes: item.modes, sentExchangeHint: item.sentExchangeHint, overlayChoices: item.overlayChoices }))} busy={busy || retiring}
      onSave={saveSetup} onCreate={createSession} onOpen={session => openSession(session as Session)} onOpenSettings={openContestSetupService}
      onOpenDialog={setupOnly ? openContestSetupDialog : undefined} onViewChange={onSetupViewChange}
      onOpenCallHistory={() => { if (!surfaceContext) { setError("Open a contest before opening Call History."); return; }
        if (!setupOnly) setManager(false); void openContestCallHistoryWindow(surfaceContext); }}/>
      : projection ? <><section className="contest-snapshot" aria-label="Contest identity"><div><span>Station</span><strong>{stationCall}</strong></div><div><span>Engine</span><strong>Not1MM Python</strong></div><div><span>Plugin</span><strong>{projection.pluginID}</strong></div><div><span>Revision</span><strong>{projection.revision}</strong></div><div><span>Source</span><small>{projection.sourceRevision.slice(0, 12)} · {projection.referenceID}</small></div></section>{detachedAvailable
        ? <section className="contest-welcome"><h2>Contest windows are ready</h2><p>Use the Contest menu to open and position Main Logging, Check Partial, Stats, Rates, Logbook, Band Map, Cluster, Rotator, DXCC, Zone and Remote VFO windows.</p></section>
        : <section className="contest-welcome"><h2>Preserved contest session</h2><p>This session predates detached contest windows for the current xLog workspace. Its Python/SQLite log is preserved; create a current-workspace contest before opening independent windows.</p></section>}</> : <section className="contest-welcome"><h2>Open a contest session</h2></section>}
    <div hidden aria-hidden="true">{checkPanel}</div>
  </main>;
}

export default Not1MMContestWorkspace;
