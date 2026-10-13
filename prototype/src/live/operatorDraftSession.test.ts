import { describe, expect, it, vi } from "vitest";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import { DraftRequestRejected, OperatorDraftSession, readDraftJournal, sameDraftValue,
  type DraftJournal, type DraftMutation, type DraftSnapshot } from "./operatorDraftSession";

const copy = <T>(value: T): T => structuredClone(value);
function fixture() {
  let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, qso: { id: "draft-1", call: "", start: "2026-10-13T00:00:00Z", band: "20m", mode: "CW" } };
  const receipts = new Map<string, any>();
  const contacts: any[] = [];
  const request = vi.fn(async (method: string, params: any = {}) => {
    if (method === "logbook_operator_draft") return { draft: copy(current) };
    if (["logbook_operator_draft_receipt", "logbook_operator_draft_apply"].includes(method) && params.generation !== current.generation)
      return { status: "workspace_changed", generation: current.generation };
    if (method === "logbook_operator_draft_receipt") return { receipt: copy(receipts.get(params.operationID) ?? null) };
    if (method !== "logbook_operator_draft_apply") throw new Error(`Unexpected operation: ${method}`);
    const mutation = params as DraftMutation;
    if (receipts.has(mutation.operationID)) return { status: "applied", receipt: copy(receipts.get(mutation.operationID)) };
    if (mutation.draftID !== current.qso.id || mutation.expectedRevision !== current.revision)
      return { status: "conflict", draft: copy(current) };
    if (mutation.action === "save" && !current.qso.call) throw new DraftRequestRejected("A callsign is required.");
    const savedQSO = mutation.action === "save" ? copy(current.qso) : null;
    if (savedQSO) contacts.push(savedQSO);
    current = { generation: current.generation, revision: current.revision + 1, qso: mutation.action === "replace" ? copy(mutation.qso!) :
      { ...current.qso, id: `draft-${current.revision + 2}`, call: "" } };
    const receipt = { mutation: copy(mutation), draft: copy(current), savedQSO };
    receipts.set(mutation.operationID, receipt);
    return { status: "applied", receipt: copy(receipt) };
  });
  let journal: DraftJournal | null = null;
  const write = vi.fn((value: DraftJournal) => { journal = copy(value); });
  const make = (saved: DraftJournal | null = null) => new OperatorDraftSession(request, write, saved);
  return { request, write, make, contacts, get journal() { return journal; }, get current() { return current; } };
}
const type = (session: OperatorDraftSession, call: string) => session.edit({ ...session.getSnapshot().draft!, call });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };

it("reports verified refreshes only after an actual validated draft read", async () => {
  const f = fixture(), session = f.make();
  expect(await session.refresh()).toBe(true);
  // An unchanged but verified response still proves the transport recovered.
  expect(await session.refresh()).toBe(true);
  session.setLocalInputPending(true);
  const calls = f.request.mock.calls.length;
  expect(await session.refresh()).toBe(false); expect(f.request).toHaveBeenCalledTimes(calls);
  session.setLocalInputPending(false);
  f.request.mockResolvedValueOnce({ draft: { invalid: true } as unknown as DraftSnapshot });
  await expect(session.refresh()).rejects.toThrow("verified");
});
it("does not report a fenced in-flight response or changed-workspace skip as recovery", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const gate = deferred<any>(); f.request.mockImplementationOnce(() => gate.promise);
  const read = session.refresh(); session.setLocalInputPending(true);
  gate.resolve({ draft: copy(f.current) }); expect(await read).toBe(false);
  session.setLocalInputPending(false); f.current.generation = crypto.randomUUID();
  expect(await session.refresh()).toBe(true); expect(session.getSnapshot().workspaceChanged).toBe(true);
  const calls = f.request.mock.calls.length;
  expect(await session.refresh()).toBe(false); expect(f.request).toHaveBeenCalledTimes(calls);
});
it("does not report receipt-only pending reconciliation as a verified draft read", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC");
  f.request.mockRejectedValueOnce(new Error("IPC lost"));
  await expect(session.commit("save")).rejects.toThrow("IPC lost");
  expect(session.getSnapshot().pending).toBeTruthy();
  expect(await session.refresh()).toBe(false);
  expect(session.getSnapshot().pending).toBeTruthy();
});

it("ignores an older overlapping reload after a newer wake response", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const old = copy(f.current), gate = deferred<any>();
  f.request.mockImplementationOnce(() => gate.promise);
  const loading = session.load();
  f.current.revision++; f.current.qso.call = "NEWER";
  await session.refresh(); gate.resolve({ draft: old }); await loading;
  expect(session.getSnapshot()).toMatchObject({ draft: { call: "NEWER" }, conflict: null, workspaceChanged: false });
});
it("fences an in-flight read when a direct canonical snapshot arrives", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const old = copy(f.current), gate = deferred<any>();
  f.request.mockImplementationOnce(() => gate.promise);
  const loading = session.refresh();
  f.current.revision++; f.current.qso.call = "DIRECT";
  session.receiveSnapshot(copy(f.current)); gate.resolve({ draft: old }); await loading;
  expect(session.getSnapshot()).toMatchObject({ draft: { call: "DIRECT" }, conflict: null });
});
it("retains the docked draft during unfinished local input and refreshes after correction", async () => {
  const f = fixture(), session = f.make(); await session.load();
  session.setLocalInputPending(true);
  f.current.revision++; f.current.qso.id = "remote-clear";
  const before = f.request.mock.calls.length;
  await session.load(); await session.refresh(); session.receiveSnapshot(copy(f.current));
  expect(f.request.mock.calls.length).toBe(before);
  expect(session.getSnapshot().draft?.id).toBe("draft-1");
  session.setLocalInputPending(false); await session.refresh();
  expect(session.getSnapshot().draft?.id).toBe("remote-clear");
});
it("does not apply a read that began before unfinished field input", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const gate = deferred<any>(); f.request.mockImplementationOnce(() => gate.promise);
  const loading = session.refresh(); session.setLocalInputPending(true);
  f.current.revision++; f.current.qso.id = "remote-clear";
  gate.resolve({ draft: copy(f.current) }); await loading;
  expect(session.getSnapshot().draft?.id).toBe("draft-1");
  session.setLocalInputPending(false); await session.refresh();
  expect(session.getSnapshot().draft?.id).toBe("remote-clear");
});

it("does not replace a restored draft even when its ID and revision match", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "MYTEXT");
  f.current.generation = crypto.randomUUID();
  await expect(session.flush()).rejects.toThrow("restored");
  expect(session.getSnapshot()).toMatchObject({ workspaceChanged: true, draft: { call: "MYTEXT" } });
  const count = f.request.mock.calls.length; await expect(session.retry()).rejects.toThrow("restored");
  expect(f.request.mock.calls.length).toBe(count); expect(f.current.qso.call).toBe("");
  await session.useShared(); type(session, "REVIEWED"); await session.flush();
  expect(f.current.qso.call).toBe("REVIEWED");
});
it("does not reconcile an old Save receipt as a current-workspace acknowledgement", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
  const backend = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => {
    const result = await backend(method, params);
    if (method === "logbook_operator_draft_apply" && params.action === "save") throw new Error("Lost acknowledgement");
    return result;
  });
  await expect(session.commit("save")).rejects.toThrow("Lost");
  f.current.generation = crypto.randomUUID();
  const restarted = f.make(f.journal); await restarted.load();
  expect(restarted.getSnapshot()).toMatchObject({ workspaceChanged: true, draft: { call: "K1ABC" } });
  expect(f.contacts).toHaveLength(1);
  await expect(restarted.retry()).rejects.toThrow("restored");
  await restarted.useShared(); expect(restarted.getSnapshot().pending).toBeNull();
  expect(f.contacts).toHaveLength(1);
});
it("requires review after a generation change even when no draft text changed", async () => {
  const f = fixture(), session = f.make(); await session.load();
  f.current.generation = crypto.randomUUID(); await session.refresh();
  expect(session.getSnapshot().workspaceChanged).toBe(true);
  await expect(session.commit("clear")).rejects.toThrow("Check");
  await session.useShared(); expect(session.getSnapshot().workspaceChanged).toBe(false);
});
it("retains legacy recovery text without binding it silently to the current workspace", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "LEGACY");
  const journal = copy(f.journal!); delete journal.base!.generation;
  const restarted = f.make(journal), count = f.request.mock.calls.length;
  await restarted.load(); expect(f.request.mock.calls.length).toBe(count);
  expect(restarted.getSnapshot()).toMatchObject({ workspaceChanged: true, draft: { call: "LEGACY" } });
  await expect(restarted.flush()).rejects.toThrow("restored");
  await restarted.useShared(); expect(restarted.getSnapshot().draft?.call).toBe("");
});

describe("workspace operator draft client", () => {
  it("loads once, journals edits and uses revision-checked Replace", async () => {
    const f = fixture(), session = f.make();
    await Promise.all([session.load(), session.load()]);
    expect(f.request).toHaveBeenCalledTimes(1);
    type(session, "OM0RX");
    expect(f.journal?.draft?.call).toBe("OM0RX");
    await session.flush();
    expect(f.current.qso.call).toBe("OM0RX");
    expect(session.dirty).toBe(false);
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["logbook_operator_draft", "logbook_operator_draft_apply"]);
  });
  it("preserves typing while an earlier Replace is in flight and serializes the next edit", async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>();
    await session.load(); type(session, "K1A");
    const backend = f.request.getMockImplementation()!;
    let writes = 0;
    f.request.mockImplementation(async (method, params) => {
      if (method === "logbook_operator_draft_apply" && ++writes === 1) await gate.promise;
      return backend(method, params);
    });
    const first = session.flush();
    type(session, "K1ABC"); gate.resolve(); await first;
    expect(f.current.qso.call).toBe("K1ABC");
    expect(writes).toBe(2);
  });
  it("deduplicates simultaneous Save and writes exactly one contact", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC");
    const first = session.commit("save"), second = session.commit("save");
    expect(first).toBe(second);
    expect(() => type(session, "NEW")).toThrow("Wait");
    await Promise.all([first, second]);
    expect(f.contacts).toHaveLength(1);
    expect(session.getSnapshot().draft?.call).toBe("");
    expect(session.getSnapshot().locked).toBe(false);
  });
  it("recovers a lost Save acknowledgement after reload without replay or duplicate logging", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply" && params?.action === "save") throw new Error("IPC lost");
      return result;
    });
    await expect(session.commit("save")).rejects.toThrow("IPC lost");
    expect(f.journal?.pending?.action).toBe("save");
    expect(session.getSnapshot().locked).toBe(true);
    const calls = f.request.mock.calls.length;
    const restored = f.make(readDraftJournal(JSON.stringify(f.journal)));
    await restored.load();
    expect(f.contacts).toHaveLength(1);
    expect(restored.getSnapshot().pending).toBeNull();
    expect(restored.getSnapshot().locked).toBe(false);
    expect(f.request.mock.calls.slice(calls).map(([method]) => method)).toEqual(["logbook_operator_draft_receipt", "logbook_operator_draft"]);
  });
  it("retries a not-delivered Save with the identical persisted operation", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
    const backend = f.request.getMockImplementation()!;
    let failed = false;
    f.request.mockImplementation(async (method, params) => {
      if (method === "logbook_operator_draft_apply" && params?.action === "save" && !failed) { failed = true; throw new Error("not delivered"); }
      return backend(method, params);
    });
    await expect(session.commit("save")).rejects.toThrow();
    const original = copy(session.getSnapshot().pending);
    await session.reconcile(); expect(session.getSnapshot().pending).toEqual(original);
    await session.retry();
    const saves = f.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save");
    expect(saves).toHaveLength(2); expect(saves[0][1]).toEqual(saves[1][1]); expect(f.contacts).toHaveLength(1);
  });
  it("keeps conflicting local text and requires an explicit same-draft resolution", async () => {
    const f = fixture(), first = f.make(), second = f.make(); await first.load(); await second.load();
    type(first, "K1ABC"); type(second, "OM0RX"); await first.flush();
    await expect(second.flush()).rejects.toThrow("another window");
    expect(second.getSnapshot().draft?.call).toBe("OM0RX"); expect(f.current.qso.call).toBe("K1ABC");
    second.keepLocal(); await second.flush(); expect(f.current.qso.call).toBe("OM0RX");
    type(first, "W1AW"); await first.refresh();
    await first.useShared(); expect(first.getSnapshot().draft?.call).toBe("OM0RX");
  });
  it("does not rebase old text into the next contact when another surface logs it", async () => {
    const f = fixture(), first = f.make(), second = f.make(); await first.load(); type(first, "K1ABC"); await first.flush(); await second.load();
    type(second, "OM0RX"); await first.commit("save"); await second.refresh();
    expect(second.getSnapshot().draft?.call).toBe("OM0RX");
    expect(() => second.keepLocal()).toThrow("saved or cleared");
    await expect(second.commit("save")).rejects.toThrow(); expect(f.contacts).toHaveLength(1);
  });
  it("reconciles worker rejection against the receipt before treating Save as failed", async () => {
    const f = fixture(), session = f.make(); await session.load();
    await expect(session.commit("save")).rejects.toThrow("callsign");
    expect(session.getSnapshot().pending).toBeNull(); expect(session.getSnapshot().locked).toBe(false);
    type(session, "K1ABC"); await session.flush();
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply" && params?.action === "save") throw new DraftRequestRejected("Aggregate refresh failed after commit");
      return result;
    });
    expect((await session.commit("save"))?.call).toBe("K1ABC"); expect(f.contacts).toHaveLength(1);
  });
  it("does not send an operation when recovery storage cannot persist its identity", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC");
    f.write.mockImplementation(() => { throw new Error("disk full"); });
    await expect(session.commit("save")).rejects.toThrow("disk full");
    expect(f.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(false);
    expect(session.getSnapshot().draft?.call).toBe("K1ABC");
  });
  it("retains text newer than an unacknowledged Replace across restart", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1A");
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => { const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply") throw new Error("lost ack"); return result; });
    await expect(session.flush()).rejects.toThrow(); type(session, "K1ABC");
    const restored = f.make(readDraftJournal(JSON.stringify(f.journal))); await restored.load();
    expect(restored.getSnapshot().draft?.call).toBe("K1ABC"); expect(restored.dirty).toBe(true);
  });
  it("compares Swift UUID casing and equivalent ISO timestamp representations semantically", () => {
    expect(sameDraftValue({ operationID: "AABB", qso: { id: "AABB", start: "2026-10-13T00:00:00Z" } },
      { qso: { start: "2026-10-13T00:00:00.000Z", id: "aabb" }, operationID: "aabb" })).toBe(true);
    expect(sameDraftValue({ id: "AABB", dxcc: null, frequencyHz: null, wavelogID: null }, { id: "aabb" })).toBe(true);
    expect(sameDraftValue({ id: "AABB", name: null }, { id: "aabb" })).toBe(false);
    expect(readDraftJournal("bad")).toBeNull(); expect(readDraftJournal(JSON.stringify({ base: { revision: -1 } }))).toBeNull();
  });
  it("two surfaces cannot log the same canonical draft twice", async () => {
    const f = fixture(), first = f.make(), second = f.make();
    await first.load(); type(first, "OM0RX"); await first.flush(); await second.load();
    const outcomes = await Promise.allSettled([first.commit("save"), second.commit("save")]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(f.contacts).toHaveLength(1);
    expect(second.getSnapshot().draft?.call).toBe("OM0RX");
    expect(second.getSnapshot().conflict?.qso.call).toBe("");
  });
  it("refuses a mismatched receipt while retaining recovery identity and local text", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply") result.receipt.mutation.operationID = "wrong-operation";
      return result;
    });
    await expect(session.flush()).rejects.toThrow("verified");
    expect(session.getSnapshot().draft?.call).toBe("OM0RX"); expect(session.getSnapshot().pending).not.toBeNull();
  });
  it("fetches current state after a historical receipt, without rolling back newer remote text", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => { const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply") throw new Error("lost ack"); return result; });
    await expect(session.flush()).rejects.toThrow(); const journal = copy(f.journal);
    f.request.mockImplementation(backend);
    const other = f.make(); await other.load(); type(other, "W1AW"); await other.flush();
    const restored = f.make(journal); await restored.load();
    expect(restored.getSnapshot().draft?.call).toBe("W1AW");
    expect(restored.getSnapshot().base?.revision).toBe(f.current.revision);
  });
  it("Clear is revision-fenced and never writes a logbook contact", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    await session.commit("clear"); expect(session.getSnapshot().draft?.call).toBe(""); expect(f.contacts).toHaveLength(0);
    expect(f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply")).toHaveLength(1);
  });
  it("reset clears the recovery journal and ignores an older workspace load", async () => {
    const f = fixture(), session = f.make(); await session.load();
    const gate = deferred<any>(); f.request.mockReturnValueOnce(gate.promise);
    const loading = session.refresh(); session.reset();
    gate.resolve({ draft: { revision: 12, qso: { id: "old", call: "OLD" } } }); await loading;
    expect(session.getSnapshot().draft).toBeNull(); expect(readDraftJournal(JSON.stringify(f.journal))).toBeNull();
  });
  it.each(["save", "clear"] as const)("ignores a delayed read from before %s without creating a false conflict", async action => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX"); await session.flush();
    const old = copy(f.current), gate = deferred<any>();
    f.request.mockReturnValueOnce(gate.promise);
    const reading = session.refresh();
    await session.commit(action);
    gate.resolve({ draft: old }); await reading;
    expect(session.getSnapshot().draft?.call).toBe("");
    expect(session.getSnapshot().conflict).toBeNull();
    expect(session.getSnapshot().error).toBe("");
  });
  it("does not let autosave or another action overtake explicit conflict resolution", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    const gate = deferred<any>(); f.request.mockReturnValueOnce(gate.promise);
    const resolution = session.useShared();
    await expect(session.flush()).rejects.toThrow("resolution");
    await expect(session.commit("save")).rejects.toThrow("pending");
    expect(() => type(session, "NEW")).toThrow("Wait");
    expect(() => session.reset()).toThrow("Finish");
    gate.resolve({ draft: copy(f.current) }); await resolution;
    expect(session.getSnapshot().draft?.call).toBe(""); expect(f.contacts).toHaveLength(0);
  });
  it("flushes before restoring and keeps entry locked through the Replace acknowledgement", async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>();
    await session.load(); type(session, "OM0RX");
    const restore = vi.fn(async () => {
      expect(f.current.qso.call).toBe("OM0RX");
      expect(session.getSnapshot().locked).toBe(true);
      expect(() => type(session, "NEW")).toThrow("Wait");
      await gate.promise;
      return "restored";
    });
    const restoring = session.withWorkspaceRestore(restore);
    await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
    await expect(session.commit("save")).rejects.toThrow("pending");
    expect(() => session.reset()).toThrow("Finish");
    gate.resolve(); expect(await restoring).toBe("restored");
    expect(session.getSnapshot()).toMatchObject({ draft: null, base: null, pending: null, locked: false });
    expect(f.journal).toEqual({ draft: null, base: null, pending: null });
    await session.load(); expect(session.getSnapshot().draft?.call).toBe("OM0RX");
    expect(f.contacts).toHaveLength(0);
  });
  it("does not restore over an unresolved operation or conflicting draft", async () => {
    const f = fixture(), session = f.make(), other = f.make();
    await session.load(); await other.load(); type(session, "LOCAL"); type(other, "OTHER"); await other.flush();
    const restore = vi.fn();
    await expect(session.withWorkspaceRestore(restore)).rejects.toThrow("another window");
    expect(session.getSnapshot().locked).toBe(false);
    await expect(session.withWorkspaceRestore(restore)).rejects.toThrow("Resolve");
    await session.useShared();
    f.request.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await expect(session.commit("save")).rejects.toThrow();
    await expect(session.withWorkspaceRestore(restore)).rejects.toThrow("Resolve");
    expect(restore).not.toHaveBeenCalled();
  });
  it("leaves an uncertain workspace restore locked without additional draft requests", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    await expect(session.withWorkspaceRestore(async () => { throw new Error("IPC lost"); })).rejects.toThrow("IPC lost");
    expect(session.getSnapshot()).toMatchObject({ locked: true, error: expect.stringContaining("unconfirmed") });
    const count = f.request.mock.calls.length;
    await session.refresh();
    expect(() => type(session, "NEW")).toThrow("Wait");
    expect(() => session.reset()).toThrow("Finish");
    await expect(session.commit("clear")).rejects.toThrow("pending");
    expect(f.request).toHaveBeenCalledTimes(count);
    expect(f.journal?.draft?.call).toBe("OM0RX");
  });
});
