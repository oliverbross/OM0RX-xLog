import { expect, it, vi } from "vitest";
import { contactEditFixture } from "../../tests/contact-edit-fixture";
import { LogbookMutationSession, readLogbookMutationJournal, type LogbookMutationJournal } from "./logbookMutationSession";
import { DraftRequestRejected } from "./operatorDraftSession";
function fixture() {
  const backend = contactEditFixture({ id: "contact", call: "K1ABC", band: "20m", mode: "CW" });
  const request = vi.fn(async (method: string, params: any = {}) => backend.request(method, params));
  let journal: LogbookMutationJournal | null = null;
  const write = vi.fn((value: LogbookMutationJournal) => { journal = structuredClone(value); });
  const make = (value: LogbookMutationJournal | null = null) => new LogbookMutationSession(request, write, value);
  return { backend, request, write, make, get journal() { return journal; } };
}
it("requires a checked snapshot, then preserves the exact deletion revision for Undo", async () => {
  const f = fixture(), session = f.make();
  const snapshot = await session.prepareDelete("contact"); expect(f.backend.updates).toBe(0);
  await session.delete(snapshot); expect(f.backend.contact.qso.deletedAt).toBeTruthy();
  const restored = f.make(readLogbookMutationJournal(JSON.stringify(f.journal)));
  await restored.undo(); expect(f.backend.contact.qso.deletedAt).toBeNull();
  const writes = f.request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(writes.map(([, p]) => [p.action, p.expectedRevision])).toEqual([["delete", 1], ["restore", 2]]);
  expect(restored.getSnapshot().undo).toBeNull();
});
it("does not delete a contact changed after confirmation was prepared", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.backend.contact.revision++; await session.delete(snapshot);
  expect(session.getSnapshot()).toMatchObject({ pending: null, conflict: true, undo: null });
  expect(f.backend.updates).toBe(0);
  expect(() => session.delete(snapshot)).toThrow("Resolve"); session.dismiss();
});
it("Undo cannot restore a contact changed after this deletion", async () => {
  const f = fixture(), session = f.make(); await session.delete(await session.prepareDelete("contact"));
  f.backend.contact.revision++; await session.undo();
  expect(f.backend.updates).toBe(1); expect(session.getSnapshot()).toMatchObject({ conflict: true, undo: null });
});
it("recovers a lost deletion acknowledgement after restart without repeating the deletion", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params); if (method === "logbook_contact_apply") throw new Error("lost ack"); return result;
  });
  await expect(session.delete(snapshot)).rejects.toThrow("lost ack");
  const recovered = f.make(f.journal); await recovered.reconcile();
  expect(f.backend.updates).toBe(1); expect(recovered.getSnapshot().pending).toBeNull();
  expect(recovered.getSnapshot().undo?.qso.deletedAt).toBeTruthy();
});
it("retries only the original undelivered operation and prevents concurrent new writes", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.request.mockRejectedValueOnce(new Error("offline")); await expect(session.delete(snapshot)).rejects.toThrow();
  expect(() => session.delete(snapshot)).toThrow("Resolve"); expect(() => session.dismiss()).toThrow("pending");
  await session.reconcile(); const pending = structuredClone(session.getSnapshot().pending);
  const first = session.retry(), second = session.retry(); expect(first).toBe(second); await first;
  const writes = f.request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(writes.map(([, p]) => p)).toEqual([pending, pending]); expect(f.backend.updates).toBe(1);
});
it("checks receipts after a definite post-commit error", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params); if (method === "logbook_contact_apply") throw new DraftRequestRejected("refresh failed"); return result;
  });
  expect((await session.delete(snapshot))?.qso.deletedAt).toBeTruthy(); expect(f.backend.updates).toBe(1);
});
it("retains an unresolved operation if receipt verification fails", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params);
    if (result?.receipt) result.receipt.contact.revision++; return result;
  });
  await expect(session.delete(snapshot)).rejects.toThrow("verified");
  expect(session.getSnapshot().pending?.action).toBe("delete"); expect(session.getSnapshot().undo).toBeNull();
});
it("does not dispatch when journalling fails and reconciles when clearing a receipt fails", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact"), write = f.write.getMockImplementation()!;
  f.write.mockImplementation(() => { throw new Error("storage full"); });
  expect(() => session.delete(snapshot)).toThrow("storage full"); expect(f.backend.updates).toBe(0);
  f.write.mockImplementation(value => { if (!value.pending) throw new Error("storage full"); write(value); });
  await expect(session.delete(snapshot)).rejects.toThrow("storage full"); expect(session.getSnapshot().pending).not.toBeNull();
  f.write.mockImplementation(write); await session.reconcile(); expect(f.backend.updates).toBe(1);
});
it("invalidates pending deletion and Undo across restored workspaces", async () => {
  const f = fixture(), session = f.make(), snapshot = await session.prepareDelete("contact");
  f.backend.replaceWorkspace(); await session.delete(snapshot);
  expect(session.getSnapshot().workspaceChanged).toBe(true); await expect(session.retry()).rejects.toThrow("Review");
  session.dismiss(); expect(session.getSnapshot().pending).toBeNull(); expect(f.backend.updates).toBe(0);
  await session.delete(await session.prepareDelete("contact")); f.backend.replaceWorkspace(); await session.undo();
  expect(session.getSnapshot().workspaceChanged).toBe(true); expect(f.backend.updates).toBe(1);
});
it("rejects malformed recovery journals", () => {
  expect(readLogbookMutationJournal("invalid")).toBeNull();
  expect(readLogbookMutationJournal(JSON.stringify({ pending: {}, undo: null }))).toBeNull();
});
