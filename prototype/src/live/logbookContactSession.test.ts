import { expect, it, vi } from "vitest";
import { LogbookContactSession, readContactJournal, type ContactJournal } from "./logbookContactSession";
import { DraftRequestRejected } from "./operatorDraftSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";
function fixture() {
  const backend = contactEditFixture({ id: "contact", call: "K1ABC", band: "20m", mode: "CW" });
  const request = vi.fn(async (method: string, params: any = {}) => backend.request(method, params));
  let journal: ContactJournal | null = null;
  const write = vi.fn((value: ContactJournal | null) => { journal = structuredClone(value); });
  const make = (value: ContactJournal | null = null) => new LogbookContactSession(request, write, value);
  return { backend, request, write, make, get journal() { return journal; } };
}
const edit = (session: LogbookContactSession, comment: string) => session.edit({ ...session.getSnapshot().draft!, comment });

it("journals typing without changing the stored contact until explicit Update", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local text");
  expect(f.backend.updates).toBe(0); expect(f.journal?.draft.comment).toBe("Local text");
  const saved = await session.save();
  expect(saved?.comment).toBe("Local text"); expect(f.backend.updates).toBe(1);
  expect(session.getSnapshot().draft).toBeNull(); expect(f.journal).toBeNull();
});
it("deduplicates simultaneous Update and locks editing while it runs", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  const first = session.save(), second = session.save(); expect(first).toBe(second);
  expect(() => edit(session, "More")).toThrow("Wait"); expect(() => session.cancel()).toThrow("pending");
  await first; expect(f.backend.updates).toBe(1);
});
it("recovers an acknowledged-in-database update after restart without replay", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params);
    if (method === "logbook_contact_apply") throw new Error("lost ack");
    return result;
  });
  await expect(session.save()).rejects.toThrow("lost ack");
  const restored = f.make(readContactJournal(JSON.stringify(f.journal))), count = f.request.mock.calls.length;
  await restored.refresh();
  expect(f.backend.updates).toBe(1); expect(restored.getSnapshot().draft).toBeNull();
  expect(f.request.mock.calls.slice(count).map(([method]) => method)).toEqual(["logbook_contact_receipt"]);
});
it("retries undelivered updates with the exact operation identity and payload", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  f.request.mockRejectedValueOnce(new Error("not delivered")); await expect(session.save()).rejects.toThrow();
  const pending = structuredClone(session.getSnapshot().pending);
  await session.reconcile(); expect(session.getSnapshot().pending).toEqual(pending);
  await session.retry();
  const updates = f.request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(updates).toHaveLength(2); expect(updates[0][1]).toEqual(updates[1][1]); expect(f.backend.updates).toBe(1);
});
it("retains conflicting text until the operator explicitly loads the latest contact", async () => {
  const f = fixture(), first = f.make(), second = f.make(); await first.open("contact"); await second.open("contact");
  edit(first, "First"); edit(second, "Second"); await first.save();
  await expect(second.save()).rejects.toThrow("elsewhere");
  expect(second.getSnapshot().draft?.comment).toBe("Second"); expect(second.getSnapshot().conflict).toBe(true);
  await expect(second.save()).rejects.toThrow("Resolve");
  await second.useCurrent(); expect(second.getSnapshot().draft?.comment).toBe("First");
  expect(f.backend.updates).toBe(1);
});
it("keeps local text if the contact was removed, without resurrecting it", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  f.backend.remove(); await session.refresh();
  expect(session.getSnapshot()).toMatchObject({ conflict: true, current: null });
  await expect(session.useCurrent()).rejects.toThrow("removed");
  expect(session.getSnapshot().draft?.comment).toBe("Local");
  session.cancel(); expect(f.backend.updates).toBe(0); expect(f.journal).toBeNull();
});
it("reconciles a definite worker error before deciding whether an update failed", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  f.request.mockRejectedValueOnce(new DraftRequestRejected("Invalid field"));
  await expect(session.save()).rejects.toThrow("Invalid field");
  expect(session.getSnapshot()).toMatchObject({ pending: null, locked: false, error: "Invalid field" });
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params);
    if (method === "logbook_contact_apply") throw new DraftRequestRejected("post-commit failure");
    return result;
  });
  expect((await session.save())?.call).toBe("K1ABC"); expect(f.backend.updates).toBe(1);
});
it("does not dispatch an update if its recovery identity cannot be journalled", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  f.write.mockImplementation(() => { throw new Error("disk full"); });
  await expect(session.save()).rejects.toThrow("disk full");
  expect(f.backend.updates).toBe(0); expect(session.getSnapshot().draft?.comment).toBe("Local");
});
it("retains a committed operation if clearing its recovery journal fails", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  const write = f.write.getMockImplementation()!;
  f.write.mockImplementation(value => { if (!value) throw new Error("disk full"); write(value); });
  await expect(session.save()).rejects.toThrow("disk full");
  expect(session.getSnapshot().pending).not.toBeNull(); expect(f.backend.updates).toBe(1);
  f.write.mockImplementation(write); await session.reconcile();
  expect(session.getSnapshot().draft).toBeNull(); expect(f.backend.updates).toBe(1);
});
it("refuses mismatched receipts and preserves the original recovery operation", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params);
    if (method === "logbook_contact_apply" && result?.receipt) result.receipt.mutation.operationID = "wrong";
    return result;
  });
  await expect(session.save()).rejects.toThrow("verified");
  expect(session.getSnapshot().locked).toBe(true); expect(f.journal?.pending).not.toBeNull();
});
it("ignores reads from before cancelling an edit", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  let resolve!: (value: any) => void;
  f.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const reading = session.refresh(); session.cancel();
  resolve({ contact: { ...f.backend.contact, revision: 5 } }); await reading;
  expect(session.getSnapshot()).toMatchObject({ draft: null, conflict: false });
});
it("accepts equivalent UUID casing in a correlated contact receipt", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  f.request.mockImplementation(async (method, params) => {
    const result = f.backend.request(method, params);
    if (method === "logbook_contact_apply" && result?.receipt) result.receipt.mutation.contactID = params.contactID.toUpperCase();
    return result;
  });
  await session.save(); expect(session.getSnapshot().draft).toBeNull(); expect(f.backend.updates).toBe(1);
});
it("shares slow refresh reads and avoids rewriting unchanged conflict recovery", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  let resolve!: (value: any) => void;
  f.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const count = f.request.mock.calls.length;
  const first = session.refresh(), second = session.refresh();
  expect(f.request.mock.calls.length).toBe(count + 1);
  const generation = f.backend.contact.generation;
  f.backend.remove(); resolve({ contact: null, generation }); await Promise.all([first, second]);
  const writes = f.write.mock.calls.length;
  await session.refresh(); expect(f.write.mock.calls.length).toBe(writes);
});
it("restores unsaved contact text but rejects a mismatched pending journal", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Local");
  const journal = readContactJournal(JSON.stringify(f.journal));
  expect(f.make(journal).getSnapshot().draft?.comment).toBe("Local");
  const extra = readContactJournal(JSON.stringify({ ...journal, conflict: true, current: "invalid" }));
  expect(f.make(extra).getSnapshot()).toMatchObject({ conflict: false, current: null });
  expect(readContactJournal("invalid")).toBeNull();
  expect(readContactJournal(JSON.stringify({ ...journal, pending: { action: "delete" } }))).toBeNull();
});
it("retains an unresolved edit across restore and never replays it into the replacement workspace", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Old workspace text");
  f.request.mockRejectedValueOnce(new Error("lost transport")); await expect(session.save()).rejects.toThrow();
  f.backend.replaceWorkspace(); await session.reconcile();
  expect(session.getSnapshot()).toMatchObject({ workspaceChanged: true, locked: false, draft: { comment: "Old workspace text" } });
  const count = f.request.mock.calls.length;
  await expect(session.retry()).rejects.toThrow("restored"); expect(f.request.mock.calls.length).toBe(count);
  await session.useCurrent(); expect(session.getSnapshot().workspaceChanged).toBe(false);
  edit(session, "Reviewed"); await session.save(); expect(f.backend.updates).toBe(1);
});
it("rejects a stale update even when restore retained the same contact ID and revision", async () => {
  const f = fixture(), session = f.make(); await session.open("contact"); edit(session, "Stale");
  f.backend.replaceWorkspace(); await expect(session.save()).rejects.toThrow("restored");
  expect(session.getSnapshot().workspaceChanged).toBe(true); expect(f.backend.updates).toBe(0);
  session.cancel(); expect(f.journal).toBeNull();
});
it("marks unchanged reads from a replaced workspace for explicit review", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  f.backend.replaceWorkspace(); await session.refresh();
  expect(session.getSnapshot().workspaceChanged).toBe(true); expect(f.backend.updates).toBe(0);
});
it("keeps pre-generation recovery text without sending its old pending operation", async () => {
  const f = fixture(), session = f.make(); await session.open("contact");
  const journal = structuredClone(f.journal!); delete journal.base.generation;
  const restored = f.make(journal), count = f.request.mock.calls.length;
  await restored.refresh(); await expect(restored.save()).rejects.toThrow("Resolve");
  expect(f.request.mock.calls.length).toBe(count); expect(restored.getSnapshot().draft?.call).toBe("K1ABC");
  await restored.useCurrent(); expect(restored.getSnapshot().workspaceChanged).toBe(false);
});
