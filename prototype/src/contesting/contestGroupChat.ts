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
export type ContestGroupAuthorityOperation = "serialReserve" | "dupeInquiry" | "contactApply" | "changes";
export type ContestGroupChatSnapshot = { status: "disabled" | "connected" | "error"; error: string | null; enabled: boolean;
  operator: string; multicastGroup: string; multicastPort: number; messages: ContestGroupChatMessage[]; unverifiedTransportAcknowledgements: string[];
  capabilities: { chat: boolean; contactPublication: boolean; remotePersistenceVerified: boolean; sharedSerial: boolean; duplicateInquiry: boolean; authorityLimitation: string };
  authority: ContestGroupAuthoritySnapshot };
const bytes = (value: string) => new TextEncoder().encode(value).length;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const contextValid = (value: ContestSurfaceContext) => uuid.test(value.operatingContext) && uuid.test(value.sessionID) && uuid.test(value.workspaceGeneration);
const contextKey = (value: ContestSurfaceContext) => `${value.operatingContext}/${value.sessionID}/${value.workspaceGeneration}`;

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
    params: Record<string, unknown>, requestID = crypto.randomUUID()) {
  if (!contextValid(context) || !uuid.test(requestID) || !params || typeof params !== "object" || Array.isArray(params))
    throw new Error("The Group authority request could not be verified.");
  const value = await invoke("contest_group_authority_request", { ...context, request: { requestID, operation, params } });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The Group authority returned an invalid response.");
  return value as Record<string, unknown>;
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
