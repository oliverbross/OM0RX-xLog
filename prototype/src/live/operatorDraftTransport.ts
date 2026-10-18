import { invoke } from "@tauri-apps/api/core";
import { DraftRequestRejected } from "./operatorDraftSession";

const methods = new Set(["logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt"]);
export async function operatingWorkerRequest(request: { id: string; method: string; params: Record<string, unknown> }) {
  const operating = await invoke<{ context: string }>("operating_module_status");
  return invoke<any>("worker_request", { request: { ...request, operatingContext: operating.context } });
}
/** Preserve the distinction between an explicit worker rejection and lost IPC. */
export async function requestOperatorDraft(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!methods.has(method)) throw new Error("Unsupported draft method.");
  const request = { id: crypto.randomUUID(), method, params };
  let response;
  try { response = await operatingWorkerRequest(request); }
  catch (cause) {
    // Native dispatcher/transport rejections are often strings. Preserve their
    // useful detail, but never classify an unconfirmed IPC outcome as a
    // definite worker rejection (Save still needs receipt reconciliation).
    throw cause instanceof Error ? cause : new Error(typeof cause === "string" && cause.trim()
      ? cause : "Draft transport unavailable; inspect receipt.");
  }
  if (!response || response.id !== request.id || typeof response.ok !== "boolean")
    throw new Error("Draft response mismatch; inspect receipt.");
  if (!response.ok) {
    if (typeof response.error?.message !== "string") throw new Error("Unverified draft error response.");
    throw new DraftRequestRejected(response.error.message);
  }
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result))
    throw new Error("Invalid draft result.");
  return response.result;
}
