import { beforeEach, expect, it, vi } from "vitest";
import { requestLogbookContact } from "./logbookContactTransport";
import { DraftRequestRejected } from "./operatorDraftSession";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => { native.invoke.mockReset(); });
it("only permits contact operations and checks response correlation", async () => {
  native.invoke.mockImplementation(async (_method, { request }) => ({ id: request.id, ok: true, result: { contact: null } }));
  expect(await requestLogbookContact("logbook_contact")).toEqual({ contact: null });
  await expect(requestLogbookContact("logbook_save")).rejects.toThrow("outside");
  await expect(requestLogbookContact("station_tune")).rejects.toThrow("outside");
  expect(native.invoke).toHaveBeenCalledOnce();
  native.invoke.mockResolvedValue({ id: "wrong", ok: false, error: { message: "invalid" } });
  await expect(requestLogbookContact("logbook_contact_apply")).rejects.toThrow("correlated");
});
it("distinguishes explicit worker rejection from transport failure", async () => {
  native.invoke.mockImplementation(async (_method, { request }) => ({ id: request.id, ok: false, error: { message: "invalid" } }));
  await expect(requestLogbookContact("logbook_contact_apply")).rejects.toBeInstanceOf(DraftRequestRejected);
  native.invoke.mockRejectedValue(new Error("IPC lost"));
  try { await requestLogbookContact("logbook_contact_apply"); throw new Error("expected failure"); }
  catch (error) { expect(error).not.toBeInstanceOf(DraftRequestRejected); expect(String(error)).toContain("IPC lost"); }
});
