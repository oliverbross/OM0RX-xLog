import { invoke } from "@tauri-apps/api/core";
import type { ContestSurfaceContext } from "./contestSurfaceNative";

export const maxContestChatBytes = 512;
export type ContestGroupChatConfiguration = { enabled: boolean; multicastGroup: string; multicastPort: number; interface: string; operator: string; stationName: string };
export type ContestGroupChatMessage = { sequence: number; sender: string; message: string; receivedAtMs: number };
export type ContestGroupChatSnapshot = { status: "disabled" | "connected" | "error"; error: string | null; enabled: boolean;
  operator: string; multicastGroup: string; multicastPort: number; messages: ContestGroupChatMessage[]; contactReceipts: string[];
  capabilities: { chat: boolean; contactPublication: boolean; sharedSerial: false; duplicateInquiry: false; authorityLimitation: string } };
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
  const snapshot = value as Record<string, unknown>, messages = snapshot.messages;
  return ["disabled", "connected", "error"].includes(String(snapshot.status)) &&
    (snapshot.error === null || typeof snapshot.error === "string" && bytes(snapshot.error) <= 1024) &&
    typeof snapshot.enabled === "boolean" && typeof snapshot.operator === "string" && bytes(snapshot.operator) <= 32 &&
    typeof snapshot.multicastGroup === "string" && snapshot.multicastGroup.length <= 15 &&
    Number.isInteger(snapshot.multicastPort) && Number(snapshot.multicastPort) >= 1 && Number(snapshot.multicastPort) <= 65535 &&
    Array.isArray(snapshot.contactReceipts) && snapshot.contactReceipts.length <= 500 && snapshot.contactReceipts.every(item => typeof item === "string" && uuid.test(item)) &&
    !!snapshot.capabilities && typeof snapshot.capabilities === "object" && !Array.isArray(snapshot.capabilities) &&
    (snapshot.capabilities as Record<string, unknown>).chat === true && typeof (snapshot.capabilities as Record<string, unknown>).contactPublication === "boolean" &&
    (snapshot.capabilities as Record<string, unknown>).sharedSerial === false && (snapshot.capabilities as Record<string, unknown>).duplicateInquiry === false &&
    typeof (snapshot.capabilities as Record<string, unknown>).authorityLimitation === "string" && bytes(String((snapshot.capabilities as Record<string, unknown>).authorityLimitation)) <= 512 &&
    Array.isArray(messages) && messages.length <= maximumHistory && messages.every(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const message = item as Record<string, unknown>;
      return Number.isSafeInteger(message.sequence) && Number(message.sequence) >= 0 && typeof message.sender === "string" && bytes(message.sender) <= 32 &&
        typeof message.message === "string" && bytes(message.message) <= maxContestChatBytes && Number.isSafeInteger(message.receivedAtMs) && Number(message.receivedAtMs) >= 0;
    });
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
export async function takeContestGroupContactReceipts(context: ContestSurfaceContext) {
  if (!contextValid(context)) throw new Error("The Group network receipt context could not be verified.");
  const value = await invoke("contest_group_network_receipts", { ...context });
  if (!Array.isArray(value) || value.length > 500 || !value.every(item => typeof item === "string" && uuid.test(item)))
    throw new Error("The Group network contact receipts could not be verified.");
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
