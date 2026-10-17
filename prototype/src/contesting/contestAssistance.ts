import { invoke } from "@tauri-apps/api/core";
import type { ContestRequest, ContestWorkerResponse } from "./types";

export type SCPContext = { sessionID: string; workspaceGeneration: string; requestID: string };
export type SCPDataset = { sourceID: string; version: string; retrievedAtUTC: string | null; sha256: string;
  byteCount: number; recordCount: number; duplicateCount: number; digestVerification: "computedOnly" | "matchedExpectedSHA256" };
export type SCPMatch = { matchID: string; callsign: string; score: number; isPrefixMatch: boolean };
export type SCPResult = SCPContext & { normalizedQuery: string; matches: SCPMatch[]; dataset: SCPDataset;
  evaluatedRecordCount: number; isPartial: boolean };
export type SCPStatus = { dataset: SCPDataset | null; unavailableReason: "not_imported" | "invalid_cache" | "replacing" | "stopped" | null };
export type AssistanceRequest = ContestRequest;
type RawRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<ContestWorkerResponse<T>>;
export type SCPImport = () => Promise<unknown | null>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const callsign = /^[A-Z0-9/]{2,32}/;
const lowerDigest = /^[0-9a-f]{64}/;
function full(value:unknown,pattern:RegExp):value is string {
  if(typeof value!=="string")return false;const matched=pattern.exec(value);return matched?.[0]===value;
}
const text = (value: unknown, maximum: number) => typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const uint = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(key => key in value); }
function iso(value: unknown) { return typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function validDataset(value: unknown): value is SCPDataset {
  const v = object(value); return !!v && exact(v, ["sourceID","version","retrievedAtUTC","sha256","byteCount","recordCount","duplicateCount","digestVerification"]) &&
    text(v.sourceID, 256) && text(v.version, 256) && (v.retrievedAtUTC === null || iso(v.retrievedAtUTC)) &&
    full(v.sha256,lowerDigest) && uint(v.byteCount) && Number(v.byteCount) <= 16*1_024*1_024 &&
    uint(v.recordCount) && Number(v.recordCount) <= 100_000 && uint(v.duplicateCount) && Number(v.duplicateCount) <= 100_000 &&
    ["computedOnly","matchedExpectedSHA256"].includes(String(v.digestVerification));
}
function validMatch(value: unknown,dataset:SCPDataset): value is SCPMatch {
  const match=object(value),id=match?.matchID;
  if(!match||!exact(match,["matchID","callsign","score","isPrefixMatch"])||typeof id!=="string")return false;
  const prefix=`${dataset.sha256}:`,ordinalText=id.startsWith(prefix)?id.slice(prefix.length):"";
  const ordinal=full(ordinalText,/^(?:0|[1-9][0-9]{0,5})/)?Number(ordinalText):NaN;
  return Number.isSafeInteger(ordinal)&&ordinal>=0&&ordinal<dataset.recordCount&&full(match.callsign,callsign)&&
    typeof match.score==="number"&&Number.isFinite(match.score)&&match.score>=0&&match.score<=100&&typeof match.isPrefixMatch==="boolean";
}
function unwrap(response: unknown): unknown {
  const frame=object(response);
  if(!frame || !text(frame.id,128) || typeof frame.ok!=="boolean")throw new Error("Malformed SCP worker response.");
  if(frame.ok===true){if(!exact(frame,["id","ok","result"]))throw new Error("Malformed SCP worker response.");return frame.result;}
  if(!exact(frame,["id","ok","error"]))throw new Error("Malformed SCP worker response.");
  const error=object(frame.error);
  if(!error || Object.keys(error).some(key=>!["code","message","outcome"].includes(key)) ||
    error.code!==undefined&&!text(error.code,128) || error.message!==undefined&&!text(error.message,512) ||
    error.outcome!==undefined&&!['confirmed','uncertain'].includes(String(error.outcome)))throw new Error("Malformed SCP worker response.");
  throw new Error(typeof error.message==="string"?error.message:"Callsign assistance is unavailable.");
}
export function validateSCPImportResponse(response: unknown): SCPDataset {
  const value=object(unwrap(response));
  if(!value||!exact(value,["dataset"])||!validDataset(value.dataset))throw new Error("Malformed SCP import response.");
  return value.dataset;
}
export async function scpStatus(request: AssistanceRequest): Promise<SCPStatus> {
  const value = object(unwrap(await (request as RawRequest)<SCPStatus>("contest_scp_status", {})));
  const reasons=["not_imported","invalid_cache","replacing","stopped"];
  if (!value || !exact(value, ["dataset","unavailableReason"]) || value.dataset !== null && !validDataset(value.dataset) ||
      value.unavailableReason!==null&&!reasons.includes(String(value.unavailableReason)) || value.dataset!==null&&value.unavailableReason!==null)
    throw new Error("Malformed SCP status response.");
  return value as SCPStatus;
}
export async function scpQuery(request: AssistanceRequest, context: SCPContext, query: string): Promise<SCPResult> {
  const normalized=query.toUpperCase();
  if(!full(normalized,callsign)||![context.sessionID,context.workspaceGeneration,context.requestID].every(value=>full(value,uuid)))throw new Error("Invalid SCP query context.");
  const value = object(unwrap(await (request as RawRequest)<SCPResult>("contest_scp_query", {...context, query})));
  if (!value || !exact(value, ["sessionID","workspaceGeneration","requestID","normalizedQuery","matches","dataset","evaluatedRecordCount","isPartial"]) ||
      value.sessionID !== context.sessionID || value.workspaceGeneration !== context.workspaceGeneration || value.requestID !== context.requestID ||
      value.normalizedQuery !== normalized || !validDataset(value.dataset) || !uint(value.evaluatedRecordCount) || Number(value.evaluatedRecordCount)>100_000 ||
      typeof value.isPartial !== "boolean" || !Array.isArray(value.matches) || value.matches.length > 20 ||
      !value.matches.every(item=>validMatch(item,value.dataset as SCPDataset)) ||
      new Set((value.matches as SCPMatch[]).map(match=>match.matchID)).size!==(value.matches as SCPMatch[]).length ||
      new Set((value.matches as SCPMatch[]).map(match=>match.callsign)).size!==(value.matches as SCPMatch[]).length)
    throw new Error("Malformed or stale SCP query response.");
  return value as unknown as SCPResult;
}
export async function scpCancel(request: AssistanceRequest, context: SCPContext) {
  await (request as RawRequest)("contest_scp_cancel", context).catch(() => undefined);
}
export async function scpSelect(request: AssistanceRequest, context: SCPContext, match: SCPMatch): Promise<string> {
  const value = object(unwrap(await (request as RawRequest)<{callsign:string}>("contest_scp_select", {...context, matchID:match.matchID})));
  if (!value || !exact(value,["callsign"]) || value.callsign!==match.callsign || !full(value.callsign,callsign)) throw new Error("Malformed SCP selection response.");
  return value.callsign as string;
}
export const nativeSCPImport: SCPImport = () => invoke("contest_scp_import");
