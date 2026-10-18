import { DraftRequestRejected } from "./operatorDraftSession";
import { operatingWorkerRequest } from "./operatorDraftTransport";

const methods = new Set(["logbook_contact", "logbook_contact_apply", "logbook_contact_receipt"]);
export async function requestLogbookContact(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!methods.has(method)) throw new Error("This operation is outside the contact editing service.");
  const request = { id: crypto.randomUUID(), method, params };
  const response = await operatingWorkerRequest(request);
  if (!response || response.id !== request.id || typeof response.ok !== "boolean")
    throw new Error("The contact response could not be correlated. Check its receipt before retrying.");
  if (!response.ok) {
    if (typeof response.error?.message !== "string") throw new Error("The contact error response could not be verified.");
    throw new DraftRequestRejected(response.error.message);
  }
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result))
    throw new Error("The contact service returned an invalid result.");
  return response.result;
}
