import { invoke } from "@tauri-apps/api/core";
import type { ContestSurfaceContext } from "./contestSurfaceNative";

export const maxContestChatBytes = 512;
export type ContestGroupChatConfiguration = { enabled: boolean; multicastGroup: string; multicastPort: number; interface: string; operator: string; stationName: string; multiMaster: boolean; contestIdentity: string };
export type ContestGroupChatMessage = { sequence: number; sender: string; message: string; receivedAtMs: number };
export type ContestGroupAuthoritySnapshot = {
  role: "disabled" | "master" | "client";
  status: "disabled" | "leasing" | "discovering" | "connected" | "lease_lost" | "lease_conflict" | "revoked";
  masterStation: string | null; sessionID: string | null; workspaceGeneration: string | null;
  leaseExpiresAtMs: number | null; reconnectCursor: number;
};
export type ContestGroupAuthorityOperation = "serialReserve" | "dupeInquiry" | "contactApply" | "changes" | "coordination";
export type ContestGroupCoordination = ContestGroupAuthorityResult & { senderStation:string;observedUTC:string;
  peers:{station:string;operator:string;role:string;band:string;mode:string;laneID:string;cursor:number;queue:number;context:string;confirmedUTC:string}[];
  directed:{id:string;sender:string;target:string;kind:string;body:string;call:string;frequencyHz:number;mode:string;laneID:string;createdUTC:string;acknowledgedUTC:string|null}[] };
export type ContestGroupAuthorityIdentity = { sessionID:string; workspaceGeneration:string; pluginID:string; sourceRevision:string; referenceID:string; coordinationDigest:string };
export type ContestGroupReplicaCursor = { revision:number; sequence:number };
export type ContestGroupAuthorityResult = Record<string, unknown> & { requestID:string; authority:ContestGroupAuthorityIdentity };
export type ContestGroupReplicaSyncRequest={operationID:string;changesRequestID:string;expectedRevision:number;
  fromCursor:ContestGroupReplicaCursor;limit:number;draftID?:string;authoredQSOID?:string;
  serialReservation?:{requestID:string;frequencyHz:number}};
export type ContestGroupReplicaSyncResult={apply:{id:string;ok:true;result:Record<string,unknown>};hasMore:boolean;authoredApplied:boolean};
export type ContestGroupChatSnapshot = { status: "disabled" | "connected" | "error"; error: string | null; enabled: boolean;
  operator: string; multicastGroup: string; multicastPort: number; messages: ContestGroupChatMessage[]; unverifiedTransportAcknowledgements: string[];
  capabilities: { chat: boolean; contactPublication: boolean; remotePersistenceVerified: boolean; sharedSerial: boolean; duplicateInquiry: boolean; authorityLimitation: string };
  authority: ContestGroupAuthoritySnapshot };
const bytes = (value: string) => new TextEncoder().encode(value).length;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const contextValid = (value: ContestSurfaceContext) => uuid.test(value.operatingContext) && uuid.test(value.sessionID) && uuid.test(value.workspaceGeneration);
const contextKey = (value: ContestSurfaceContext) => `${value.operatingContext}/${value.sessionID}/${value.workspaceGeneration}`;
const uint = (value:unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const exact = (value:Record<string,unknown>, keys:string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
function validAuthority(value:unknown): value is ContestGroupAuthorityIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item=value as Record<string,unknown>;
  return exact(item,["sessionID","workspaceGeneration","pluginID","sourceRevision","referenceID","coordinationDigest"]) &&
    uuid.test(String(item.sessionID)) && uuid.test(String(item.workspaceGeneration)) &&
    [item.pluginID,item.sourceRevision,item.referenceID].every(part=>typeof part==="string"&&bytes(part)<=256) &&
    typeof item.coordinationDigest==="string" && /^[0-9a-f]{64}$/.test(item.coordinationDigest);
}
function validAuthorityResult(operation:ContestGroupAuthorityOperation, value:unknown, requestID:string): value is ContestGroupAuthorityResult {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  if(item.requestID!==requestID||!validAuthority(item.authority)||!uint(item.revision)||typeof item.replayed!=="boolean")return false;
  if(operation==="serialReserve")return uint(item.serial)&&typeof item.scope==="string"&&typeof item.sentExchange==="string"&&
    (item.allocatedFieldID===null||typeof item.allocatedFieldID==="string");
  if(operation==="dupeInquiry")return typeof item.isDupe==="boolean"&&typeof item.call==="string"&&typeof item.mode==="string"&&
    typeof item.timestamp==="string"&&typeof item.band==="string";
  if(operation==="contactApply")return uuid.test(String(item.qsoID))&&["commit","correct","delete"].includes(String(item.action))&&uint(item.changeRevision);
  if(operation==="coordination")return typeof item.senderStation==="string"&&typeof item.observedUTC==="string"&&item.draftMutation===false&&item.outputArmed===false&&item.offlineSerialGuarantee===false&&
    Array.isArray(item.peers)&&item.peers.length<=64&&item.peers.every(peer=>!!peer&&typeof peer==="object"&&["station","operator","role","band","mode","laneID","context","confirmedUTC"].every(key=>typeof peer[key]==="string"&&bytes(peer[key])<=128)&&uint(peer.cursor)&&uint(peer.queue))&&
    Array.isArray(item.directed)&&item.directed.length<=100&&item.directed.every(message=>!!message&&typeof message==="object"&&uuid.test(message.id)&&["sender","target","kind","body","call","mode","laneID","createdUTC"].every(key=>typeof message[key]==="string"&&bytes(message[key])<=512)&&uint(message.frequencyHz)&&(message.acknowledgedUTC===null||typeof message.acknowledgedUTC==="string"));
  if(!uint(item.afterRevision)||!uint(item.afterSequence)||!uint(item.currentRevision)||!uint(item.nextRevision)||!uint(item.nextSequence)||
      typeof item.hasMore!=="boolean"||!Array.isArray(item.changes)||item.changes.length>100)return false;
  return item.changes.every(raw=>{if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;const change=raw as Record<string,unknown>;
    return exact(change,["sequence","revision","requestID","qsoID","kind","before","after","reason","beforeIdentity","afterIdentity"])&&
      uint(change.sequence)&&uint(change.revision)&&uuid.test(String(change.requestID))&&uuid.test(String(change.qsoID))&&
      ["commit","correct","delete"].includes(String(change.kind))&&typeof change.reason==="string"&&
      (change.before===null||typeof change.before==="object"&&!Array.isArray(change.before))&&
      (change.after===null||typeof change.after==="object"&&!Array.isArray(change.after))&&
      (change.beforeIdentity===null||typeof change.beforeIdentity==="object"&&!Array.isArray(change.beforeIdentity))&&
      !!change.afterIdentity&&typeof change.afterIdentity==="object"&&!Array.isArray(change.afterIdentity);});
}

export function contestGroupChatContextFromSearch(search: string): ContestSurfaceContext {
  const query = new URLSearchParams(search), one = (key: string) => query.getAll(key).length === 1 ? query.get(key) : null;
  const context = { operatingContext: one("operatingContext") ?? "", sessionID: one("sessionID") ?? "", workspaceGeneration: one("workspaceGeneration") ?? "" };
  if (one("scope") !== "contesting" || one("view") !== "group-chat" || !contextValid(context))
    throw new Error("This Group Chat window context could not be verified.");
  return context;
}

function validSnapshot(value: unknown, maximumHistory = 200): value is ContestGroupChatSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>, messages = snapshot.messages,
    authority = snapshot.authority as Record<string, unknown> | undefined;
  return ["disabled", "connected", "error"].includes(String(snapshot.status)) &&
    (snapshot.error === null || typeof snapshot.error === "string" && bytes(snapshot.error) <= 1024) &&
    typeof snapshot.enabled === "boolean" && typeof snapshot.operator === "string" && bytes(snapshot.operator) <= 32 &&
    typeof snapshot.multicastGroup === "string" && snapshot.multicastGroup.length <= 15 &&
    Number.isInteger(snapshot.multicastPort) && Number(snapshot.multicastPort) >= 1 && Number(snapshot.multicastPort) <= 65535 &&
    Array.isArray(snapshot.unverifiedTransportAcknowledgements) && snapshot.unverifiedTransportAcknowledgements.length <= 500 && snapshot.unverifiedTransportAcknowledgements.every(item => typeof item === "string" && uuid.test(item)) &&
    !!snapshot.capabilities && typeof snapshot.capabilities === "object" && !Array.isArray(snapshot.capabilities) &&
    (snapshot.capabilities as Record<string, unknown>).chat === true && typeof (snapshot.capabilities as Record<string, unknown>).contactPublication === "boolean" &&
    typeof (snapshot.capabilities as Record<string, unknown>).remotePersistenceVerified === "boolean" &&
    typeof (snapshot.capabilities as Record<string, unknown>).sharedSerial === "boolean" && typeof (snapshot.capabilities as Record<string, unknown>).duplicateInquiry === "boolean" &&
    typeof (snapshot.capabilities as Record<string, unknown>).authorityLimitation === "string" && bytes(String((snapshot.capabilities as Record<string, unknown>).authorityLimitation)) <= 512 &&
    !!authority && ["disabled", "master", "client"].includes(String(authority.role)) &&
    ["disabled", "leasing", "discovering", "connected", "lease_lost", "lease_conflict", "revoked"].includes(String(authority.status)) &&
    (authority.masterStation === null || typeof authority.masterStation === "string" && bytes(authority.masterStation) <= 64) &&
    (authority.sessionID === null || typeof authority.sessionID === "string" && uuid.test(authority.sessionID)) &&
    (authority.workspaceGeneration === null || typeof authority.workspaceGeneration === "string" && uuid.test(authority.workspaceGeneration)) &&
    (authority.leaseExpiresAtMs === null || Number.isSafeInteger(authority.leaseExpiresAtMs) && Number(authority.leaseExpiresAtMs) >= 0) &&
    Number.isSafeInteger(authority.reconnectCursor) && Number(authority.reconnectCursor) >= 0 &&
    Array.isArray(messages) && messages.length <= maximumHistory && messages.every(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const message = item as Record<string, unknown>;
      return Number.isSafeInteger(message.sequence) && Number(message.sequence) >= 0 && typeof message.sender === "string" && bytes(message.sender) <= 32 &&
        typeof message.message === "string" && bytes(message.message) <= maxContestChatBytes && Number.isSafeInteger(message.receivedAtMs) && Number(message.receivedAtMs) >= 0;
    });
}

export async function requestContestGroupAuthority(context: ContestSurfaceContext, operation: ContestGroupAuthorityOperation,
    params: Record<string, unknown>, requestID:string = crypto.randomUUID()) {
  if (!contextValid(context) || !uuid.test(requestID) || !params || typeof params !== "object" || Array.isArray(params))
    throw new Error("The Group authority request could not be verified.");
  const value = await invoke("contest_group_authority_request", { ...context, request: { requestID, operation, params } });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The Group authority returned an invalid response.");
  const envelope=value as Record<string,unknown>;
  if(envelope.id!==requestID||envelope.ok!==true||!validAuthorityResult(operation,envelope.result,requestID))
    throw new Error("The Group authority returned an invalid or mismatched response.");
  return envelope.result as ContestGroupAuthorityResult;
}
export async function syncContestGroupReplicaPage(context:ContestSurfaceContext,request:ContestGroupReplicaSyncRequest){
  const paired=(request.draftID===undefined)===(request.authoredQSOID===undefined);
  if(!contextValid(context)||!uuid.test(request.operationID)||!uuid.test(request.changesRequestID)||!uint(request.expectedRevision)||
      !uint(request.fromCursor.revision)||!uint(request.fromCursor.sequence)||!Number.isInteger(request.limit)||request.limit<1||request.limit>25||!paired||
      (request.draftID!==undefined&&(!uuid.test(request.draftID)||!uuid.test(request.authoredQSOID!)))||
      (request.serialReservation!==undefined&&(!uuid.test(request.serialReservation.requestID)||!uint(request.serialReservation.frequencyHz)||request.serialReservation.frequencyHz===0)))
    throw new Error("The native replica synchronisation request could not be verified.");
  const value=await invoke("contest_group_replica_sync_page",{...context,request});
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("The native replica synchronisation response is invalid.");
  const response=value as Record<string,unknown>,apply=response.apply as Record<string,unknown>|undefined;
  if(typeof response.hasMore!=="boolean"||typeof response.authoredApplied!=="boolean"||!apply||apply.id!==request.operationID||apply.ok!==true||!apply.result||typeof apply.result!=="object"||Array.isArray(apply.result))
    throw new Error("The native replica synchronisation response is mismatched.");
  return response as ContestGroupReplicaSyncResult;
}

export async function configureContestGroupChat(context: ContestSurfaceContext, configuration: ContestGroupChatConfiguration) {
  if (!contextValid(context)) throw new Error("The Group Chat owner context could not be verified.");
  const value = await invoke("contest_group_chat_configure", { ...context, configuration });
  if (!validSnapshot(value)) throw new Error("The Group Chat state could not be verified.");
  return value;
}
export async function readContestGroupChat(context: ContestSurfaceContext) {
  if (!contextValid(context)) throw new Error("The Group Chat context could not be verified.");
  const value = await invoke("contest_group_chat_snapshot", { ...context });
  if (!validSnapshot(value)) throw new Error("The Group Chat state could not be verified.");
  return value;
}
export async function sendContestGroupChat(context: ContestSurfaceContext, message: string) {
  if (!contextValid(context) || bytes(message) > maxContestChatBytes || message.includes("\0"))
    throw new Error("The chat message is invalid or too long.");
  await invoke("contest_group_chat_send", { ...context, message });
}
export async function readContestGroupNetwork(context: ContestSurfaceContext) {
  if (!contextValid(context)) throw new Error("The Group network context could not be verified.");
  const value = await invoke("contest_group_network_snapshot", { ...context });
  if (!validSnapshot(value)) throw new Error("The Group network state could not be verified.");
  return value;
}
export async function publishContestGroupContact(context: ContestSurfaceContext, contact: Record<string, unknown>) {
  if (!contextValid(context) || !contact || typeof contact !== "object" || Array.isArray(contact))
    throw new Error("The contest contact publication is invalid.");
  await invoke("contest_group_network_publish", { ...context, contact });
}
export async function takeContestGroupUnverifiedAcknowledgements(context: ContestSurfaceContext) {
  if (!contextValid(context)) throw new Error("The Group network acknowledgement context could not be verified.");
  const value = await invoke("contest_group_network_acknowledgements", { ...context });
  if (!Array.isArray(value) || value.length > 500 || !value.every(item => typeof item === "string" && uuid.test(item)))
    throw new Error("The Group network transport acknowledgements could not be verified.");
  return value as string[];
}
export async function openContestGroupChatWindow(context: ContestSurfaceContext) {
  if (!contextValid(context)) throw new Error("The Group Chat window context could not be verified.");
  await invoke("contest_window_open", { ...context, panelID: "group-chat" });
}
export const contestGroupChatOwnerKey = contextKey;
export function contestChatMentionsOperator(message: string, operator: string) {
  return !!operator.trim() && message.toLocaleUpperCase().includes(operator.trim().toLocaleUpperCase());
}
