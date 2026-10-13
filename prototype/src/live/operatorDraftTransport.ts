import { invoke } from "@tauri-apps/api/core";
import { DraftRequestRejected } from "./operatorDraftSession";

const methods = new Set(["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt"]);
/** Preserve the distinction between an explicit worker rejection and lost IPC. */
export async function requestOperatorDraft(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!methods.has(method)) throw new Error("This operation is outside the operator draft service.");
  const request = { id: crypto.randomUUID(), method, params };
  let response;
  try { response = await invoke<any>("worker_request", { request }); }
  catch (cause) {
    // Native dispatcher/transport rejections are often strings. Preserve their
    // useful detail, but never classify an unconfirmed IPC outcome as a
    // definite worker rejection (Save still needs receipt reconciliation).
    throw cause instanceof Error ? cause : new Error(typeof cause === "string" && cause.trim()
      ? cause : "The shared draft transport is unavailable. Check its receipt before retrying a pending action.");
  }
  if (!response || response.id !== request.id || typeof response.ok !== "boolean")
    throw new Error("The draft response could not be correlated. Check its receipt before retrying.");
  if (!response.ok) {
    if (typeof response.error?.message !== "string") throw new Error("The draft error response could not be verified.");
    throw new DraftRequestRejected(response.error.message);
  }
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result))
    throw new Error("The draft service returned an invalid result.");
  return response.result;
}
