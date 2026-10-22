import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Download, Radio, Trophy } from "lucide-react";
import BandMaps, { type BandMapSpot } from "../live/BandMaps";
import ClusterPanel from "../live/ClusterPanel";
import { useSharedCW } from "../live/useSharedCW";
import { ContestAssistancePanel, type ContestSCPPanelSurface, type SCPSelectionScope } from "./ContestAssistancePanel";
import { ContestSetupPanel, newContestSetup, restoredESMPreferences, type ContestSetupCatalogEntry, type ContestSetupDocument, type ContestSetupMacro, type SetupView } from "./ContestSetupPanel";
import { canonicalJSON, ContestMutationUncertain, ContestServerError, type ContestMutation } from "./client";
import { ContestEntryFields, ContestLogTable, ContestScoreSummary, ContestTextField, type ContestLogRow } from "./ContestPresentation";
import { nativeContestExportSave, type ContestExportSavePrepared } from "./contestExportSave";
import { not1mmHistoryCandidate } from "./contestCallHistory";
import type { ContestRequest } from "./types";
import { contestInputFieldIDs, contestSurfacePanelIDs, type ContestInputFieldID, type ContestSurfaceActionEnvelope, type ContestSurfacePanelID,
  type ContestSurfaceProjection, type ContestManualRow, type ContestManualContext, type ContestPluginLogRow,
  type ContestStatisticsRow, type ContestSurfaceSpot, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import type { ContestTransitionController } from "./ContestWorkspace";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";
import { openContestCallHistoryWindow, openContestSurfaceWindow } from "./contestSurfaceNative";
import { openContestSetupService } from "./contestSetupServices";
import { openContestSetupDialog, useContestSetupDialogs, type ContestDigitalSave, type ContestDigitalSnapshot } from "./contestSetupDialogs";
import { defaultContestKeyBindings, encodeContestKeyBindings, readContestKeyBindings, validateContestKeyBindings } from "./contestKeyBindings";
import { setContestCWSpeed } from "./contestStationControl";
import { configureContestGroupChat, openContestGroupChatWindow, publishContestGroupContact,
  readContestGroupNetwork, takeContestGroupUnverifiedAcknowledgements,
  requestContestGroupAuthority, syncContestGroupReplicaPage,
  type ContestGroupChatSnapshot } from "./contestGroupChat";
import { ContestVoiceOutput, type ContestVoiceAction } from "./contestVoiceOutput";
import "./ContestWorkspace.css";

type Data = Record<string, any>;
type RTCStatus={configured:boolean;enabled:boolean;service:string|null;username:string;interval_minutes:number;posting:boolean;
  consecutive_failures:number;last_outcome:string;last_attempt:string|null;next_attempt:string|null};
export function rtcReportState(status:RTCStatus|null):"disabled"|"scheduled"|"posting"|"sent"|"failed"|"paused" {
  if(status?.posting)return "posting";
  if(status?.consecutive_failures===3&&!status.enabled)return "paused";
  if(status?.last_attempt&&status.consecutive_failures>0)return "failed";
  if(status?.last_attempt&&status.consecutive_failures===0)return "sent";
  return status?.enabled?"scheduled":"disabled";
}
export function rtcConfigurationRequired(currentKey:string,nextKey:string,status:RTCStatus|null):boolean {
  return currentKey!==nextKey||status?.configured===false;
}
type ClientAction="commit"|"correct"|"delete";
type PendingClientMutation={schemaVersion:1;localSessionID:string;localWorkspaceGeneration:string;authoritySessionID:string;
  authorityWorkspaceGeneration:string;draftID:string;action:ClientAction;baseRevision:number;requestID:string;qsoID:string;
  params:Record<string,unknown>;createdAt:number};
const pendingClientPrefix="xlog.contest.pending-client-mutation.v1/";
const pendingClientQuarantinePrefix="xlog.contest.pending-client-mutation-quarantine.v1/";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>key in value);
function validClientParams(action:ClientAction,value:unknown,qsoID:string,baseRevision:number){
  if(!value||typeof value!=="object"||Array.isArray(value))return false;const params=value as Record<string,unknown>;
  const common=typeof params.action==="string"&&params.action===action&&params.qsoID===qsoID;
  if(!common)return false;
  if(action==="delete")return exactKeys(params,["action","qsoID","baseRevision","reason"])&&
    params.baseRevision===baseRevision&&typeof params.reason==="string"&&params.reason.length<=1024;
  const fields=params.fields;
  if(!fields||typeof fields!=="object"||Array.isArray(fields)||Object.keys(fields).length>64||
      !Object.values(fields).every(item=>typeof item==="string"&&new TextEncoder().encode(item).length<=4096))return false;
  if(action==="correct")return exactKeys(params,["action","qsoID","baseRevision","timestamp","frequencyHz","operator","fields","reason"])&&
    params.baseRevision===baseRevision&&typeof params.timestamp==="string"&&params.timestamp.length<=64&&
    Number.isSafeInteger(params.frequencyHz)&&Number(params.frequencyHz)>0&&typeof params.operator==="string"&&
    typeof params.reason==="string"&&params.reason.length<=1024;
  const keys=Object.keys(params),allowed=["action","qsoID","timestamp","frequencyHz","mode","operator","fields","serialRequestID"];
  return keys.every(key=>allowed.includes(key))&&keys.length===(params.serialRequestID===undefined?7:8)&&
    typeof params.timestamp==="string"&&params.timestamp.length<=64&&Number.isSafeInteger(params.frequencyHz)&&Number(params.frequencyHz)>0&&
    typeof params.mode==="string"&&typeof params.operator==="string"&&
    (params.serialRequestID===undefined||uuidPattern.test(String(params.serialRequestID)));
}
function validPendingClientMutation(value:unknown):value is PendingClientMutation{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;const item=value as Record<string,unknown>;
  if(!exactKeys(item,["schemaVersion","localSessionID","localWorkspaceGeneration","authoritySessionID","authorityWorkspaceGeneration",
      "draftID","action","baseRevision","requestID","qsoID","params","createdAt"])||item.schemaVersion!==1||
      ![item.localSessionID,item.localWorkspaceGeneration,item.authoritySessionID,item.authorityWorkspaceGeneration,item.draftID,item.requestID,item.qsoID]
        .every(value=>uuidPattern.test(String(value)))||!["commit","correct","delete"].includes(String(item.action))||
      !Number.isSafeInteger(item.baseRevision)||Number(item.baseRevision)<0||!Number.isSafeInteger(item.createdAt)||Number(item.createdAt)<=0)return false;
  return validClientParams(item.action as ClientAction,item.params,item.qsoID as string,item.baseRevision as number);
}
function pendingScope(localSessionID:string,localWorkspaceGeneration:string,draftID:string,action:ClientAction,baseRevision:number){
  return `${pendingClientPrefix}${localSessionID}/${localWorkspaceGeneration}/${draftID}/${action}/${baseRevision}/`;
}
function pendingStorageKey(item:PendingClientMutation){return `${pendingScope(item.localSessionID,item.localWorkspaceGeneration,item.draftID,item.action,item.baseRevision)}${item.qsoID}/${item.authoritySessionID}/${item.authorityWorkspaceGeneration}`;}
function quarantinePendingClientMutation(key:string,raw:string|null,reason:"invalid"|"stale"):never{
  const warning=`This pending contest operation is ${reason} and may already be logged by the master. Quarantine the preserved record now? You must review the master log before retrying.`;
  if(!window.confirm(warning))throw new Error(`The ${reason} pending contest operation remains blocked; no new operation was sent.`);
  const quarantineKey=`${pendingClientQuarantinePrefix}${Date.now()}/${crypto.randomUUID()}`;
  localStorage.setItem(quarantineKey,raw??"");localStorage.removeItem(key);
  throw new Error("The pending contest operation was quarantined with its raw evidence. Review the master log before retrying; this attempt was stopped.");
}
export function storedPendingClientMutation(scope:string,authoritySessionID:string,authorityWorkspaceGeneration:string){
  for(let index=0;index<localStorage.length;index+=1){const key=localStorage.key(index);if(!key?.startsWith(scope))continue;
    const raw=localStorage.getItem(key);let value:unknown;try{value=JSON.parse(raw??"");}catch{return quarantinePendingClientMutation(key,raw,"invalid");}
    if(!validPendingClientMutation(value)||pendingStorageKey(value)!==key)return quarantinePendingClientMutation(key,raw,"invalid");
    if(value.authoritySessionID===authoritySessionID&&value.authorityWorkspaceGeneration===authorityWorkspaceGeneration)return value;
    return quarantinePendingClientMutation(key,raw,"stale");
  }
  return null;
}
function persistPendingClientMutation(item:PendingClientMutation){
  const key=pendingStorageKey(item),encoded=JSON.stringify(item);localStorage.setItem(key,encoded);
  let restored:unknown;try{restored=JSON.parse(localStorage.getItem(key)??"");}catch{restored=null;}
  if(!validPendingClientMutation(restored)||canonicalJSON(restored)!==canonicalJSON(item))throw new Error("The pending contest operation could not be durably saved; no network operation was sent.");
  return item;
}
export function authoritativeChangeRevision(row:Record<string,unknown>):number{
  const revision=Number(row.change_revision);
  if(!Number.isSafeInteger(revision)||revision<=0)throw new Error("Synchronise this contact's authoritative revision before changing it.");
  return revision;
}
type ContestFunctionKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Field = { id: string; label: string; accessibleName: string; value: string; visible: boolean; readOnly: boolean; enabled: boolean };
type Score = { qsos: number; points: number; countries: number; zones: number; multipliers?: number; uniqueCalls?: number; prefixes?: number; sections?: number; headquarters?: number; total: number };
type ContestBandDefinition = { id: string; lowHz: number; highHz: number; value: number };
type ContestSurfaceMode = "CW" | "SSB" | "RTTY" | "AM" | "FM";
type PythonContestExportFormat = "cabrillo" | "adif" | "edi";
type StatisticsState = { sessionID: string; revision: number; rows: ContestStatisticsRow[]; total: ContestStatisticsRow };
type Projection = {
  sessionID: string; engine: "not1mm-python"; pluginID: string; pluginName?: string; reservedSerial?: number | null; allocatedSerialFieldID?: string | null; sourceRevision: string; referenceID: string;
  workspaceGeneration: string; revision: number; draftID: string; fields: Field[]; frequencyHz: number; mode: string; band: number;
  focus: string; tabNext: Record<string, string>; tabPrevious: Record<string, string>; advanceOnSpace?: string[]; run: boolean;
  functionKeys: Array<{ id: string; highlighted: boolean; label?: string; template?: string }>; dupe: boolean; dupeExplanation?: string; countryResolved: boolean;
  matrixTrackers?: Array<"countries" | "zones">;
  exportFormats?: PythonContestExportFormat[];
  ruleIdentity?: { id: string; version: string; edition: string; sourceRevision: string };
  supportedBands?: string[]; supportedModes?: string[]; allowDuplicateCommit?: boolean;
  fldigiReceiveSupported?: boolean; fldigiTransmitSupported?: boolean; fldigiTransmitAvailable?: boolean;
  columns?: string[];
  history: string; score: Score; operator?: string; roverLocation?: string; cwSpeedWpm?: number | null; callContext?: Partial<ContestManualContext> & {callsign?:string};
  replicaCursor?: { revision:number; sequence:number } | null;
  replicaAuthority?: { sessionID:string; workspaceGeneration:string } | null;
  authoritySerialRequestID?: string | null;
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
  stationStep?: (direction: "up" | "down") => Promise<unknown>;
  contestSpot: (callsign: string, frequencyHz: number) => Promise<unknown>;
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
  strictHostActive?: { sessionID: string; workspaceGeneration: string } | null;
  setupOnly?: boolean;
};

const activeSessionKey = "xlog.contesting.not1mm.active-session.v1";
const setupDraftKey = "xlog.contesting.not1mm.setup-draft.v1";
const spotWorkflowKey = "xlog.contesting.not1mm.spot-workflow.v2";
export const contestSpotWorkflowMaxEntries = 2_000;
export const contestSpotWorkflowMaxBytes = 1_048_576;
export const contestSpotWorkflowTTLms = 7 * 24 * 60 * 60 * 1_000;
const logPageSize = 20;
const contestBands = ["160m", "80m", "40m", "20m", "15m", "10m"];
// Compatibility for protocol-v1/older test catalogs. The current host supplies
// these definitions from the pinned Not1MM plan and remains the authority.
const fallbackBandDefinitions: ContestBandDefinition[] = [
  ["160m",1_800_000,2_000_000,1.8],["80m",3_500_000,4_000_000,3.5],["40m",7_000_000,7_300_000,7],
  ["20m",14_000_000,14_350_000,14],["15m",21_000_000,21_450_000,21],["10m",28_000_000,29_700_000,28],
  ["6m",50_000_000,54_000_000,50],["2m",144_000_000,148_000_000,144],["1.25m",222_000_000,225_000_000,222],
  ["70cm",420_000_000,450_000_000,432],["33cm",902_000_000,928_000_000,902],["23cm",1_240_000_000,1_300_000_000,1296],
  ["13cm",2_300_000_000,2_450_000_000,2300],["9cm",3_300_000_000,3_500_000_000,3300],
  ["6cm",5_650_000_000,5_925_000_000,5650],["3cm",10_000_000_000,10_500_000_000,10000],
  ["1.25cm",24_000_000_000,24_250_000_000,24000],["6mm",47_000_000_000,47_200_000_000,47000],
  ["4mm",75_500_000_000,81_000_000_000,75500],["2.5mm",119_980_000_000,123_000_000_000,119980],
  ["2mm",134_000_000_000,149_000_000_000,134000],["1mm",241_000_000_000,250_000_000_000,241000],
  ["submm",300_000_000_000,7_500_000_000_000,300000],
].map(([id, lowHz, highHz, value]) => ({ id: String(id), lowHz: Number(lowHz), highHz: Number(highHz), value: Number(value) }));
const validBandDefinitions = (value: unknown): ContestBandDefinition[] => Array.isArray(value) ? value.filter((item): item is ContestBandDefinition => {
  const band = item as Partial<ContestBandDefinition>;
  return typeof band?.id === "string" && band.id.length > 0 && Number.isSafeInteger(band.lowHz) && Number.isSafeInteger(band.highHz) &&
    Number(band.lowHz) >= 0 && Number(band.highHz) > Number(band.lowHz) && typeof band.value === "number" && Number.isFinite(band.value);
}) : [];
const defaultBandLabels: Record<string, string> = Object.fromEntries(fallbackBandDefinitions.map(band => [String(band.value), band.id]));
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
const rttyContestModeAliases = new Set(["RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
  "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"]);
const canonicalContestSurfaceMode = (value: unknown): ContestSurfaceMode | null => {
  const mode = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (mode === "CW" || mode === "SSB" || mode === "AM" || mode === "FM") return mode;
  if (mode === "LSB" || mode === "USB" || mode === "PH" || mode === "PHONE") return "SSB";
  return rttyContestModeAliases.has(mode) ? "RTTY" : null;
};
const contestSurfaceModes = (values: readonly unknown[], fallback: unknown): ContestSurfaceMode[] => {
  const modes = values.map(canonicalContestSurfaceMode).filter((mode): mode is ContestSurfaceMode => mode !== null);
  const fallbackMode = canonicalContestSurfaceMode(fallback);
  return [...new Set(modes.length ? modes : fallbackMode ? [fallbackMode] : ["CW"] as ContestSurfaceMode[])];
};
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest operation failed.";
const contestFrequency = (value: unknown, supportedBands: readonly string[], bandDefinitions: readonly ContestBandDefinition[]): number | null => {
  const frequency = typeof value === "number" ? Math.round(value) : NaN;
  if (!Number.isSafeInteger(frequency)) return null;
  const band = bandDefinitions.find(definition => frequency >= definition.lowHz && frequency < definition.highHz)?.id;
  return band && supportedBands.includes(band) ? frequency : null;
};
const manualFrequency = (value: string, supportedBands: readonly string[], bandDefinitions: readonly ContestBandDefinition[]): number | null => {
  const mhz = Number(value.trim());
  return Number.isFinite(mhz) ? contestFrequency(mhz * 1_000_000, supportedBands, bandDefinitions) : null;
};

function restoredSetup(stationCall: string): ContestSetupDocument {
  const defaults = newContestSetup(stationCall);
  try {
    const raw = localStorage.getItem(setupDraftKey);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ContestSetupDocument>;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    const preferences={ ...defaults.preferences, ...restoredESMPreferences(saved.preferences ?? {}) };
    delete preferences.rtcPassword;
    return { ...defaults, ...saved,
      station: { ...defaults.station, ...(saved.station ?? {}) },
      settings: { ...defaults.settings, ...(saved.settings ?? {}) },
      preferences,
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

const groupContestIdentity = (value: ContestSetupDocument) => [value.pluginID.trim().toLowerCase(),
  String(value.settings.StartDate ?? "").trim(), String(value.station.Call ?? "").trim().toUpperCase()].join("|");

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
function logRows(rows: Data[], pluginID?: string, labels: Record<string, string> = defaultBandLabels): ContestLogRow[] {
  return rows.map(row => ({
    qsoID: String(row.ID ?? ""), workedAt: canonicalWorkedAt(row.TS), callsign: String(row.Call ?? ""),
    band: labels[String(row.Band)] ?? String(row.Band ?? ""), mode: String(row.Mode ?? "CW"),
    sentExchange: String(row.SentNr ?? ""), receivedExchange: receivedExchange(row, pluginID),
    points: Number(row.Points ?? 0), multiplierLabels: pluginID === "icwc_mst" || pluginID === "cwo" ? []
      : pluginID && serialPrefixPlugins.has(pluginID) ? [String(row.WPXPrefix ?? "")].filter(Boolean)
      : pluginID && sweepstakesPlugins.has(pluginID) ? [row.Sect ? `Section ${row.Sect}` : ""].filter(Boolean)
      : [String(row.CountryPrefix ?? ""), row.ZN ? `Zone ${row.ZN}` : ""].filter(Boolean),
  }));
}
function manualRows(rows: Data[]): ContestManualRow[] {
  return rows.map(row => ({ qsoID: String(row.ID ?? ""), TS: String(row.TS ?? ""), Call: String(row.Call ?? ""),
    Freq: String(row.Freq ?? ""), SNT: String(row.SNT ?? ""), RCV: String(row.RCV ?? ""),
    M1: row.IsMultiplier1 && row.IsMultiplier1 !== "0" ? "✓" : "", ZN: String(row.ZN ?? ""),
    M2: row.IsMultiplier2 && row.IsMultiplier2 !== "0" ? "✓" : "",
    prefix: String(row.WPXPrefix || row.CountryPrefix || ""), Points: String(row.Points ?? "") }));
}
const textValue = (value: unknown) => String(value ?? "");
const multiplierValue = (value: unknown) => value === undefined || value === null || value === "" ? "" : value && value !== "0" ? "Yes" : "No";
function logEditDetails(row: Data) {
  return {
    rxFrequency: textValue(row.QSXFreq), contest: textValue(row.ContestName), country: textValue(row.CountryPrefix),
    stationCall: textValue(row.StationPrefix), name: textValue(row.Name), qth: textValue(row.QTH), comment: textValue(row.Comment),
    receivedNumber: textValue(row.NR), sentNumber: textValue(row.SentNr), points: textValue(row.Points), power: textValue(row.Power),
    zone: textValue(row.ZN), section: textValue(row.Sect), check: textValue(row.CK), precedence: textValue(row.Prec),
    multiplier1: multiplierValue(row.IsMultiplier1), multiplier2: multiplierValue(row.IsMultiplier2),
    multiplier3: multiplierValue(row.isMultiplier3), wpx: textValue(row.WPXPrefix), exchange: textValue(row.Exchange1),
    run: textValue(row.Run1Run2), radio: textValue(row.RadioNR), grid: textValue(row.GridSquare), misc: textValue(row.MiscText),
    roverQTH: textValue(row.RoverLocation),
  };
}
const contactMetadataColumns = { name: "Name", qth: "QTH", comment: "Comment" } as const;
function pluginContactMetadataColumns(fields: { label?: string; visible?: boolean }[]): Set<string> {
  const labels = new Set(fields.filter(field => field.visible !== false).map(field => String(field.label ?? "").trim().toLowerCase()));
  return new Set(Object.entries(contactMetadataColumns).filter(([label]) => labels.has(label)).map(([, column]) => column));
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
      bandHex:bounded(spot.bandHex),modeHex:bounded(spot.modeHex),marked:false}];
  });
}

type SpotWorkflowScope = { operatingContext: string; sessionID: string; workspaceGeneration: string };
type SpotWorkflowEntry = { spot: ContestSurfaceSpot; deleted: boolean; updatedAt: number };
type SpotWorkflow = SpotWorkflowScope & { markedOnly: boolean; entries: Record<string, SpotWorkflowEntry> };
const emptySpotWorkflow = (scope:SpotWorkflowScope={operatingContext:"",sessionID:"",workspaceGeneration:""}):SpotWorkflow =>
  ({...scope,markedOnly:false,entries:{}});
const sameSpotWorkflowScope=(workflow:SpotWorkflow,scope:SpotWorkflowScope)=>workflow.operatingContext===scope.operatingContext&&
  workflow.sessionID===scope.sessionID&&workflow.workspaceGeneration===scope.workspaceGeneration;
export const contestSpotWorkflowStorageKey=(scope:SpotWorkflowScope)=>`${spotWorkflowKey}:${encodeURIComponent(scope.operatingContext)}:${encodeURIComponent(scope.workspaceGeneration)}:${encodeURIComponent(scope.sessionID)}`;
export function compactContestSpotWorkflow(workflow:SpotWorkflow,authoritativeSpotIDs?:ReadonlySet<string>,nowMs=Date.now()):SpotWorkflow{
  const originalRows=Object.entries(workflow.entries);
  let rows=originalRows.filter(([,entry])=>Number.isFinite(entry.updatedAt)&&entry.updatedAt>=0&&
    nowMs-entry.updatedAt<=contestSpotWorkflowTTLms&&(!authoritativeSpotIDs||entry.spot.marked||authoritativeSpotIDs.has(entry.spot.id)))
    .sort(([leftID,left],[rightID,right])=>right.updatedAt-left.updatedAt||leftID.localeCompare(rightID)).slice(0,contestSpotWorkflowMaxEntries);
  const unchanged=rows.length===originalRows.length&&rows.every(([id,entry],index)=>originalRows[index]?.[0]===id&&originalRows[index]?.[1]===entry);
  let compacted=unchanged?workflow:{...workflow,entries:Object.fromEntries(rows)};
  while(rows.length&&new TextEncoder().encode(JSON.stringify(compacted)).length>contestSpotWorkflowMaxBytes){
    rows=rows.slice(0,Math.floor(rows.length/2));compacted={...workflow,entries:Object.fromEntries(rows)};
  }
  return compacted;
}
export const encodeContestSpotWorkflow=(workflow:SpotWorkflow,nowMs=Date.now())=>JSON.stringify(compactContestSpotWorkflow(workflow,undefined,nowMs));
export function decodeContestSpotWorkflow(raw:string|null,scope:SpotWorkflowScope,nowMs=Date.now()):SpotWorkflow{
  try{
    if(raw!==null&&new TextEncoder().encode(raw).length>contestSpotWorkflowMaxBytes)return emptySpotWorkflow(scope);
    const value=JSON.parse(raw??"null") as SpotWorkflow|null,entries=value?.entries;
    if(!value||!sameSpotWorkflowScope(value,scope)||typeof value.markedOnly!=="boolean"||!entries||typeof entries!=="object"||Array.isArray(entries))
      return emptySpotWorkflow(scope);
    const spots:ContestSurfaceSpot[]=[];
    for(const [id,entry] of Object.entries(entries)){
      if(!entry||typeof entry!=="object"||typeof entry.deleted!=="boolean"||typeof entry.updatedAt!=="number"||entry.spot?.id!==id)return emptySpotWorkflow(scope);
      spots.push(entry.spot);
    }
    const projection={schemaVersion:2,status:"ready",draftID:"persistence-check",draftRevision:0,radioFrequencyHz:null,
      connectedClusters:0,loadedSpots:spots.length,selectedSpotID:null,markedOnly:value.markedOnly,spots,busy:false};
    return validContestSurfaceProjection("band-maps",projection)?compactContestSpotWorkflow(value,undefined,nowMs):emptySpotWorkflow(scope);
  }catch{return emptySpotWorkflow(scope);}
}
export function persistContestSpotWorkflow(storage:Pick<Storage,"setItem">,workflow:SpotWorkflow,nowMs=Date.now()):boolean{
  let compacted=compactContestSpotWorkflow(workflow,undefined,nowMs);
  for(;;){try{storage.setItem(contestSpotWorkflowStorageKey(compacted),JSON.stringify(compacted));return true;}
    catch{const rows=Object.entries(compacted.entries);if(!rows.length)return false;
      compacted={...compacted,entries:Object.fromEntries(rows.slice(0,Math.floor(rows.length/2)))};}}
}
function restoredSpotWorkflow(scope: SpotWorkflowScope): SpotWorkflow {
  try {
    return decodeContestSpotWorkflow(localStorage.getItem(contestSpotWorkflowStorageKey(scope)),scope);
  } catch { /* A malformed or unavailable preference starts a fresh session overlay. */ }
  return emptySpotWorkflow(scope);
}
export function projectContestSpotWorkflow(spots: ContestSurfaceSpot[],workflow:SpotWorkflow,includeOnlyMarked=workflow.markedOnly):ContestSurfaceSpot[]{
  const projected=new Map(spots.map(spot=>[spot.id,spot]));
  for(const [id,entry] of Object.entries(workflow.entries)){
    if(entry.deleted){projected.delete(id);continue;}
    const current=projected.get(id);if(current)projected.set(id,{...current,receivedAt:entry.spot.receivedAt,marked:entry.spot.marked});
    else if(entry.spot.marked)projected.set(id,entry.spot);
  }
  const values=[...projected.values()];return includeOnlyMarked?values.filter(spot=>spot.marked):values;
}
export function updateContestSpotWorkflow(workflow:SpotWorkflow,spots:ContestSurfaceSpot[],spotID:string,
    operation:"confirm"|"delete"|"mark",marked=false,now=Date.now()/1000-978_307_200,updatedAt=Date.now()):SpotWorkflow{
  const target=spots.find(spot=>spot.id===spotID);if(!target)return workflow;
  const entries={...workflow.entries};
  if(operation==="delete")entries[spotID]={spot:target,deleted:true,updatedAt};
  else{
    for(const spot of spots)if(spot.id!==spotID&&Math.abs(Math.round(spot.frequencyKHz*1000)-Math.round(target.frequencyKHz*1000))<=100)
      entries[spot.id]={spot,deleted:true,updatedAt};
    entries[spotID]={spot:{...target,receivedAt:now,marked:operation==="mark"?marked:target.marked},deleted:false,updatedAt};
  }
  return compactContestSpotWorkflow({...workflow,entries},undefined,updatedAt);
}

function multiplierMatrix(title: string, tracker: "dxcc" | "zone", values: Data[], busy: boolean,
    current: { dxcc: string | null; cqZone: number | null; ituZone: number | null }, zoneSystem: "cq" | "itu" | null) {
  const rows = new Map<string, Record<string, number>>();
  for (const item of values) {
    const label = String(item.value ?? "").trim() || "Unknown";
    const band = defaultBandLabels[String(item.band)] ?? String(item.band ?? "");
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
  const destination = configuration.destination === "active_contest" ? "active_contest" : "ordinary_logbook";
  const active = source.active_contest as Record<string, unknown> | null | undefined;
  return { configuration: { enabled: configuration.enabled, address: configuration.address, port: configuration.port, destination },
    running: source.running, status: source.status, receive_only: source.receive_only,
    contest_target_supported: source.contest_target_supported === true,
    active_contest: active && typeof active.session_id === "string" && typeof active.plugin_id === "string"
      ? { session_id: active.session_id, plugin_id: active.plugin_id } : null };
}

function boundedFldigiSnapshot(value: unknown): NonNullable<ContestDigitalSnapshot["fldigi"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>, configuration = source.configuration as Record<string, unknown> | undefined;
  if (!configuration || typeof configuration.receive_enabled !== "boolean" || typeof configuration.transmit_enabled !== "boolean" ||
      typeof source.receive_running !== "boolean" || typeof source.status !== "string" ||
      typeof source.udp_endpoint !== "string" || typeof source.xmlrpc_endpoint !== "string") return undefined;
  return { configuration: { receive_enabled: configuration.receive_enabled, transmit_enabled: configuration.transmit_enabled },
    receive_supported: source.receive_supported === true, transmit_supported: source.transmit_supported === true,
    receive_running: source.receive_running, status: source.status,
    udp_endpoint: source.udp_endpoint, xmlrpc_endpoint: source.xmlrpc_endpoint };
}

export function Not1MMContestWorkspace({ request, serviceRequest, stationTune, stationStep, contestSpot, operatingContext, workspaceGeneration, stationCall, radioFrequencyHz, spots, cluster,
  selectedSpotId, onSelectedSpot, onSetupViewChange, registerTransition, registerMenuRoute, strictHostActive = null, setupOnly = false, contestingTest = false }: Props) {
  const [catalog, setCatalog] = useState<Data[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const [bandDefinitions, setBandDefinitions] = useState<ContestBandDefinition[]>(fallbackBandDefinitions);
  const bandLabels = useMemo<Record<string, string>>(() => Object.fromEntries(
    bandDefinitions.map(band => [String(band.value), band.id])), [bandDefinitions]);
  const [projection, setProjection] = useState<Projection | null>(null), projectionRef = useRef<Projection | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({}), fieldsRef = useRef<Record<string, string>>({});
  const [rows, setRows] = useState<Data[]>([]), [score, setScore] = useState<Score | null>(null), [matrices, setMatrices] = useState<Data>({});
  const [statistics, setStatistics] = useState<StatisticsState | null | undefined>(null);
  const [rates, setRates] = useState<Data | null>(null);
  const [partial, setPartial] = useState<{sessionID:string;revision:number;query:string;rows:Data[]} | null>(null);
  const [manager, setManager] = useState(true), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [startupPending, setStartupPending] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false), [catalogLoadError, setCatalogLoadError] = useState("");
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [retiring, setRetiring] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [create, setCreate] = useState({ name: "CQ WW CW", cqZone: "15" });
  const [setup, setSetup] = useState<ContestSetupDocument>(() => restoredSetup(stationCall));
  const [rtcStatus,setRTCStatus]=useState<RTCStatus|null>(null),[rtcCredentialSaved,setRTCCredentialSaved]=useState(false);
  const rtcConfigurationRef=useRef("");
  const [digitalSnapshot, setDigitalSnapshot] = useState<ContestDigitalSnapshot | undefined>();
  const [groupNetwork, setGroupNetwork] = useState<ContestGroupChatSnapshot | null>(null), groupNetworkRef=useRef<ContestGroupChatSnapshot|null>(null);
  const [authorityDupe,setAuthorityDupe]=useState<{key:string;isDupe:boolean}|null>(null);
  const authorityGenerationRef = useRef(0), authorityBusyRef=useRef(false), editingRef=useRef<Data|null>(null);
  const setupCatalog = useMemo<ContestSetupCatalogEntry[]>(() => catalog.map(item => ({ id: String(item.id), name: String(item.name),
    modes: item.modes, supportedBands: item.supportedBands,
    sentExchangeHint: item.sentExchangeHint, overlayChoices: item.overlayChoices })), [catalog]);
  const setupBandChoices = useMemo(() => bandDefinitions.map(band => band.id), [bandDefinitions]);
  const setupSupportedBands = useMemo(() => {
    const bands = catalog.find(item => item.id === setup.pluginID)?.supportedBands;
    return Array.isArray(bands) && bands.length ? bands as string[] : setupBandChoices;
  }, [catalog, setup.pluginID, setupBandChoices]);
  const activeSupportedBands = projection?.supportedBands?.length ? projection.supportedBands : setupSupportedBands;
  const configuredBands = useMemo(() => {
    const selected = Array.isArray(setup.preferences.bands) ? setup.preferences.bands : contestBands;
    const supported = projection?.supportedBands?.length ? projection.supportedBands : setupSupportedBands;
    const configured = setupBandChoices.filter(band => selected.includes(band) && supported.includes(band));
    return configured.length ? configured : setupBandChoices.filter(band => supported.includes(band));
  }, [setup.preferences.bands, projection?.supportedBands, setupBandChoices, setupSupportedBands]);
  const [effectiveMacros, setEffectiveMacros] = useState<ContestSetupMacro[] | undefined>();
  const [phoneSimulationArmed, setPhoneSimulationArmed] = useState(false);
  const [phoneSimulationPending, setPhoneSimulationPending] = useState(false);
  const [phoneReleaseUncertain, setPhoneReleaseUncertain] = useState("");
  const [phoneSimulationTrace, setPhoneSimulationTrace] = useState<PhoneSimulationTrace[]>([]);
  const phoneSimulationControllerRef = useRef<AbortController | null>(null);
  const phoneSimulationRecoveryRef = useRef<Promise<boolean> | null>(null);
  const phoneReleaseGenerationRef = useRef(0);
  const voiceOutput = useMemo(() => new ContestVoiceOutput(!contestingTest), [contestingTest]);
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
  const [editName, setEditName] = useState(""), [editQTH, setEditQTH] = useState(""), [editComment, setEditComment] = useState("");
  const [correctionReason, setCorrectionReason] = useState("Operator correction"), [deletionReason, setDeletionReason] = useState("Operator deletion");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logOffset, setLogOffset] = useState(0), [logTotal, setLogTotal] = useState(0);
  const [scpSurface, setSCPSurface] = useState<ContestSCPPanelSurface | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusRef = useRef("callsign");
  const spotCursorRef = useRef<{ context: string; spotID: string | null; externalSpotID: string | null }>(
    { context: "", spotID: null, externalSpotID: null });
  const [spotWorkflow,setSpotWorkflow]=useState<SpotWorkflow>(()=>emptySpotWorkflow());
  const editVersionRef = useRef(0);
  const observedFrequencyRef = useRef<{ sessionID: string; frequencyHz: number | null }>({ sessionID: "", frequencyHz: null });
  const flushDraftRef = useRef<() => Promise<Projection | null>>(async () => projectionRef.current);
  const cw = useSharedCW(projection?.sessionID ?? "not1mm-no-session", retiring, setupOnly);
  projectionRef.current = projection; fieldsRef.current = fields;groupNetworkRef.current=groupNetwork;editingRef.current=editing;
  const selectedRadioFrequencyHz = typeof radioFrequencyHz === "number" && Number.isSafeInteger(radioFrequencyHz) &&
    radioFrequencyHz >= 0 ? radioFrequencyHz : null;
  const observedFrequencyHz = contestFrequency(selectedRadioFrequencyHz, activeSupportedBands, bandDefinitions);
  const fallbackFrequencyHz = manualFrequency(manualFrequencyMHz, activeSupportedBands, bandDefinitions);
  const operationFrequencyHz = observedFrequencyHz ?? fallbackFrequencyHz;

  useEffect(()=>{
    if(!projection||setupOnly||contestingTest)return;
    const service=setup.preferences.rtcURL==="https://contestonlinescore.com/post/"?"contestonlinescore":"hamscore";
    const url=service==="contestonlinescore"?"https://contestonlinescore.com/post/":"https://hamscore.com/postxml/";
    const username=String(setup.preferences.rtcUsername??"").trim(),intervalMinutes=Math.max(1,Math.min(60,Number(setup.preferences.rtcIntervalMinutes)||2));
    const enabled=setup.preferences.rtcEnabled===true,key=[projection.sessionID,projection.workspaceGeneration,service,username,intervalMinutes,enabled].join("|");
    if(!rtcConfigurationRequired(rtcConfigurationRef.current,key,rtcStatus))return;
    rtcConfigurationRef.current=key;let current=true;
    void Promise.allSettled([request("secret_status"),request("contest_rtc_configure",{sessionID:projection.sessionID,
      workspaceGeneration:projection.workspaceGeneration,service,url,username,intervalMinutes,enabled})]).then(results=>{
      if(!current)return;const secret=results[0],configured=results[1];
      if(secret.status==="fulfilled")setRTCCredentialSaved((secret.value as Record<string,unknown>)["rtc-score-password"]===true);
      if(configured.status==="fulfilled")setRTCStatus(configured.value as RTCStatus);
      else setRTCStatus({configured:false,enabled:false,service,username,interval_minutes:intervalMinutes,posting:false,
        consecutive_failures:0,last_outcome:enabled?"Reporting could not start. Save credentials and enable it again.":"Score reporting is disabled.",last_attempt:null,next_attempt:null});
    });return()=>{current=false;};
  },[projection?.sessionID,projection?.workspaceGeneration,setupOnly,contestingTest,setup.preferences.rtcURL,
    setup.preferences.rtcUsername,setup.preferences.rtcIntervalMinutes,setup.preferences.rtcEnabled,rtcStatus?.configured,request]);
  useEffect(()=>{
    if(!projection||setupOnly||contestingTest)return;
    let current=true;
    const refresh=()=>void request("contest_rtc_status").then(value=>{if(current)setRTCStatus(value as RTCStatus);},()=>{});
    const timer=window.setInterval(refresh,5_000);return()=>{current=false;window.clearInterval(timer);};
  },[projection?.sessionID,setupOnly,contestingTest,request]);
  const sharedSpots=useMemo(()=>contestSurfaceSpots(spots),[spots]);
  const spotWorkflowScope=useMemo<SpotWorkflowScope>(()=>({operatingContext,workspaceGeneration,
    sessionID:projection?.sessionID??""}),[operatingContext,workspaceGeneration,projection?.sessionID]);
  const authoritativeSpotIDs=useMemo(()=>new Set(sharedSpots.map(spot=>spot.id)),[sharedSpots]);
  const effectiveSpotWorkflow=useMemo(()=>sameSpotWorkflowScope(spotWorkflow,spotWorkflowScope)
    ?compactContestSpotWorkflow(spotWorkflow,authoritativeSpotIDs):emptySpotWorkflow(spotWorkflowScope),
    [spotWorkflow,spotWorkflowScope,authoritativeSpotIDs]);
  const allWorkflowSpots=useMemo(()=>projectContestSpotWorkflow(sharedSpots,effectiveSpotWorkflow,false),[sharedSpots,effectiveSpotWorkflow]);
  const visibleWorkflowSpots=useMemo(()=>projectContestSpotWorkflow(sharedSpots,effectiveSpotWorkflow),[sharedSpots,effectiveSpotWorkflow]);
  const spotSelectionContext = `${operatingContext}/${workspaceGeneration}/${projection?.sessionID ?? "no-session"}`;
  const spotIDSignature = visibleWorkflowSpots.map(spot=>spot.id).join("\u001f");
  useEffect(() => {
    const available = new Set(visibleWorkflowSpots.map(spot => spot.id));
    const selected = selectedSpotId == null ? null : String(selectedSpotId);
    const cursor = spotCursorRef.current;
    if (cursor.context !== spotSelectionContext) {
      spotCursorRef.current = { context: spotSelectionContext, spotID: selected !== null && available.has(selected) ? selected : null,
        externalSpotID:selected };
    } else if (selected !== cursor.externalSpotID) {
      spotCursorRef.current = { context: spotSelectionContext, spotID:selected !== null&&available.has(selected)?selected:null,externalSpotID:selected };
    } else if (cursor.spotID !== null && !available.has(cursor.spotID)) {
      spotCursorRef.current = { ...cursor, spotID: null };
    }
  }, [spotSelectionContext, spotIDSignature, selectedSpotId, visibleWorkflowSpots]);
  useEffect(()=>{if(spotWorkflowScope.sessionID&&!sameSpotWorkflowScope(spotWorkflow,spotWorkflowScope))
    setSpotWorkflow(restoredSpotWorkflow(spotWorkflowScope));},[spotWorkflowScope,spotWorkflow]);
  useEffect(()=>{if(sameSpotWorkflowScope(spotWorkflow,spotWorkflowScope)&&effectiveSpotWorkflow!==spotWorkflow)
    setSpotWorkflow(current=>current===spotWorkflow?effectiveSpotWorkflow:current);},[effectiveSpotWorkflow,spotWorkflow,spotWorkflowScope]);
  useEffect(()=>{if(effectiveSpotWorkflow.sessionID&&sameSpotWorkflowScope(spotWorkflow,spotWorkflowScope))
    persistContestSpotWorkflow(localStorage,effectiveSpotWorkflow);},[effectiveSpotWorkflow,spotWorkflow,spotWorkflowScope]);
  const configuredAutoCQDelay = Number(setup.preferences.autoCQDelay ?? 15);
  const autoCQDelaySeconds = Number.isFinite(configuredAutoCQDelay) ? Math.min(3600, Math.max(1, configuredAutoCQDelay)) : 15;
  const phoneSimulationAvailable = Boolean(contestingTest && projection?.pluginID && contestPhoneIntentPlugins.has(projection.pluginID) && projection.mode === "SSB");
  const phoneProductionAvailable = Boolean(!contestingTest && projection?.pluginID && contestPhoneIntentPlugins.has(projection.pluginID) && projection.mode === "SSB");
  const phoneProductionConfigured = phoneProductionAvailable && Boolean(String(setup.preferences.voiceProfilePath ?? "").trim());
  const phoneOutputAvailable = phoneSimulationAvailable || phoneProductionConfigured;
  const phoneCanSend = phoneSimulationArmed && !phoneSimulationPending && !phoneReleaseUncertain;
  const phoneReleaseBlocking = Boolean(phoneReleaseUncertain || !phoneOutputAvailable && (phoneSimulationArmed || phoneSimulationPending));
  useEffect(() => {
    phoneSimulationControllerRef.current?.abort(); phoneSimulationControllerRef.current = null;
    phoneSimulationRecoveryRef.current = null;
    const generation = ++phoneReleaseGenerationRef.current;
    setPhoneSimulationPending(true);
    void voiceOutput.stop().then(() => {
      if (phoneReleaseGenerationRef.current !== generation) return;
      setPhoneReleaseUncertain(""); setPhoneSimulationArmed(false); setPhoneSimulationTrace([]);
    }).catch(cause => {
      if (phoneReleaseGenerationRef.current !== generation) return;
      const message = `Contest phone PTT release remains uncertain: ${errorMessage(cause)}`;
      setPhoneReleaseUncertain(message); setPhoneSimulationArmed(true); setError(message);
    }).finally(() => {
      if (phoneReleaseGenerationRef.current === generation) setPhoneSimulationPending(false);
    });
  }, [contestingTest, projection?.sessionID, projection?.pluginID, projection?.mode, voiceOutput]);
  const rememberSetup = (document: ContestSetupDocument) => {
    setSetup(document);
    try { localStorage.setItem(setupDraftKey, JSON.stringify(document)); } catch { /* storage is optional */ }
  };

  const result = async <T,>(method: string, params: Record<string, unknown> = {}) => unwrap<T>(await request(method, params));
  const partialQuery = (fields.callsign ?? "").trim().toUpperCase();
  const historyCandidate = useMemo(() => not1mmHistoryCandidate(fields.callsign ?? "", projection?.history ?? ""),
    [fields.callsign, projection?.history]);
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
  useEffect(() => {
    const sessionID = projection?.sessionID, generation = projection?.workspaceGeneration;
    if (!sessionID || !generation) return;
    let cancelled = false, inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight || busyRef.current) return;
      const observed = projectionRef.current;
      if (!observed || observed.sessionID !== sessionID || observed.workspaceGeneration !== generation) return;
      const inputVersion = editVersionRef.current;
      const inputsWereBuffered = !sameFields(fieldsRef.current, projectionFields(observed));
      inFlight = true;
      try {
        const read = await result<{ projection: Projection }>("contest_draft_get", {
          sessionID, workspaceGeneration: generation,
        });
        const next = read.projection, current = projectionRef.current;
        if (cancelled || !current || current.sessionID !== sessionID || current.workspaceGeneration !== generation ||
            next.sessionID !== sessionID || next.workspaceGeneration !== generation || next.revision <= current.revision) return;
        // WSJT-X/JTDX and multi-operator peers mutate the authoritative Python
        // session outside this renderer. Adopt that newer revision so every
        // detached projection is republished, while retaining any locally
        // buffered operator input that has not reached the host yet.
        const preserveInputs = inputsWereBuffered || editVersionRef.current !== inputVersion;
        acceptProjection(next, preserveInputs ? Number.MIN_SAFE_INTEGER : inputVersion);
        await refresh(sessionID, next, logOffset);
      } catch {
        // A transient read must not disturb the last admitted contest surface.
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => { void poll(); }, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projection?.sessionID, projection?.workspaceGeneration, logOffset, request]);
  const openSession = async (session: Pick<Session, "sessionID" | "workspaceGeneration">) => {
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
      setSessions(existing => existing.some(item => item.sessionID === admitted.sessionID) ? existing : [...existing, {
        sessionID: admitted.sessionID, workspaceGeneration: admitted.workspaceGeneration,
        name: admitted.pluginName ?? admitted.pluginID, pluginID: admitted.pluginID,
        sourceRevision: admitted.sourceRevision, revision: admitted.revision,
      }]);
      rememberSetup(setupResult.setup); await refresh(session.sessionID, admitted);
      localStorage.setItem(activeSessionKey, session.sessionID); if (!setupOnly) setManager(false); setEditing(null);
      await cw.controller.refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    setStartupPending(true); setCatalogReady(false); setCatalogLoadError("");
    void (async () => {
      try {
        if (strictHostActive) {
          const catalog = result<Data>("contest_catalog");
          await openSession(strictHostActive);
          try {
            const available = await catalog;
            if (!active) return;
            const hostBands = validBandDefinitions(available.bandDefinitions);
            setCatalog(Array.isArray(available.plugins) ? available.plugins : []);
            setBandDefinitions(hostBands.length ? hostBands : fallbackBandDefinitions);
            setCatalogReady(true);
          } catch (cause) {
            if (active) setCatalogLoadError(cause instanceof ContestServerError && cause.code === "contest_host_protocol"
              ? "Contest types could not be loaded. Station services may still be starting." : errorMessage(cause));
          }
          return;
        }
        const [available, list] = await Promise.all([
          result<Data>("contest_catalog"), result<{ sessions: Session[]; activeSessionID?: string | null }>("contest_sessions"),
        ]);
        if (!active) return;
        const hostBands = validBandDefinitions(available.bandDefinitions);
        setCatalog(Array.isArray(available.plugins) ? available.plugins : []);
        setBandDefinitions(hostBands.length ? hostBands : fallbackBandDefinitions); setSessions(list.sessions);
        setCatalogReady(true);
        const stored = localStorage.getItem(activeSessionKey);
        const hostActive = list.activeSessionID
          ? list.sessions.find(session => session.sessionID === list.activeSessionID) : undefined;
        const storedActive = stored ? list.sessions.find(session => session.sessionID === stored) : undefined;
        const saved = hostActive ?? storedActive ?? (stored && list.sessions.length === 1 ? list.sessions[0] : undefined);
        if (stored && !storedActive && !hostActive) localStorage.removeItem(activeSessionKey);
        if (saved) await openSession(saved);
      } catch (cause) {
        if (active) setCatalogLoadError(cause instanceof ContestServerError && cause.code === "contest_host_protocol"
          ? "Contest types could not be loaded. Station services may still be starting." : errorMessage(cause));
      } finally {
        if (active) setStartupPending(false);
      }
    })();
    return () => { active = false; };
  }, [catalogLoadAttempt, strictHostActive?.sessionID, strictHostActive?.workspaceGeneration]);

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
      const durableMethods = new Set<ContestMutation["method"]>(["contest_draft_apply", "contest_focus", "contest_qso_commit", "contest_qso_correct", "contest_qso_delete", "contest_recalculate"]);
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
  const configuredClient=groupNetwork?.authority?.role==="client"||setup.network.multiEnabled===true&&setup.network.multiMaster!==true;
  const authorityClientReady=groupNetwork?.authority?.role==="client"&&["leasing","connected"].includes(groupNetwork.authority.status)&&
    typeof groupNetwork.authority.sessionID==="string"&&typeof groupNetwork.authority.workspaceGeneration==="string";
  const readyAuthority=()=>{const authority=groupNetworkRef.current?.authority;
    if(authority?.role!=="client"||!["leasing","connected"].includes(authority.status)||!uuidPattern.test(String(authority.sessionID))||
        !uuidPattern.test(String(authority.workspaceGeneration)))throw new Error("The configured contest client is waiting for its master authority.");
    return {sessionID:authority.sessionID!,workspaceGeneration:authority.workspaceGeneration!};};
  const pendingMutation=(action:ClientAction,base:Projection,baseRevision:number,create:()=>{qsoID:string;params:Record<string,unknown>})=>{
    const authority=readyAuthority(),scope=pendingScope(base.sessionID,base.workspaceGeneration,base.draftID,action,baseRevision);
    const restored=storedPendingClientMutation(scope,authority.sessionID,authority.workspaceGeneration);if(restored)return restored;
    const created=create(),item:PendingClientMutation={schemaVersion:1,localSessionID:base.sessionID,
      localWorkspaceGeneration:base.workspaceGeneration,authoritySessionID:authority.sessionID,
      authorityWorkspaceGeneration:authority.workspaceGeneration,draftID:base.draftID,action,baseRevision,
      requestID:crypto.randomUUID(),qsoID:created.qsoID,params:created.params,createdAt:Date.now()};
    if(!validPendingClientMutation(item))throw new Error("The authoritative contest operation is invalid; no network operation was sent.");
    return persistPendingClientMutation(item);
  };
  const pendingForDraft=(action:ClientAction,base:Projection)=>{
    const authority=readyAuthority(),scope=`${pendingClientPrefix}${base.sessionID}/${base.workspaceGeneration}/${base.draftID}/${action}/`;
    let matched:PendingClientMutation|null=null;
    for(let index=0;index<localStorage.length;index+=1){const key=localStorage.key(index);if(!key?.startsWith(scope))continue;
      const raw=localStorage.getItem(key);let value:unknown;try{value=JSON.parse(raw??"");}catch{return quarantinePendingClientMutation(key,raw,"invalid");}
      if(!validPendingClientMutation(value)||pendingStorageKey(value)!==key)return quarantinePendingClientMutation(key,raw,"invalid");
      if(value.authoritySessionID!==authority.sessionID||value.authorityWorkspaceGeneration!==authority.workspaceGeneration)
        return quarantinePendingClientMutation(key,raw,"stale");
      if(matched)throw new Error("More than one pending authoritative operation exists for this contest draft.");matched=value;
    }
    return matched;
  };
  const syncReplica = async (authored?:{qsoID:string;draftID:string},{background=false}:{background?:boolean}={}) => {
    let active=projectionRef.current;if(!active)throw new Error("Open a contest before synchronising it.");
    const authority=readyAuthority();
    if(background&&(busyRef.current||editingRef.current||
        !sameFields(fieldsRef.current,projectionFields(active))))return active;
    const context={operatingContext,sessionID:active.sessionID,workspaceGeneration:active.workspaceGeneration};
    const generation=authorityGenerationRef.current,inputVersion=editVersionRef.current,serialContest=active.reservedSerial!==null&&active.reservedSerial!==undefined;
    let sameAuthority=active.replicaAuthority===undefined||active.replicaAuthority?.sessionID===authority.sessionID&&
      active.replicaAuthority?.workspaceGeneration===authority.workspaceGeneration;
    let needsSerial=serialContest&&(!active.authoritySerialRequestID||!sameAuthority);
    for(let page=0;page<200;page+=1){
      const cursor=sameAuthority?(active.replicaCursor??{revision:0,sequence:0}):{revision:0,sequence:0};
      const reserveThisPage=needsSerial&&!authored;
      const syncRequest={operationID:crypto.randomUUID(),changesRequestID:crypto.randomUUID(),expectedRevision:active.revision,
        fromCursor:cursor,limit:25,...(authored?{draftID:authored.draftID,authoredQSOID:authored.qsoID}:{}),
        ...(reserveThisPage
          ?{serialReservation:{requestID:crypto.randomUUID(),frequencyHz:active.frequencyHz}}:{})};
      let synced;try{synced=await syncContestGroupReplicaPage(context,syncRequest);}catch{synced=await syncContestGroupReplicaPage(context,syncRequest);}
      if(generation!==authorityGenerationRef.current)throw new Error("The group authority changed during synchronisation.");
      const result=synced.apply.result as Data,next=result.projection as Projection,cursorResult=result.replicaCursor as Data;
      if(!next||next.sessionID!==active.sessionID||next.workspaceGeneration!==active.workspaceGeneration||
          !cursorResult||cursorResult.revision!==next.replicaCursor?.revision||cursorResult.sequence!==next.replicaCursor?.sequence)
        throw new Error("The native replica returned a mismatched local projection.");
      acceptProjection(next,inputVersion);active=next;
      sameAuthority=active.replicaAuthority===undefined||active.replicaAuthority?.sessionID===authority.sessionID&&
        active.replicaAuthority?.workspaceGeneration===authority.workspaceGeneration;
      if(reserveThisPage){if(!next.authoritySerialRequestID)throw new Error("The local replica did not bind its authoritative serial reservation.");needsSerial=false;}
      if(synced.authoredApplied){authored=undefined;needsSerial=serialContest;}
      if(!synced.hasMore&&!needsSerial){await refresh(next.sessionID,next,logOffset);return next;}
    }
    throw new Error("The authoritative contest log changed too quickly to finish synchronising.");
  };
  const sendPendingMutation=async(item:PendingClientMutation)=>{
    const active=projectionRef.current,authority=readyAuthority();
    if(!active||active.sessionID!==item.localSessionID||active.workspaceGeneration!==item.localWorkspaceGeneration||
        authority.sessionID!==item.authoritySessionID||authority.workspaceGeneration!==item.authorityWorkspaceGeneration)
      throw new Error("The pending contest operation belongs to a stale local or group authority context.");
    const context={operatingContext,sessionID:active.sessionID,workspaceGeneration:active.workspaceGeneration};
    let applied;try{applied=await requestContestGroupAuthority(context,"contactApply",item.params,item.requestID);}
    catch{applied=await requestContestGroupAuthority(context,"contactApply",item.params,item.requestID);}
    const next=item.action==="commit"?await syncReplica({qsoID:item.qsoID,draftID:item.draftID}):await syncReplica();
    if(item.action!=="commit"&&Number(next.replicaCursor?.revision??-1)<Number(applied.changeRevision))
      throw new Error("The authoritative contact change has not reached the local replica.");
    localStorage.removeItem(pendingStorageKey(item));return next;
  };
  const resumePendingMutations=async()=>{
    const active=projectionRef.current,authority=readyAuthority();if(!active)return;
    const pending:PendingClientMutation[]=[];
    const localScope=`${pendingClientPrefix}${active.sessionID}/${active.workspaceGeneration}/`;
    for(let index=0;index<localStorage.length;index+=1){const key=localStorage.key(index);if(!key?.startsWith(localScope))continue;
      let value:unknown;try{value=JSON.parse(localStorage.getItem(key)??"");}catch{continue;}
      if(validPendingClientMutation(value)&&value.localSessionID===active.sessionID&&value.localWorkspaceGeneration===active.workspaceGeneration&&
          value.authoritySessionID===authority.sessionID&&value.authorityWorkspaceGeneration===authority.workspaceGeneration)pending.push(value);
    }
    pending.sort((left,right)=>left.createdAt-right.createdAt);
    for(const item of pending)await sendPendingMutation(item);
  };
  const flushDraft = async (supplied = projectionRef.current,
      frequencyHz = operationFrequencyHz): Promise<Projection | null> => {
    if (!supplied) return null;
    if (frequencyHz === null) throw new Error("Connect the selected radio or enter a frequency on a band supported by this contest before continuing.");
    const values = { ...fieldsRef.current }, inputVersion = editVersionRef.current;
    if (sameFields(values, projectionFields(supplied)) && frequencyHz === supplied.frequencyHz) return supplied;
    const changed = await mutate("contest_draft_apply", supplied, { fields: values, frequencyHz });
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
          action.workspaceGeneration !== origin.workspaceGeneration || action.sourceRevision !== origin.sourceRevision ||
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
      throw new Error("The contest phone output claim could not be verified; do not retry the key.");
    if (controller.signal.aborted || phoneSimulationControllerRef.current !== controller) throw new PhoneSimulationStopped();
    if (phoneProductionAvailable) await voiceOutput.play(actions as ContestVoiceAction[], origin,
      String(setup.preferences.voiceProfilePath ?? ""), String(setup.preferences.soundDevice ?? ""), controller.signal);
    setPhoneSimulationTrace(items => [...items, ...traces].slice(-24));
    return { ...changed, actions: [] };
  };
  const consumeFldigiOutput = async (changed: MutationResult, origin: PhoneIntentOrigin): Promise<MutationResult> => {
    const operationID = changed.operationID, actions = changed.actions ?? [];
    if (!operationID || changed.replayed !== false || changed.revision !== changed.projection.revision ||
        !actions.length || actions.length > 12 || actions.some((action, index) => {
          const payload = typeof action.payload === "string" ? action.payload : "";
          return action.actionID !== `${operationID}:${index}` || action.kind !== "fldigi" || action.signal !== "digital" ||
            action.sessionID !== origin.sessionID || action.workspaceGeneration !== origin.workspaceGeneration ||
            action.sourceRevision !== origin.sourceRevision || action.draftID !== origin.draftID ||
            new TextEncoder().encode(payload).byteLength > 4_096 || !/^[0-9a-f]{64}$/.test(action.payloadSHA256);
        })) throw new Error("The contest fldigi intent could not be verified; no XML-RPC command was sent.");
    const claimed = await result<Data>("contest_output_claim", {
      sessionID: changed.projection.sessionID, operationID, revision: changed.projection.revision });
    if (claimed.claimed !== true || claimed.operationID !== operationID || canonicalJSON(claimed.actions) !== canonicalJSON(actions))
      throw new Error("The contest fldigi output claim could not be verified; do not retry the key.");
    await serviceRequest("fldigi_send", { actions });
    return { ...changed, actions: [] };
  };
  const hostAction = async (method: string, extra: Record<string, unknown> = {}, throwFailures = false,
      contestSurfaceRequestID?: string) => {
    if (configuredClient && (method === "contest_esm" || method === "contest_function_key")) {
      const failure=new Error("Client ESM and function keys are disabled until the master can authorize their logging action.");
      setError(failure.message); if(throwFailures)throw failure; return null;
    }
    const phoneAction = Boolean(projectionRef.current?.pluginID && contestPhoneIntentPlugins.has(projectionRef.current.pluginID) && projectionRef.current.mode === "SSB");
    const fldigiMode = projectionRef.current?.fldigiTransmitAvailable === true;
    const fldigiAction = Boolean(fldigiMode &&
      digitalSnapshot?.fldigi?.configuration.transmit_enabled && projectionRef.current?.mode !== "CW" && projectionRef.current?.mode !== "SSB");
    if (phoneReleaseBlocking) {
      const failure = new Error(phoneReleaseUncertain || "Contest phone PTT release is still pending.");
      setError(failure.message); if (throwFailures) throw failure; return null;
    }
    if (fldigiMode && !fldigiAction) {
      const failure = new Error("Enable fldigi macro transmit in Digital Logging Setup before using RTTY function keys.");
      setError(failure.message); if (throwFailures) throw failure; return null;
    }
    if (phoneAction && phoneReleaseUncertain) {
      const failure = new Error(phoneReleaseUncertain);
      setError(failure.message); if (throwFailures) throw failure; return null;
    }
    if (phoneAction && (!phoneOutputAvailable || !phoneCanSend)) {
      const failure = new Error(phoneOutputAvailable
        ? `Arm the ${phoneSimulationAvailable ? "nontransmitting phone simulation" : "recorded phone output"} before using phone contest messages.`
        : phoneProductionAvailable ? "Phone contest voice output is unavailable in production until a Voice WAV profile folder is saved; no audio or PTT action was taken."
          : "Phone contest voice output is unavailable; no audio or PTT action was taken.");
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
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a frequency on a band supported by this contest before using ESM.");
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
      }, !phoneAction, false, false, throwFailures,
        phoneAction ? consumeContestPhoneSimulation : fldigiAction ? consumeFldigiOutput : undefined, phoneController?.signal,
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

  const stopPhoneOutput = async () => {
    phoneSimulationControllerRef.current?.abort(); phoneSimulationControllerRef.current = null;
    const generation = ++phoneReleaseGenerationRef.current;
    setPhoneSimulationPending(true);
    try {
      await voiceOutput.stop();
      if (phoneReleaseGenerationRef.current === generation) {
        setPhoneReleaseUncertain(""); setPhoneSimulationArmed(false);
      }
    } catch (cause) {
      const message = `Contest phone PTT release remains uncertain: ${errorMessage(cause)}`;
      if (phoneReleaseGenerationRef.current === generation) {
        setPhoneReleaseUncertain(message); setPhoneSimulationArmed(true); setError(message);
      }
      throw cause;
    } finally {
      if (phoneReleaseGenerationRef.current === generation) setPhoneSimulationPending(false);
    }
  };

  const clearAutoCQ = () => {
    autoCQActiveRef.current = false;
    if (autoCQTimerRef.current !== null) window.clearTimeout(autoCQTimerRef.current);
    autoCQTimerRef.current = null; setAutoCQDeadlineMs(null);
  };
  const stopAutoCQ = async (stopOutput = true) => {
    clearAutoCQ();
    if (!stopOutput) return;
    if (phoneOutputAvailable) await stopPhoneOutput(); else await cw.controller.stop();
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
    if (phoneReleaseBlocking) throw new Error(phoneReleaseUncertain || "Contest phone PTT release is still pending.");
    if (active.mode !== "CW" && !phoneOutputAvailable) throw new Error("Auto CQ requires admitted CW or recorded phone output.");
    if (phoneOutputAvailable ? !phoneCanSend : !cw.state.armed) throw new Error("Arm the contest output before starting Auto CQ.");
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
    phoneSimulationControllerRef.current?.abort(); ++phoneReleaseGenerationRef.current;
    void voiceOutput.stop().catch(cause => console.error("Contest phone unmount release remains uncertain", cause));
  }, [voiceOutput]);
  useEffect(() => { clearAutoCQ(); }, [projection?.sessionID, projection?.mode, contestingTest, autoCQDelaySeconds]);

  useEffect(() => {
    if (!projection || editing) return;
    fieldRefs.current[projection.focus]?.focus();
  }, [projection?.focus, projection?.draftID, editing]);

  useEffect(() => {
    if (!projection) return;
    const previous = observedFrequencyRef.current;
    if (observedFrequencyHz === null) {
      observedFrequencyRef.current = { sessionID: projection.sessionID, frequencyHz: null };
      return;
    }
    if (busyRef.current || retiring) return;
    const freshObservedChange = previous.sessionID === projection.sessionID && previous.frequencyHz !== null &&
      previous.frequencyHz !== observedFrequencyHz;
    observedFrequencyRef.current = { sessionID: projection.sessionID, frequencyHz: observedFrequencyHz };
    if (!freshObservedChange && projection.frequencyHz === observedFrequencyHz) return;
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: fieldsRef.current, frequencyHz: observedFrequencyHz,
      ...(freshObservedChange ? { observedVFOChange: true } : {}),
    }), false, false, true);
  }, [observedFrequencyHz, projection?.sessionID, projection?.frequencyHz, busy, retiring]);

  const createSession = async (document: ContestSetupDocument) => {
    const contestCall = String(document.station.Call || stationCall).trim().toUpperCase();
    if (!contestCall) throw new Error("Configure the xLog station callsign before creating a contest.");
    const catalogBands = catalog.find(item => item.id === document.pluginID)?.supportedBands;
    const supportedBands = Array.isArray(catalogBands) && catalogBands.length ? catalogBands as string[] : bandDefinitions.map(band => band.id);
    const frequencyHz = contestFrequency(selectedRadioFrequencyHz, supportedBands, bandDefinitions) ??
      manualFrequency(manualFrequencyMHz, supportedBands, bandDefinitions);
    if (frequencyHz === null) throw new Error("Connect the selected radio or enter a frequency on a band supported by this contest before creating a contest.");
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await flushDraft(projectionRef.current, operationFrequencyHz ?? projectionRef.current?.frequencyHz ?? null);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workspaceGeneration))
        throw new Error("The current xLog workspace identity is unavailable. Reopen the workspace before creating a contest.");
      const sessionID = crypto.randomUUID();
      const created = await result<MutationResult>("contest_create", { sessionID, workspaceGeneration,
        operationID: crypto.randomUUID(), expectedRevision: 0,
        pluginID: document.pluginID, name: document.name.trim() || "CQ WW CW", station: { ...document.station, Call: contestCall },
        operator: document.operator.trim().toUpperCase() || contestCall, frequencyHz,
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
    if (!setupOnly && !projection) return;
    let active = true;
    const refreshDigital = () => void Promise.allSettled([serviceRequest("wsjtx_snapshot"), serviceRequest("fldigi_snapshot")]).then(([wsjtx, fldigi]) => {
      if (!active) return;
      const decoded = wsjtx.status === "fulfilled" ? boundedDigitalSnapshot(wsjtx.value) : undefined;
      if (decoded && fldigi.status === "fulfilled") decoded.fldigi = boundedFldigiSnapshot(fldigi.value);
      setDigitalSnapshot(decoded);
    });
    refreshDigital(); const timer = window.setInterval(refreshDigital, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [setupOnly, serviceRequest, projection?.sessionID, projection?.revision]);
  useContestSetupDialogs({ enabled: setupOnly, context: `${operatingContext}/${workspaceGeneration}/${projection?.sessionID ?? "no-session"}`,
    document: setup, auxiliary: { roverLocation: projection?.roverLocation ?? "", activeSessionID: projection?.sessionID, catalog: setupCatalog,
      effectiveMacros, diagnostics: {
      engine: "Not1MM Python", plugin: projection?.pluginID ?? "No open contest",
      version: projection?.ruleIdentity?.version ?? "26.10.11", source: projection?.sourceRevision ?? "7c8b499225a73f7f8f792246881bd7aefc05452f",
      reference: projection?.referenceID ?? "No active reference" }, digital: digitalSnapshot }, save: async document => {
      if (busyRef.current || retiring) throw new Error("Contest Setup is busy. Try again after it finishes.");
      await saveSetup(document);
    }, saveRover: async location => { await hostAction("contest_rover_location", { location }, true); },
    saveDigital: async ({ configuration, fldigi_configuration, action }: ContestDigitalSave) => {
      if (busyRef.current || retiring) throw new Error("Contest Setup is busy. Try again after it finishes.");
      if (action === "stop") {
        await Promise.all([serviceRequest("wsjtx_stop"), serviceRequest("fldigi_stop")]);
        const wsjtx = boundedDigitalSnapshot(await serviceRequest("wsjtx_snapshot"));
        if (wsjtx) wsjtx.fldigi = boundedFldigiSnapshot(await serviceRequest("fldigi_snapshot"));
        setDigitalSnapshot(wsjtx);
      }
      else {
        const fldigi = boundedFldigiSnapshot(await serviceRequest("fldigi_configure", {
          configuration: fldigi_configuration ?? { receive_enabled: false, transmit_enabled: false } }));
        const configured = boundedDigitalSnapshot(await serviceRequest("wsjtx_configure", { configuration: { ...configuration, enabled: action === "start" ? true : configuration.enabled } }));
        const wsjtx = action === "start" ? boundedDigitalSnapshot(await serviceRequest("wsjtx_start")) : configured;
        const startedFldigi = action === "start" && fldigi?.configuration.receive_enabled
          ? boundedFldigiSnapshot(await serviceRequest("fldigi_start")) : fldigi;
        if (wsjtx) wsjtx.fldigi = startedFldigi;
        setDigitalSnapshot(wsjtx);
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
    if (contestFrequency(frequencyHz, activeSupportedBands, bandDefinitions) === null) {
      if (throwFailures) throw new Error("That spot is outside the active contest's supported bands.");
      return;
    }
    const next = await runMutation(async base => {
      await stationTune(frequencyHz, base.mode);
      return mutate("contest_draft_apply", base, {
        fields: { ...fieldsRef.current, callsign: String(spot.callsign ?? "").toUpperCase() }, frequencyHz,
      });
    }, false, false, false, throwFailures);
    if (!next) return;
    spotCursorRef.current = { ...spotCursorRef.current, context: spotSelectionContext, spotID: String(spot.id) };
    setManualFrequencyMHz((frequencyHz / 1_000_000).toFixed(6));
    onSelectedSpot?.(String(spot.id));
    setNotice(`Loaded ${spot.callsign} after the selected radio confirmed one tune.`);
  };

  const exportLog = async (format: PythonContestExportFormat, throwFailures = false, completion?: {
      operatingContext:string;sessionID:string;workspaceGeneration:string;requestID:string;projectionRevision:number }) => {
    const active = projectionRef.current;
    if (!active || busyRef.current) return;
    const exportFormats=active.exportFormats??["cabrillo","adif"];
    const formatLabel = format === "cabrillo" ? "Cabrillo" : format.toUpperCase();
    if(!exportFormats.includes(format)){const failure=new Error(`${formatLabel} export is not supported by this contest.`);
      setError(failure.message);if(throwFailures)throw failure;return;}
    let nativeOwnsCompletion = false;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const prepared = await result<ContestExportSavePrepared & { filename?: string }>("contest_export_prepare", { sessionID: active.sessionID, format });
      nativeOwnsCompletion = completion !== undefined;
      const saved = await nativeContestExportSave(prepared, completion);
      if (saved.status === "saved") setNotice(`Saved ${saved.filename}.`);
      else if (saved.status === "cancelled") setNotice(`${formatLabel} save cancelled.`);
      else setError(saved.message);
      return completion ? "native-completed" as const : undefined;
    } catch (cause) { setError(errorMessage(cause)); if (nativeOwnsCompletion) return "native-completed" as const; if (throwFailures) throw cause; }
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
      const raw = row.raw_fields && typeof row.raw_fields === "object" && !Array.isArray(row.raw_fields) ? row.raw_fields as Record<string, unknown> : {};
      setEditing({ ...row, raw_fields: raw }); setEditCall(String(raw.callsign ?? row.Call ?? "")); setEditZone(String(raw.other_2 ?? exchange.other_2));
      setEditTimestamp(String(row.TS ?? "")); setEditFrequencyMHz((Number(row.Freq ?? 0) / 1000).toFixed(6));
      setEditOperator(String(row.Operator ?? "")); setEditSent(String(raw.sent ?? row.SNT ?? "")); setEditReceived(String(raw.receive ?? row.RCV ?? ""));
      setEditName(String(raw.Name ?? row.Name ?? "")); setEditQTH(String(raw.QTH ?? row.QTH ?? "")); setEditComment(String(raw.Comment ?? row.Comment ?? ""));
      setEditSentExchange(String(raw.other_1 ?? exchange.other_1)); setCorrectionReason("Operator correction");
      setDeletionReason("Operator deletion"); setConfirmDelete(false);
    } catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCorrection = async (reason: string, throwFailures = false) => { if (!editing) return null;
    const frequencyHz = manualFrequency(editFrequencyMHz, activeSupportedBands, bandDefinitions);
    if (frequencyHz === null) throw new Error("Enter a frequency on a band supported by this contest before saving the correction.");
    const originalFields = editing.raw_fields && typeof editing.raw_fields === "object" && !Array.isArray(editing.raw_fields)
      ? editing.raw_fields as Record<string, unknown> : {};
    const active = projectionRef.current;
    const pluginMetadata = pluginContactMetadataColumns(active?.fields ?? []);
    const correctionFields: Record<string, unknown> = { ...originalFields, callsign: editCall.toUpperCase(), sent: editSent,
      receive: editReceived, other_1: editSentExchange, other_2: editZone };
    for (const [column, value] of [["Name", editName], ["QTH", editQTH], ["Comment", editComment]] as const) {
      delete correctionFields[column];
      const original = String(originalFields[column] ?? editing[column] ?? "");
      if (!pluginMetadata.has(column) && value !== original) correctionFields[column] = value;
    }
    if(configuredClient){
      if(authorityBusyRef.current)throw new Error("The authoritative contest log is synchronising; try again.");
      authorityBusyRef.current=true;
      try{
      const baseRevision=authoritativeChangeRevision(editing);
      if(!active)throw new Error("The active contest authority context is unavailable.");
      const pending=pendingMutation("correct",active,baseRevision,()=>{const qsoID=String(editing.ID);return{qsoID,params:{action:"correct",qsoID,baseRevision,
        timestamp:editTimestamp,frequencyHz,operator:editOperator,
        fields:correctionFields,reason}}});
      const next=await sendPendingMutation(pending);setEditing(null);setConfirmDelete(false);return next;
      }finally{authorityBusyRef.current=false;}
    }
    const next = await runMutation(base => mutate("contest_qso_correct", base, { qsoID: editing.ID,
      timestamp: editTimestamp, frequencyHz, operator: editOperator,
      fields: correctionFields, reason }), true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const correct = (event: FormEvent) => { event.preventDefault();
    void saveCorrection(correctionReason).catch(cause => setError(errorMessage(cause))); };
  const deleteQSO = async (reason: string, throwFailures = false) => { if (!editing) return null;
    if(configuredClient){
      if(authorityBusyRef.current)throw new Error("The authoritative contest log is synchronising; try again.");
      authorityBusyRef.current=true;
      try{
      const active=projectionRef.current,baseRevision=authoritativeChangeRevision(editing);
      if(!active)throw new Error("The active contest authority context is unavailable.");
      const pending=pendingMutation("delete",active,baseRevision,()=>{const qsoID=String(editing.ID);return{qsoID,
        params:{action:"delete",qsoID,baseRevision,reason}}});
      const next=await sendPendingMutation(pending);setEditing(null);setConfirmDelete(false);return next;
      }finally{authorityBusyRef.current=false;}
    }
    const next = await runMutation(base => mutate("contest_qso_delete", base, { qsoID: editing.ID, reason }),
      true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const remove = () => { if (!editing || !confirm(`Delete ${editing.Call} from this contest?`)) return;
    void deleteQSO(deletionReason).catch(cause => setError(errorMessage(cause))); };
  const commitEntry=async()=>{
    if(configuredClient){
      if(authorityBusyRef.current)throw new Error("The authoritative contest log is synchronising; try again.");
      authorityBusyRef.current=true;
      try{
        const current=projectionRef.current;if(!current)throw new Error("The active contest authority context is unavailable.");
        const restored=pendingForDraft("commit",current),base=restored?current:await syncReplica(),
          pending=restored??pendingMutation("commit",base,base.revision,()=>{const qsoID=crypto.randomUUID();return{qsoID,
            params:{action:"commit",qsoID,timestamp:new Date().toISOString().slice(0,19).replace("T"," "),
              frequencyHz:base.frequencyHz,mode:base.mode,operator:base.operator??setup.operator,fields:{...fieldsRef.current},
              ...(base.authoritySerialRequestID?{serialRequestID:base.authoritySerialRequestID}:{})}}});
        return await sendPendingMutation(pending);
      }finally{authorityBusyRef.current=false;}
    }
    return runMutation(base=>mutate("contest_qso_commit",base,{fields:fieldsRef.current,frequencyHz:base.frequencyHz}),
      true,true,false,true);
  };

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
    const visibleHostFields = projection.fields.filter(field => field.visible);
    const reportFields = visibleHostFields.filter(field => field.id === "sent" || field.id === "receive");
    const exchangeFields = visibleHostFields.filter(field => field.id !== "callsign" && field.id !== "sent" && field.id !== "receive");
    const receivedExchangeFields = exchangeFields.filter(field => !field.readOnly);
    const sentExchangeFields = exchangeFields.filter(field => field.readOnly);
    const receivedZone = projection.fields.find(field => field.id === "other_2");
    const sentZone = projection.fields.find(field => field.id === "other_1");
    const reportsVisible = reportFields.length > 0;
    const allocatedSerialField = reservedSerial === null ? null : projection.allocatedSerialFieldID ?? null;
    const editedFrequencyHz = editing ? manualFrequency(editFrequencyMHz, activeSupportedBands, bandDefinitions) : null;
    const callContext = projection.callContext?.callsign === partialQuery ? projection.callContext : undefined;
    const fldigiOperatorAvailable = projection.fldigiTransmitAvailable === true &&
      digitalSnapshot?.fldigi?.configuration.transmit_enabled === true;
    const digitalOperatorMode = rttyContestModeAliases.has(projection.mode);
    const operatorOutputAvailable = projection.mode === "CW" || phoneOutputAvailable || fldigiOperatorAvailable;
    const operatorOutputUnavailableReason = operatorOutputAvailable ? null : projection.mode === "SSB"
      ? "Recorded phone output is unavailable until a Voice WAV profile folder is saved in Contest Setup."
      : digitalOperatorMode
        ? "fldigi macro output is unavailable. Enable fldigi macro transmit in Digital Logging Setup."
        : "Contest function-key output is unavailable for this mode.";
    unavailable["active-qso"] = {
      schemaVersion: 2, status: "ready",
      manual: {operator:projection.operator ?? "", cwSpeedWpm:projection.cwSpeedWpm ?? null,
        cwSpeedStepWpm:Number.isInteger(setup.preferences.cwSpeedStep) && Number(setup.preferences.cwSpeedStep) >= 1 && Number(setup.preferences.cwSpeedStep) <= 10 ? Number(setup.preferences.cwSpeedStep) : 1,
        country:callContext?.country ?? null, cqZone:callContext?.cqZone ?? null, ituZone:callContext?.ituZone ?? null,
        headingDegrees:callContext?.headingDegrees ?? null, longPathHeadingDegrees:callContext?.longPathHeadingDegrees ?? null,
        distanceKm:callContext?.distanceKm ?? null, qsos:projection.score.qsos, multipliers:projection.score.multipliers ?? projection.score.countries + projection.score.zones, total:projection.score.total},
      session: { name: activeSessionName, ruleName: projection.pluginName ?? projection.pluginID, mode: projection.mode },
      draft: {
        draftID: projection.draftID, revision: projection.revision, callsign: currentFields.callsign ?? "",
        sentReport: currentFields.sent ?? "", receivedReport: currentFields.receive ?? "",
        receivedFields: receivedExchangeFields.map(field => ({ id: field.id, label: field.label,
          value: currentFields[field.id] ?? "", required: true, maximumUTF8Bytes: field.id === "other_1" ? 32 : 128,
          enabled: field.enabled, readOnly: field.readOnly })),
        frequencyHz, frequencyText: frequencyHz === null ? "" : String(frequencyHz),
        frequencyError: frequencyHz === null ? "Enter a frequency on a band supported by this contest." : "",
        band: bandLabels[String(projection.band)] ?? String(projection.band), mode: projection.mode,
        dupe: configuredClient ? authorityClientReady&&authorityDupe?.key===`${projection.draftID}|${(currentFields.callsign??"").trim().toUpperCase()}|${frequencyHz}|${projection.mode}`
          ? {state:authorityDupe.isDupe?"duplicate":"clear" as const,reason:authorityDupe.isDupe?"Worked in the authoritative group log.":"Clear in the authoritative group log."}
          : {state:"unchecked" as const,reason:"Awaiting the authoritative group duplicate check."}
          : { state: projection.dupe ? "duplicate" : "clear", reason: projection.dupe
          ? projection.dupeExplanation ?? "Worked on this band." : "Clear for this contest." },
        validation: { errors: [], warnings: projection.countryResolved ? [] : ["Country is unresolved; scoring credit may be zero."] },
        reservedSerial,
      },
      descriptor: {
        bands: configuredBands, modes: contestSurfaceModes(projection.supportedModes ?? [], projection.mode), reportsVisible,
        reportFields: reportFields.map(field => ({ id: field.id, label: field.label, value: currentFields[field.id] ?? "",
          required: true, maximumUTF8Bytes: 160, enabled: field.enabled, readOnly: field.readOnly })),
        allowDuplicateCommit: projection.allowDuplicateCommit ?? false, automaticSerial: reservedSerial !== null,
        advanceOnSpace: (projection.advanceOnSpace ?? ["callsign"]).filter(contestInputFieldID),
        keyBindings: activeContestKeyBindings(setup.preferences.keyBindings),
        sentFields: sentExchangeFields.map(field => ({ id: field.id, label: field.label,
          value: currentFields[field.id] ?? "", required: true, maximumUTF8Bytes: 32,
          enabled: field.enabled, readOnly: field.readOnly })),
        serial: reservedSerial === null ? { requirement: "none", allocatedFieldID: null, reservedSerial: null }
          : { requirement: "requiredForCommit", allocatedFieldID: allocatedSerialField, reservedSerial },
      },
      operator: {
        output: phoneSimulationAvailable || cw.state.canonical?.provider === "test-simulation" ? "test-simulation" : "xlog-native",
        outputAvailable: operatorOutputAvailable,
        outputUnavailableReason: operatorOutputUnavailableReason,
        armed: Boolean(phoneReleaseUncertain) || phoneSimulationArmed || fldigiOperatorAvailable || projection.mode === "CW" && cw.state.armed,
        style: projection.run ? "run" : "search-and-pounce",
        status: phoneReleaseUncertain ? "uncertain" : phoneSimulationPending ? "waiting" : phoneOutputAvailable ? phoneSimulationArmed ? "armed" : "disarmed"
          : fldigiOperatorAvailable ? "armed" : projection.mode === "CW" && cw.state.pending ? "waiting"
            : projection.mode === "CW" && cw.state.error ? "uncertain" : projection.mode === "CW" && cw.state.armed ? "armed" : "disarmed",
        pending: phoneSimulationPending || projection.mode === "CW" && cw.state.pending ? "send" : null,
        focusedField: contestInputFieldID(projection.focus) ? projection.focus : null,
        tabNext: contestTabMap(projection.tabNext), tabPrevious: contestTabMap(projection.tabPrevious),
        functionKeys: projection.functionKeys.map(item => ({ key: item.id as ContestFunctionKey,
          macro: item.label ?? item.id, highlighted: item.highlighted })),
        autoCQ: { active: autoCQDeadlineMs !== null, delaySeconds: autoCQDelaySeconds,
          remainingMs: autoCQDeadlineMs === null ? null : Math.max(0, autoCQDeadlineMs - autoCQNowMs) },
        readiness: { canSendCQ: !phoneReleaseBlocking && (fldigiOperatorAvailable || (phoneOutputAvailable ? phoneCanSend : projection.mode === "CW" && cw.state.armed)),
          canSendCall: !phoneReleaseBlocking && (fldigiOperatorAvailable || (phoneOutputAvailable ? phoneCanSend : projection.mode === "CW" && cw.state.armed)),
          canSendDuplicate: !phoneReleaseBlocking && (fldigiOperatorAvailable || (phoneOutputAvailable ? phoneCanSend : projection.mode === "CW" && cw.state.armed)),
          canReserveCall: false, canReserveCommit: false, canCommit: true },
        trace: phoneOutputAvailable ? phoneSimulationTrace : [],
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
      canExportCabrillo: projection.exportFormats?.includes("cabrillo")??true,
      canExportAdif: projection.exportFormats?.includes("adif")??true,
      canExportEdi: projection.exportFormats?.includes("edi")??false,
      page: { offset: logOffset, limit: logPageSize, total: logTotal, rows: logRows(rows, projection.pluginID, bandLabels) },
      ...(pluginColumns.length ? { exchangeLayout: "plugin" as const, pluginColumns,
        pluginRows:not1mmLogRows(rows,pluginColumns), pluginPartialRows:not1mmLogRows(partialRows,pluginColumns) }
        : { manualRows:manualRows(rows), partialRows:manualRows(partialRows) }),
      editing: editing ? {
        qsoID: String(editing.ID ?? ""), workedAt: editTimestamp, operator: editOperator, callsign: editCall,
        name: editName, qth: editQTH, comment: editComment, reportsVisible,
        details: logEditDetails(editing),
        band: bandLabels[String(editing.Band)] ?? String(editing.Band ?? ""), mode: String(editing.Mode ?? "CW"),
        sentReport: editSent, receivedReport: editReceived,
        entryFields: visibleHostFields.filter(field => field.id !== "callsign").map(field => ({ id:field.id,label:field.label,
          value:field.id==="sent"?editSent:field.id==="receive"?editReceived:field.id==="other_1"?editSentExchange:editZone,
          required:true,maximumUTF8Bytes:field.id==="other_1"?32:field.id==="other_2"?128:160,
          enabled:field.enabled,readOnly:field.readOnly })),
        receivedFields: [
          { id: "other_1", label: sentZone?.label || "Sent exchange", value: editSentExchange, required: true, maximumUTF8Bytes: 32 },
          { id: "other_2", label: receivedZone?.label || "Received exchange", value: editZone, required: true, maximumUTF8Bytes: 128 },
        ],
        frequencyHz: editedFrequencyHz, editFrequencyText: editedFrequencyHz === null ? "" : String(editedFrequencyHz),
        frequencyError: editedFrequencyHz === null ? "Enter a frequency on a band supported by this contest." : "",
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
      history: { source: historyCandidate ? "Imported Call History" : null,
        rows: historyCandidate ? [historyCandidate] : [] },
      busy: !!scpSurface?.busy,
    };
    const clusterSnapshot=cluster?.snapshot as Data|undefined;
    const connectedClusters=Number.isSafeInteger(clusterSnapshot?.connectedClusters)&&Number(clusterSnapshot?.connectedClusters)>=0
      ? Number(clusterSnapshot?.connectedClusters):0;
    const loadedSpots=Number.isSafeInteger(clusterSnapshot?.loadedSpots)&&Number(clusterSnapshot?.loadedSpots)>=0
      ? Number(clusterSnapshot?.loadedSpots):sharedSpots.length;
    const selectedCandidate=spotCursorRef.current.context===spotSelectionContext?spotCursorRef.current.spotID:
      selectedSpotId==null?null:String(selectedSpotId);
    const selectedSpotID=selectedCandidate!==null&&visibleWorkflowSpots.some(spot=>spot.id===selectedCandidate)?selectedCandidate:null;
    for(const panelID of ["band-maps","dx-cluster"] as const) unavailable[panelID]={schemaVersion:2,status:"ready",
      draftID:projection.draftID,draftRevision:projection.revision,radioFrequencyHz:radioFrequencyHz??null,
      connectedClusters,loadedSpots,selectedSpotID,markedOnly:effectiveSpotWorkflow.markedOnly,spots:visibleWorkflowSpots,busy:busy||retiring};
    unavailable["station-control"] = { schemaVersion: 1, status: "ready",
      radioFrequencyHz: selectedRadioFrequencyHz, contestFrequencyHz: frequencyHz,
      band: bandLabels[String(projection.band)] ?? String(projection.band), mode: projection.mode, busy: busy || retiring };
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
    const rtcService=setup.preferences.rtcURL==="https://contestonlinescore.com/post/"?"contestonlinescore":"hamscore";
    const rtcOutcome=rtcStatus?.last_outcome??"Score reporting is disabled.";
    const reportState=rtcReportState(rtcStatus);
    unavailable["score-reporting"] = { schemaVersion: 1, status: "ready", score: scoreView,
      intervalMinutes: rtcStatus?.interval_minutes??Math.max(1,Math.min(60,Number(setup.preferences.rtcIntervalMinutes)||2)),
      reportingEnabled: rtcStatus?.enabled===true, availability: contestingTest?"unavailable":"available",
      reason: "HTTPS RTC posting is separate from local score display and N1MM UDP score packets.", service:rtcService,
      username:String(setup.preferences.rtcUsername??""),credentialSaved:rtcCredentialSaved,reportState,lastOutcome:rtcOutcome,
      nextAttempt:rtcStatus?.next_attempt??null,
      services: [
        { id: "hamscore", name: "Real Time Contest Server", url: "https://hamscore.com/postxml/", transportSecurity: "https" },
        { id: "contestonlinescore", name: "Contest Online ScoreBoard", url: "https://contestonlinescore.com/post/", transportSecurity: "https" },
        { id: "contest-run", name: "Live Contest Score", url: "http://contest.run", transportSecurity: "legacy-http" },
      ], busy: busy || retiring };
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
    editCall, editTimestamp, editFrequencyMHz, editOperator, editSent, editReceived, editSentExchange, editZone, editName, editQTH, editComment,
    correctionReason, confirmDelete, deletionReason,
    busy, retiring, scpSurface, cw.state.armed, cw.state.pending, cw.state.error, phoneSimulationAvailable, phoneOutputAvailable, phoneSimulationArmed,
    phoneSimulationPending, phoneReleaseUncertain, phoneSimulationTrace, rates, matrices, statistics, partial, partialQuery, historyCandidate, spots, cluster, configuredBands,
    bandDefinitions, bandLabels, digitalSnapshot,rtcStatus,rtcCredentialSaved,
    setup.settings.SentExchange, setup.preferences.keyBindings, autoCQDeadlineMs, autoCQNowMs, autoCQDelaySeconds, selectedRadioFrequencyHz,
    sharedSpots,visibleWorkflowSpots,effectiveSpotWorkflow.markedOnly,selectedSpotId,configuredClient,authorityClientReady,authorityDupe]);

  const surfaceContext = detachedAvailable && projection ? {
    operatingContext, sessionID: projection.sessionID, workspaceGeneration: projection.workspaceGeneration,
  } : null;
  useEffect(()=>{
    if(!authorityClientReady||!surfaceContext||!projection){setAuthorityDupe(null);return;}
    const call=(fields.callsign??"").trim().toUpperCase(),frequencyHz=operationFrequencyHz;
    if(!/^[A-Z0-9/]{3,32}$/.test(call)||frequencyHz===null){setAuthorityDupe(null);return;}
    const key=`${projection.draftID}|${call}|${frequencyHz}|${projection.mode}`,requestID=crypto.randomUUID();let cancelled=false;
    const params={call,frequencyHz,mode:projection.mode,timestamp:new Date().toISOString().slice(0,19).replace("T"," ")};
    void requestContestGroupAuthority(surfaceContext,"dupeInquiry",params,requestID).then(value=>{
      if(!cancelled&&projectionRef.current?.draftID===projection.draftID)setAuthorityDupe({key,isDupe:value.isDupe===true});
    }).catch(()=>{if(!cancelled)setAuthorityDupe(null);});
    return()=>{cancelled=true;};
  },[authorityClientReady,surfaceContext?.operatingContext,surfaceContext?.sessionID,surfaceContext?.workspaceGeneration,
    projection?.draftID,projection?.mode,fields.callsign,operationFrequencyHz]);
  const handleSurfaceAction = async (action: ContestSurfaceActionEnvelope) => {
    const active = projectionRef.current;
    if (!active || !detachedAvailable || action.sessionID !== active.sessionID ||
        action.workspaceGeneration !== active.workspaceGeneration || action.operatingContext !== operatingContext)
      throw new Error("This detached panel no longer belongs to the active contest session.");
    if (action.action === "entry_operator_key" && action.params.key === "Escape") {
      await stopAutoCQ(); return;
    }
    if (busyRef.current || retiring) throw new Error("The contest owner is busy.");
    if (action.action.startsWith("entry_") || action.action.startsWith("assistance_") || action.action.startsWith("spot_")) {
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
    const currentSpot=()=>{
      const query=(fieldsRef.current.callsign??"").trim().toUpperCase();
      const selected=spotCursorRef.current.context===spotSelectionContext?spotCursorRef.current.spotID:
        selectedSpotId==null?null:String(selectedSpotId);
      return (query?visibleWorkflowSpots.find(spot=>spot.callsign===query)??visibleWorkflowSpots.find(spot=>spot.callsign.includes(query)):null)
        ??(selected===null?null:visibleWorkflowSpots.find(spot=>spot.id===selected)??null);
    };
    const workflowBase=(current:SpotWorkflow)=>sameSpotWorkflowScope(current,spotWorkflowScope)?current:effectiveSpotWorkflow;
    switch (action.action) {
      case "spot_select": {
        const spot=visibleWorkflowSpots.find(candidate=>candidate.id===action.params.spotID);
        if(!spot)throw new Error("That shared spot is no longer available.");
        await chooseSpot(spot, true); return;
      }
      case "spot_confirm":
      case "spot_delete":
      case "spot_set_marked": {
        const spot=allWorkflowSpots.find(candidate=>candidate.id===action.params.spotID);
        if(!spot)throw new Error("That shared spot is no longer available.");
        setSpotWorkflow(current=>updateContestSpotWorkflow(workflowBase(current),allWorkflowSpots,spot.id,
          action.action==="spot_confirm"?"confirm":action.action==="spot_delete"?"delete":"mark",
          action.action==="spot_set_marked"?action.params.marked:false));
        if(action.action==="spot_delete"&&spotCursorRef.current.spotID===spot.id)
          spotCursorRef.current={...spotCursorRef.current,context:spotSelectionContext,spotID:null};
        return;
      }
      case "spot_set_marked_only":
        setSpotWorkflow(current=>({...workflowBase(current),markedOnly:action.params.markedOnly}));return;
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
        const frequencyHz = /^\d+$/.test(action.params.value) ? contestFrequency(Number(action.params.value), activeSupportedBands, bandDefinitions) : null;
        if (frequencyHz === null) throw new Error("Enter a frequency in Hz on a band supported by this contest.");
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
            : field.readOnly ? field.value : ""]));
        fieldsRef.current = cleared; setFields(cleared); editVersionRef.current += 1;
        await runMutation(base => mutate("contest_draft_apply", base, { fields: cleared,
          frequencyHz: operationFrequencyHz ?? base.frequencyHz }), false, true, true, true);
        return;
      }
      case "entry_spot": {
        const callsign=(fieldsRef.current.callsign??"").trim().toUpperCase(),frequencyHz=operationFrequencyHz;
        if(!callsign)throw new Error("Enter a callsign before spotting it.");
        if(frequencyHz===null)throw new Error("A valid contest frequency is required before spotting a callsign.");
        const frequencyKHz=(frequencyHz/1000).toFixed(3).replace(/\.0+$/,"").replace(/(\.\d*?)0+$/,"$1");
        await contestSpot(callsign, frequencyHz);
        setNotice(`Spotted ${callsign} on ${frequencyKHz} kHz through the existing xLog cluster connection.`);return;
      }
      case "entry_mark_spot": {
        const callsign=(fieldsRef.current.callsign??"").trim().toUpperCase();
        if(!callsign)throw new Error("Enter the exact callsign to mark or unmark.");
        const admittedFrequencyHz=contestFrequency(selectedRadioFrequencyHz,activeSupportedBands,bandDefinitions);
        if(admittedFrequencyHz===null)throw new Error("A current observed xLog radio frequency on a band supported by this contest is required to mark a callsign.");
        const frequencyKHz=admittedFrequencyHz/1_000,receivedAt=Date.now()/1_000-978_307_200;
        const existing=allWorkflowSpots.find(spot=>spot.callsign===callsign&&Math.round(spot.frequencyKHz*1_000)===selectedRadioFrequencyHz);
        const spot:ContestSurfaceSpot=existing??{id:`contest-mark:${selectedRadioFrequencyHz}:${callsign}`,receivedAt,clusterName:"Contest",
          spotter:stationCall,spotterContinent:null,frequencyKHz,frequencyText:frequencyKHz.toFixed(3),callsign,comment:"Marked from Main Logging",
          band:bandLabels[String(active.band)]??String(active.band),mode:active.mode,country:"",adif:null,continent:"",cqZone:null,ituZone:null,
          callStatus:"",dxccStatus:"",workedBefore:null,specialTags:[],score:0,scoreReasons:[],aggregateCount:1,
          aggregateSpotters:stationCall?[stationCall]:[],source:"Contest mark",statusHex:"",bandHex:"",modeHex:"",marked:false};
        setSpotWorkflow(current=>updateContestSpotWorkflow(workflowBase(current),[...allWorkflowSpots.filter(item=>item.id!==spot.id),spot],
          spot.id,"mark",!spot.marked,receivedAt));return;
      }
      case "entry_tune_spot": {
        const spot=currentSpot();if(!spot)throw new Error("No selected or matching shared spot is available to tune.");
        await chooseSpot(spot,true);return;
      }
      case "entry_step_spot": {
        if (!visibleWorkflowSpots.length) throw new Error("No shared contest spots are available.");
        const cursor = spotCursorRef.current.context === spotSelectionContext ? spotCursorRef.current.spotID : null;
        const current = cursor == null ? -1 : visibleWorkflowSpots.findIndex(spot => spot.id === cursor);
        const nextIndex = action.params.direction === "next"
          ? current < 0 || current + 1 >= visibleWorkflowSpots.length ? 0 : current + 1
          : current <= 0 ? visibleWorkflowSpots.length - 1 : current - 1;
        await chooseSpot(visibleWorkflowSpots[nextIndex], true); return;
      }
      case "entry_step_vfo":
        if(contestingTest)throw new Error("VFO stepping is disabled in Contesting Test.");
        if(!stationStep)throw new Error("The selected xLog radio cannot step the VFO.");
        await stationStep(action.params.direction);
        setNotice(`VFO ${action.params.direction === "up" ? "increased" : "decreased"} after authoritative radio readback.`);return;
      case "entry_commit":
        await commitEntry();return;
      case "entry_operator_arm":
        if (!action.params.armed) clearAutoCQ();
        if (phoneReleaseBlocking) {
          if (action.params.armed) throw new Error(phoneReleaseUncertain || "Contest phone PTT release is still pending.");
          await stopPhoneOutput(); return;
        }
        if (phoneSimulationAvailable || phoneProductionAvailable) {
          if (action.params.armed && phoneProductionAvailable && !String(setup.preferences.voiceProfilePath ?? "").trim())
            throw new Error("Choose a voice WAV profile folder in Contest Sound settings before arming phone output.");
          if (action.params.armed && phoneReleaseUncertain)
            throw new Error(phoneReleaseUncertain);
          if (!action.params.armed) await stopPhoneOutput(); else setPhoneSimulationArmed(true);
          return;
        }
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
        else if (action.params.kind === "history" && historyCandidate?.candidateID === action.params.candidateID)
          await persistFields("callsign", historyCandidate.callsign);
        else throw new Error("The callsign candidate set is unavailable.");
        return;
      case "score_configure": {
        const urls={hamscore:"https://hamscore.com/postxml/",contestonlinescore:"https://contestonlinescore.com/post/"} as const;
        if(action.params.enabled&&(!action.params.username.trim()||(!action.params.password&& !rtcCredentialSaved)))
          throw new Error("Save the scoreboard username and password before enabling reports.");
        if(action.params.password) {
          await request("secret_save",{account:"rtc-score-password",value:action.params.password});
          setRTCCredentialSaved(true);
        }
        const preferences={...setup.preferences,rtcEnabled:action.params.enabled,rtcURL:urls[action.params.service],
          rtcUsername:action.params.username.trim(),rtcIntervalMinutes:action.params.intervalMinutes} as
          typeof setup.preferences&{rtcPassword?:unknown};
        delete preferences.rtcPassword;
        const document={...setup,preferences};
        const saved=await mutate("contest_setup_save",active,{setup:document}) as MutationResult&{setup:ContestSetupDocument};
        acceptProjection(saved.projection);setSetup(saved.setup);
        rtcConfigurationRef.current="";
        const status=await request("contest_rtc_configure",{sessionID:action.sessionID,workspaceGeneration:action.workspaceGeneration,
          service:action.params.service,url:urls[action.params.service],username:action.params.username.trim(),
          intervalMinutes:action.params.intervalMinutes,enabled:action.params.enabled});
        setRTCStatus(status as RTCStatus);return;
      }
      case "score_send_now": {
        const status=await request("contest_rtc_send_now");setRTCStatus(status as RTCStatus);return;
      }
      case "log_export_cabrillo": return exportLog("cabrillo", true, { operatingContext:action.operatingContext, sessionID:action.sessionID,
        workspaceGeneration:action.workspaceGeneration, requestID:action.requestID, projectionRevision:action.projectionRevision });
      case "log_export_adif": return exportLog("adif", true, { operatingContext:action.operatingContext, sessionID:action.sessionID,
        workspaceGeneration:action.workspaceGeneration, requestID:action.requestID, projectionRevision:action.projectionRevision });
      case "log_export_edi": return exportLog("edi", true, { operatingContext:action.operatingContext, sessionID:action.sessionID,
        workspaceGeneration:action.workspaceGeneration, requestID:action.requestID, projectionRevision:action.projectionRevision });
      case "log_recalculate":
        if (action.params.expectedSessionRevision !== active.revision) throw new Error("The contest log changed before recalculation started.");
        if (await runMutation(base => mutate("contest_recalculate", base), true, true, false, true))
          setNotice("Score and multipliers recalculated from the complete contest log.");
        return;
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
        else if (action.params.field === "name") setEditName(action.params.value);
        else if (action.params.field === "qth") setEditQTH(action.params.value);
        else if (action.params.field === "comment") setEditComment(action.params.value);
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
        const frequencyHz = /^\d+$/.test(action.params.value) ? contestFrequency(Number(action.params.value), activeSupportedBands, bandDefinitions) : null;
        if (frequencyHz === null) throw new Error("Enter a frequency in Hz on a band supported by this contest.");
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
      stationName: String(setup.network.stationName ?? "").trim(),
      multiMaster: setup.network.multiMaster === true,
      contestIdentity: groupContestIdentity(setup),
    }).then(snapshot=>{groupNetworkRef.current=snapshot;setGroupNetwork(snapshot);}).catch(cause => setError(errorMessage(cause)));
  }, [setupOnly, surfaceContext?.operatingContext, surfaceContext?.sessionID, surfaceContext?.workspaceGeneration,
    setup.network.multiEnabled, setup.network.multicastGroup, setup.network.multicastPort, setup.network.interface,
    setup.network.stationName, setup.network.multiMaster, setup.operator, setup.pluginID, setup.settings.StartDate, setup.station.Call]);

  useEffect(() => {
    if (!setupOnly || !surfaceContext || setup.network.multiEnabled !== true) return;
    let stopped = false, running = false;
    const reconcile = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await configureContestGroupChat(surfaceContext, {
          enabled: true,
          multicastGroup: String(setup.network.multicastGroup ?? "239.1.1.1"),
          multicastPort: Number(setup.network.multicastPort ?? 2239),
          interface: String(setup.network.interface ?? "0.0.0.0"),
          operator: setup.operator.trim().toUpperCase(),
          stationName: String(setup.network.stationName ?? "").trim(),
          multiMaster: setup.network.multiMaster === true,
          contestIdentity: groupContestIdentity(setup),
        });
        const snapshot=await readContestGroupNetwork(surfaceContext);
        const previous=groupNetworkRef.current?.authority;
        if(previous && (previous.role!==snapshot.authority.role||previous.status!==snapshot.authority.status||
            previous.sessionID!==snapshot.authority.sessionID||previous.workspaceGeneration!==snapshot.authority.workspaceGeneration))
          authorityGenerationRef.current+=1;
        groupNetworkRef.current=snapshot;setGroupNetwork(snapshot);
        if(snapshot.authority.role==="client"&&["leasing","connected"].includes(snapshot.authority.status)&&snapshot.authority.sessionID&&
            snapshot.authority.workspaceGeneration&&!authorityBusyRef.current&&!busyRef.current&&!editingRef.current&&
            projectionRef.current&&sameFields(fieldsRef.current,projectionFields(projectionRef.current))){
          authorityBusyRef.current=true;try{await resumePendingMutations();await syncReplica(undefined,{background:true});}catch{/* retry quietly */}
          finally{authorityBusyRef.current=false;}
        }
        // Pinned Renfield responds even when its SQLite write fails. Drain these
        // transport observations, but never use them to retire the Dirty ledger.
        await takeContestGroupUnverifiedAcknowledgements(surfaceContext);
        const current = projectionRef.current;
        if (!current || current.sessionID !== surfaceContext.sessionID || current.workspaceGeneration !== surfaceContext.workspaceGeneration) return;
        const pending = unwrap<{ sessionID:string; workspaceGeneration:string; contacts:Record<string,unknown>[] }>(
          await request("contest_network_pending", { sessionID: current.sessionID,
            workspaceGeneration: current.workspaceGeneration, limit: 100 }));
        if (pending.sessionID !== current.sessionID || pending.workspaceGeneration !== current.workspaceGeneration || !Array.isArray(pending.contacts))
          throw new Error("The contest contact publication queue is stale or malformed.");
        for (const contact of pending.contacts) {
          if (stopped) return;
          await publishContestGroupContact(surfaceContext, contact);
        }
      } catch (cause) {
        if (!stopped) setError(errorMessage(cause));
      } finally { running = false; }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 2_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [setupOnly, surfaceContext?.operatingContext, surfaceContext?.sessionID, surfaceContext?.workspaceGeneration,
    setup.network.multiEnabled, setup.network.multicastGroup, setup.network.multicastPort, setup.network.interface,
    setup.network.stationName, setup.network.multiMaster, setup.operator, setup.pluginID, setup.settings.StartDate, setup.station.Call, request]);

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

  const fldigiPanelReady = Boolean(projection?.fldigiTransmitAvailable && digitalSnapshot?.fldigi?.configuration.transmit_enabled);
  const cwPanel = () => {
    if (!projection || projection.mode === "SSB" && !phoneOutputAvailable) return null;
    const phone = projection.mode === "SSB" && phoneOutputAvailable;
    const armed = phoneReleaseBlocking ? phoneSimulationArmed || Boolean(phoneReleaseUncertain) : phone ? phoneSimulationArmed : fldigiPanelReady || cw.state.armed;
    const title = fldigiPanelReady ? "ESM and fldigi" : phone ? "ESM and Phone" : "ESM and CW";
    const description = fldigiPanelReady
      ? "Not1MM chooses the F-key text; xLog claims it once and sends it through fldigi XML-RPC."
      : phoneSimulationAvailable
        ? "CONTESTING TEST · simulated phone only · no RF, audio, PTT, radio, or network output"
        : phone
          ? "Not1MM chooses and claims each recorded message once; xLog requires fresh TX confirmation before audio."
          : cw.state.canonical?.provider === "test-simulation"
            ? "CONTESTING TEST · simulated CW only · no RF, audio, PTT, radio, or network output"
            : "Not1MM chooses the F-key action; xLog owns the armed CW output lease.";
    return <section className="contest-operator" aria-label={fldigiPanelReady ? "fldigi controls" : phone ? "Phone controls" : "CW controls"}>
      <header><div><strong>{title}</strong><p>{description}</p></div><span>{phoneReleaseUncertain ? "Phone PTT release uncertain" : phoneReleaseBlocking ? "Phone PTT release pending" : phone ? phoneSimulationPending ? "Phone output pending" : armed ? "Phone output armed" : "Phone output disarmed" : fldigiPanelReady ? digitalSnapshot?.fldigi?.status : cw.state.message}</span></header>
      <div className="contest-operator-controls">{!fldigiPanelReady&&<button type="button" disabled={busy || phoneSimulationPending || !phone&&cw.state.pending} onClick={() => phoneReleaseBlocking ? void stopPhoneOutput() : phone ? armed ? void stopPhoneOutput() : setPhoneSimulationArmed(true) : void cw.controller.arm()}>{phoneReleaseUncertain ? "Retry phone disarm" : phoneReleaseBlocking ? "Phone disarm pending" : phone ? armed ? "Disarm phone" : phoneSimulationAvailable ? "Arm phone simulation" : "Arm recorded phone" : cw.state.canonical?.provider === "test-simulation" ? "Arm simulation" : "Arm CW"}</button>}
        <button type="button" className="contest-danger-secondary" onClick={() => fldigiPanelReady ? void serviceRequest("fldigi_stop").then(() => setDigitalSnapshot(current => current?.fldigi ? {...current,fldigi:{...current.fldigi,configuration:{receive_enabled:false,transmit_enabled:false},receive_running:false,status:"Off"}} : current)) : void stopAutoCQ()}>Stop</button>
        <span className={armed ? "is-armed" : ""}>{armed ? "Armed" : "Disarmed"}</span>{autoCQDeadlineMs !== null&&<span role="status">Auto CQ · {Math.max(0, Math.ceil((autoCQDeadlineMs-autoCQNowMs)/1000))}s</span>}
      </div>{!phone && cw.state.error && <p className="contest-alert is-error">{cw.state.error}</p>}
      <div className="contest-operator-keys">{projection.functionKeys.map(key => <button type="button" key={key.id} disabled={busy || retiring || phoneReleaseBlocking || (phone ? !phoneCanSend : projection.mode !== "CW" && !fldigiPanelReady)} className={key.highlighted ? "contest-primary" : undefined} onClick={() => void hostAction("contest_function_key", { key: key.id })}>{key.id}</button>)}</div>
    </section>;
  };
  const directDupeKey=projection?`${projection.draftID}|${(fields.callsign??"").trim().toUpperCase()}|${operationFrequencyHz}|${projection.mode}`:"";
  const directAuthorityDupe=configuredClient&&authorityClientReady&&authorityDupe?.key===directDupeKey?authorityDupe:null;
  const entryPanel: ReactNode = projection && <form className="contest-entry" aria-label={`${projection.pluginName ?? projection.pluginID} entry`} onSubmit={event => { event.preventDefault(); void commitEntry().catch(cause=>setError(errorMessage(cause))); }} onKeyDown={keyDown}>
    <header><div><h2><Radio size={15}/> {projection.pluginName ?? projection.pluginID} · Not1MM</h2><p>Actual pinned Python plugin · {projection.run ? "Run" : "Search & Pounce"}</p></div><span>{busy ? "Working…" : "Ready"}</span></header>
    <ContestEntryFields callsign={visibleFields.slice(0, 1).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} className="contest-call" autoComplete="off" data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } reports={visibleFields.slice(1, 3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value)}/>) } exchange={visibleFields.slice(3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } />
    <div className="contest-entry-context"><div><span>Frequency</span>{observedFrequencyHz !== null
      ? <strong>{(observedFrequencyHz / 1e6).toFixed(6)} MHz · radio observed</strong>
      : <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
          value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)} onBlur={syncManualFrequency}/>}</div><div><span>Band / mode</span><strong>{bandLabels[String(projection.band)] ?? projection.band} · {projection.mode}</strong></div><div><span>Operating style</span><button type="button" disabled={busy || retiring} onClick={() => void runMutation(base => mutate("contest_run_state", base, { run: !base.run }), false)}>{projection.run ? "Run" : "S&P"}</button></div></div>
    <div className={`contest-validation ${(configuredClient?directAuthorityDupe?.isDupe:projection.dupe) ? "is-duplicate" : "is-clear"}`}>
      <strong>{configuredClient?!directAuthorityDupe?"Authority dupe check pending":directAuthorityDupe.isDupe?"Duplicate":"Dupe check":projection.dupe?"Duplicate":"Dupe check"}</strong>
      <span>{projection.countryResolved ? "Country resolved by xLog CTY data." : "Unknown country is retained; scoring credit may be zero."}</span></div>
    {cwPanel()}
    <footer><button type="button" disabled={busy || retiring || phoneReleaseBlocking || Boolean(projection.fldigiTransmitAvailable && !fldigiPanelReady)} onClick={() => void hostAction("contest_esm", { field: focusRef.current })}>Enter / ESM</button><button className="contest-primary" type="submit" disabled={busy || retiring}>Log Now</button></footer>
  </form>;
  const scorePanel = <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score</h2><ContestScoreSummary score={scoreView}/></aside>;
  const checkPanel = <section className="contest-score" aria-label="Check Partial"><h2>Check Partial</h2>{projection && <ContestAssistancePanel
    request={request as ContestRequest} ownerLeaseID={0} sessionID={projection.sessionID} workspaceGeneration={projection.workspaceGeneration}
    draftID={projection.draftID} callsign={fields.callsign ?? ""} disabled={busy || retiring}
    onSelect={applyAssistanceCallsign} onSurfaceChange={setSCPSurface}/>}<p className="contest-source">{projection?.history || "Type a call to query Not1MM call history."}</p><p>{projection?.dupe
      ? projection.dupeExplanation ?? "Worked in this contest" : projection?.countryResolved ? "Country resolved · not a duplicate" : "No country match yet"}</p></section>;
  const matrixPanel = <section className="contest-score" aria-label="Country and zone matrices"><h2>Countries / zones</h2><div className="contest-multipliers">{[...(matrices.countries ?? []), ...(matrices.zones ?? [])].map((item: Data, index: number) => <span key={`${item.value}-${item.band}-${index}`}>{item.value || "Unknown"} · {bandLabels[String(item.band)] ?? item.band} · {item.qsos}</span>)}</div></section>;
  const renderedPluginMetadata = pluginContactMetadataColumns(projection?.fields ?? []);
  const logPanel = <section className="contest-log"><header><div><h2><BookOpen size={15}/> Contest log</h2><p>{logTotal} contacts in the Python-owned DXLOG store.</p></div><div className="contest-log-actions"><button type="button" disabled={busy} onClick={() => void exportLog("cabrillo")}><Download size={14}/>Cabrillo</button><button type="button" disabled={busy} onClick={() => void exportLog("adif")}><Download size={14}/>ADIF</button>{projection?.exportFormats?.includes("edi")&&<button type="button" disabled={busy} onClick={() => void exportLog("edi")}><Download size={14}/>EDI</button>}<button type="button" disabled={busy} onClick={() => void runMutation(base => mutate("contest_recalculate", base))}>Recalculate</button></div></header>{editing && <form className="contest-qso-editor" onSubmit={correct}><h2>Edit {editing.Call}</h2><div className="contest-qso-fields"><ContestTextField label="Callsign" value={editCall} onChange={event => setEditCall(event.target.value.toUpperCase())}/><ContestTextField label="UTC timestamp" value={editTimestamp} onChange={event => setEditTimestamp(event.target.value)}/><ContestTextField label="Frequency MHz" inputMode="decimal" value={editFrequencyMHz} onChange={event => setEditFrequencyMHz(event.target.value)}/><ContestTextField label="Operator" value={editOperator} onChange={event => setEditOperator(event.target.value.toUpperCase())}/><ContestTextField label="Sent report" value={editSent} onChange={event => setEditSent(event.target.value)}/><ContestTextField label="Received report" value={editReceived} onChange={event => setEditReceived(event.target.value)}/><ContestTextField label={projection?.fields.find(field => field.id === "other_1")?.label || "Sent exchange"} inputMode="numeric" value={editSentExchange} onChange={event => setEditSentExchange(event.target.value)}/><ContestTextField label={projection?.fields.find(field => field.id === "other_2")?.label || "Received exchange"} value={editZone} onChange={event => setEditZone(event.target.value)}/>{!renderedPluginMetadata.has("Name")&&<ContestTextField label="Name" value={editName} onChange={event => setEditName(event.target.value)}/>} {!renderedPluginMetadata.has("QTH")&&<ContestTextField label="QTH" value={editQTH} onChange={event => setEditQTH(event.target.value)}/>} {!renderedPluginMetadata.has("Comment")&&<ContestTextField label="Comment" value={editComment} onChange={event => setEditComment(event.target.value)}/>}</div><footer><button className="contest-danger" type="button" onClick={remove}>Delete</button><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="contest-primary" type="submit">Save correction</button></footer></form>}<ContestLogTable rows={logRows(rows, projection?.pluginID, bandLabels)} disabled={busy || retiring} onEdit={beginEdit}/><footer><button type="button" disabled={busy || logOffset === 0} onClick={() => void loadLogPage(Math.max(0, logOffset - logPageSize))}>Newer</button><span>{logTotal ? `${logOffset + 1}–${logOffset + rows.length} of ${logTotal}` : "No contacts"}</span><button type="button" disabled={busy || logOffset + rows.length >= logTotal} onClick={() => void loadLogPage(logOffset + logPageSize)}>Older</button></footer></section>;
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
    {startupPending && <p className="contest-alert" role="status">Loading contest types…</p>}
    {catalogLoadError && <p className="contest-alert is-error" role="alert">{catalogLoadError}<button type="button" onClick={() => setCatalogLoadAttempt(attempt => attempt + 1)}>Retry</button></p>}
    {notice && <p className="contest-alert" role="status">{notice}</p>}
    {showSetup && <div className="contest-entry-context">
      <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
        value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)}/>
    </div>}
    {showSetup ? <ContestSetupPanel value={setup} effectiveMacros={effectiveMacros} sessions={sessions} activeSessionID={projection?.sessionID}
      catalog={setupCatalog} busy={busy || retiring} newContestDisabled={!catalogReady}
      onSave={saveSetup} onCreate={createSession} onOpen={session => openSession(session as Session)} onOpenSettings={openContestSetupService}
      onOpenDialog={setupOnly ? openContestSetupDialog : undefined} onViewChange={onSetupViewChange}
      onOpenCallHistory={() => { if (!surfaceContext) { setError("Open a contest before opening Call History."); return; }
        if (!setupOnly) setManager(false); void openContestCallHistoryWindow(surfaceContext); }}/>
      : projection ? <><section className="contest-snapshot" aria-label="Contest identity"><div><span>Station</span><strong>{stationCall}</strong></div><div><span>Engine</span><strong>Not1MM Python</strong></div><div><span>Plugin</span><strong>{projection.pluginID}</strong></div><div><span>Revision</span><strong>{projection.revision}</strong></div><div><span>Source</span><small>{projection.sourceRevision.slice(0, 12)} · {projection.referenceID}</small></div></section>{detachedAvailable
        ? <section className="contest-welcome"><h2>Contest windows are ready</h2><p>Use the Contest menu to open and position Main Logging, Check Partial, Stats, Rates, Score Reporting, Logbook, Band Map, Cluster, Rotator, DXCC, Zone and Remote VFO windows.</p></section>
        : <section className="contest-welcome"><h2>Preserved contest session</h2><p>This session predates detached contest windows for the current xLog workspace. Its Python/SQLite log is preserved; create a current-workspace contest before opening independent windows.</p></section>}</> : <section className="contest-welcome"><h2>Open a contest session</h2></section>}
    <div hidden aria-hidden="true">{checkPanel}</div>
  </main>;
}

export default Not1MMContestWorkspace;
