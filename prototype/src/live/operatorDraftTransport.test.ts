import { beforeEach, expect, it, vi } from "vitest";
import { DraftRequestRejected } from "./operatorDraftSession";
import { requestOperatorDraft } from "./operatorDraftTransport";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => { native.invoke.mockReset(); });
const status = { selected: "normal_logging", context: "normal-context", transitioning: false };
function respond(result: (request: any) => any) {
  native.invoke.mockImplementation(async (method, args) => method === "operating_module_status" ? status : result(args.request));
}

it("only routes draft operations and correlates their native response", async () => {
  respond(request => ({ id: request.id, ok: true, result: { draft: {} } }));
  expect(await requestOperatorDraft("logbook_operator_draft")).toEqual({ draft: {} });
  await expect(requestOperatorDraft("station_tune")).rejects.toThrow("Unsupported");
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(native.invoke).toHaveBeenLastCalledWith("worker_request", { request: expect.objectContaining({ method: "logbook_operator_draft", operatingContext: "normal-context" }) });
});
it("does not classify mismatched or lost responses as definite worker rejection", async () => {
  respond(() => ({ id: "someone-else", ok: false, error: { message: "invalid" } }));
  try { await requestOperatorDraft("logbook_operator_draft_apply"); throw new Error("expected failure"); }
  catch (error) { expect(error).not.toBeInstanceOf(DraftRequestRejected); expect(String(error)).toContain("mismatch"); }
  native.invoke.mockImplementation(async method => { if (method === "operating_module_status") return status; throw new Error("IPC closed"); });
  await expect(requestOperatorDraft("logbook_operator_draft_apply")).rejects.toThrow("IPC closed");
  expect(native.invoke).toHaveBeenCalledTimes(4);
});
it("preserves explicit worker rejection for receipt-first reconciliation", async () => {
  respond(request => ({ id: request.id, ok: false, error: { message: "Invalid draft" } }));
  await expect(requestOperatorDraft("logbook_operator_draft_apply")).rejects.toBeInstanceOf(DraftRequestRejected);
  expect(native.invoke).toHaveBeenCalledTimes(2);
});
it("preserves native string error detail without treating lost IPC as definite rejection", async () => {
  native.invoke.mockImplementation(async method => { if (method === "operating_module_status") return status; throw "Prototype worker is busy; try again"; });
  try { await requestOperatorDraft("logbook_operator_draft_apply"); throw new Error("expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(DraftRequestRejected);
    expect((error as Error).message).toBe("Prototype worker is busy; try again");
  }
  native.invoke.mockImplementation(async method => { if (method === "operating_module_status") return status; throw { unknown: true }; });
  await expect(requestOperatorDraft("logbook_operator_draft")).rejects.toThrow("transport unavailable");
});
