import { describe, expect, it, vi } from "vitest";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import { DraftRequestRejected, OperatorDraftSession, readDraftJournal, sameDraftValue,
  type DraftJournal, type DraftMutation, type DraftSnapshot } from "./operatorDraftSession";
import { effectiveDraftAutomaticStart } from "./operatorDraftTimeIntent";

const copy = <T>(value: T): T => structuredClone(value);
function fixture(clock?: { capturedAt: string; savedAt: string; automaticStart?: boolean }) {
  let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0,
    ...(clock ? { automaticStart: clock.automaticStart } : {}),
    qso: { id: "draft-1", call: "", start: "2026-10-13T00:00:00Z", band: "20m", mode: "CW" } };
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
    // Model the native owner: first callsign capture advances an automatic
    // start, a genuine date change makes it manual, and Save uses its own clock.
    let automaticStart = current.automaticStart;
    const replacement = mutation.action === "replace" ? copy(mutation.qso!) : null;
    if (clock && replacement) {
      if (!sameDraftValue({ start: replacement.start, end: replacement.end }, { start: current.qso.start, end: current.qso.end })) automaticStart = false;
      else if (automaticStart && !current.qso.call.trim() && replacement.call.trim()) replacement.start = clock.capturedAt;
    }
    const savedQSO = mutation.action === "save" ? { ...copy(current.qso), ...(clock && automaticStart ? { start: clock.savedAt } : {}) } : null;
    if (savedQSO) contacts.push(savedQSO);
    current = { generation: current.generation, revision: current.revision + 1,
      ...(clock ? { automaticStart: mutation.action === "replace" ? automaticStart : true } : {}), qso: replacement ??
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

describe("queued automatic UTC receipt merge", () => {
  const capturedAt = "2026-10-13T00:00:05Z", savedAt = "2026-10-13T00:00:10Z";
  const cases = (["direct", "receipt-remount", "retry-remount"] as const).flatMap(path =>
    (["untouched", "reversed", "manual-start", "manual-end", "manual-both", "manual-power"] as const).map(intent => ({ path, intent })));
  it.each(cases)("merges $intent UTC through $path", async ({ path, intent }) => {
      const f = fixture({ capturedAt, savedAt, automaticStart: true });
      let session = f.make(); await session.load();
      const originalStart = session.getSnapshot().draft!.start;
      type(session, "K2AUTO");
      const backend = f.request.getMockImplementation()!, started = deferred<void>(), reply = deferred<void>();
      let first = true;
      f.request.mockImplementation(async (method, params) => {
        if (method === "logbook_operator_draft_receipt" && path === "receipt-remount") throw new Error("receipt unavailable");
        if (method === "logbook_operator_draft_apply" && first) {
          first = false;
          const result = path === "retry-remount" ? null : await backend(method, params);
          started.resolve(); await reply.promise;
          if (path !== "direct") throw new Error("reply lost");
          return result!;
        }
        return backend(method, params);
      });
      const flushing = session.flush(); await started.promise;
      session.edit({ ...session.getSnapshot().draft!, frequencyHz: 14_025_000, comment: "queued before acknowledgement", name: "Local name" });
      if (intent === "reversed") {
        session.edit({ ...session.getSnapshot().draft!, start: "2026-10-15T00:00:00Z", end: "2026-10-15T00:01:00Z" });
        session.edit({ ...session.getSnapshot().draft!, start: "2026-10-13T00:00:00.000Z", end: null });
      }
      if (intent === "manual-start" || intent === "manual-both") session.edit({ ...session.getSnapshot().draft!, start: "2026-10-12T23:59:00Z" });
      if (intent === "manual-end" || intent === "manual-both") session.edit({ ...session.getSnapshot().draft!, end: "2026-10-13T00:01:00Z" });
      if (intent === "manual-power") session.setManualPower("25");
      const local = copy(session.getSnapshot().draft!);
      reply.resolve();
      if (path === "direct") await flushing;
      else {
        await expect(flushing).rejects.toThrow("reply lost");
        f.request.mockImplementation(backend);
        session = f.make(readDraftJournal(JSON.stringify(f.journal))); await session.load();
        await session.flush();
      }
      const manual = intent.startsWith("manual-") && intent !== "manual-power";
      const replacements = f.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "replace");
      const queued = replacements.at(-1)![1] as DraftMutation;
      expect(queued.qso).toMatchObject({ frequencyHz: 14_025_000, comment: "queued before acknowledgement", name: "Local name" });
      expect(queued.qso!.start).toBe(manual ? local.start : capturedAt);
      expect(sameDraftValue({ end: queued.qso!.end }, { end: local.end })).toBe(true);
      expect(session.getSnapshot().base?.automaticStart).toBe(!manual);
      expect(f.current.qso.start).toBe(manual ? local.start : capturedAt);
      expect(f.current.qso.start).not.toBe(manual ? capturedAt : originalStart);
      if (intent === "manual-power") {
        expect(queued.powerIntent).toEqual({ action: "manual", value: "25" });
        expect(session.getSnapshot().powerIntent).toBeNull();
      }
      const saved = await session.commit("save");
      expect(saved).toMatchObject({ call: "K2AUTO", frequencyHz: 14_025_000, comment: "queued before acknowledgement", name: "Local name", start: manual ? local.start : savedAt });
      expect(sameDraftValue({ end: saved!.end }, { end: local.end })).toBe(true);
      expect(f.contacts).toHaveLength(1);
      expect(session.getSnapshot().base?.automaticStart).toBe(true);
  });

  it.each([false, undefined])("does not infer automatic provenance from a %s receipt", async automaticStart => {
    const f = fixture({ capturedAt, savedAt, automaticStart }), session = f.make(); await session.load(); type(session, "K2AUTO");
    const backend = f.request.getMockImplementation()!, started = deferred<void>(), reply = deferred<void>();
    f.request.mockImplementationOnce(async (method, params) => {
      const result = await backend(method, params);
      // A changed date without authoritative automatic provenance must not
      // overwrite local dates while later text is queued.
      f.current.qso.start = result.receipt.draft.qso.start = capturedAt;
      started.resolve(); await reply.promise; return result;
    });
    const flushing = session.flush(); await started.promise;
    const originalStart = session.getSnapshot().draft!.start;
    session.edit({ ...session.getSnapshot().draft!, comment: "retain local dates" });
    reply.resolve(); await flushing;
    expect(session.getSnapshot().draft!.start).toBe(originalStart);
    expect(effectiveDraftAutomaticStart(session.getSnapshot())).toBe(false);
  });
});

it.each(["automatic", "manual", "different-contact"])("merges power provenance without losing ordinary fields or the %s guard", async admission => {
  const f = fixture();
  f.current.qso.txPower = "100";
  f.current.qso.extraFields = { OTHER: "original", app_om0rxxlog_power_old: "old native provenance" };
  f.current.power = { revision: 0, enabled: true, fallback: "100", manualOverride: false, selectedValue: "100",
    contact: { workspaceID: testWorkspaceGeneration, draftID: f.current.qso.id, call: "", band: "20m", mode: "CW" } };
  const session = f.make(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, comment: "pending text", extraFields: { ...f.current.qso.extraFields, OTHER: "local", LOCAL: "keep" },
    ...(admission === "different-contact" ? { call: "K1ABC" } : {}) });
  if (admission === "manual") session.setManualPower("25");
  const before = copy(session.getSnapshot().draft!);
  const current = copy(f.current);
  current.power = { ...current.power!, revision: 1, selectedValue: "500" };
  current.qso = { ...current.qso, txPower: "500", extraFields: { OTHER: "original", APP_OM0RXXLOG_POWER_NEW: "new native provenance" } };
  session.receiveSnapshot(current);
  expect(session.getSnapshot().conflict).toBeNull();
  if (admission === "automatic") expect(session.getSnapshot().draft).toMatchObject({ comment: "pending text", txPower: "500",
    extraFields: { OTHER: "local", LOCAL: "keep", APP_OM0RXXLOG_POWER_NEW: "new native provenance" } });
  else expect(session.getSnapshot().draft).toEqual(before);
  if (admission === "automatic") expect(session.getSnapshot().draft!.extraFields).not.toHaveProperty("app_om0rxxlog_power_old");
  expect(f.current.qso.extraFields).toHaveProperty("app_om0rxxlog_power_old");
});

it("derives automatic time only from unchanged local timestamps, including equivalent ISO values and reversal", () => {
  const base: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, automaticStart: true,
    qso: { id: "draft-1", start: "2026-10-13T00:00:00Z", end: null, call: "" } };
  const draft = { ...base.qso, call: "K1ABC", name: "Local non-time edit" };
  expect(effectiveDraftAutomaticStart({ base, draft })).toBe(true);
  const manual = { ...draft, start: "2026-10-20T10:15:30Z" };
  expect(effectiveDraftAutomaticStart({ base, draft: manual })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...manual, start: base.qso.start } })).toBe(true);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...draft, start: "2026-10-13T01:00:00+01:00", end: undefined } })).toBe(true);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...draft, end: "2026-10-13T00:01:00Z" } })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base: { ...base, automaticStart: false }, draft })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base: { ...base, automaticStart: undefined }, draft })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...draft, id: "another-draft" } })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base: null, draft: null })).toBe(false);
});

it("retains effective manual UTC when an unsent journal is recovered before acknowledgment", async () => {
  const f = fixture(); f.current.automaticStart = true;
  const session = f.make(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, start: "2026-10-20T10:15:30Z" });
  expect(session.getSnapshot().base?.automaticStart).toBe(true);
  expect(effectiveDraftAutomaticStart(session.getSnapshot())).toBe(false);
  expect(f.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(false);
  const recovered = f.make(readDraftJournal(JSON.stringify(f.journal)));
  await recovered.load();
  expect(recovered.getSnapshot().draft?.start).toBe("2026-10-20T10:15:30Z");
  expect(effectiveDraftAutomaticStart(recovered.getSnapshot())).toBe(false);
});

it("compares effective time intent with the native UUID identity rather than UUID text case", () => {
  const base: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, automaticStart: true,
    qso: { id: "FFFFFFFF-AAAA-4BBB-8CCC-123456789ABC", start: "2026-10-13T00:00:00Z" } };
  const draft = { ...base.qso, id: base.qso.id.toLowerCase(), call: "K1ABC" };
  expect(effectiveDraftAutomaticStart({ base, draft })).toBe(true);
  expect(effectiveDraftAutomaticStart({ base: { ...base, qso: draft }, draft: base.qso })).toBe(true);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...draft, start: "2026-10-20T10:15:30Z" } })).toBe(false);
  expect(effectiveDraftAutomaticStart({ base, draft: { ...draft, id: "FFFFFFFF-AAAA-4BBB-8CCC-123456789ABD" } })).toBe(false);
});

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
it("silently retries a pending autosave with the same identity during refresh", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC");
  const backend = f.request.getMockImplementation()!;
  let failed = false;
  f.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply" && params?.action === "replace" && !failed) {
      failed = true;
      throw new Error("Prototype worker is busy; try again");
    }
    return backend(method, params);
  });
  await expect(session.flush()).rejects.toThrow("busy");
  const original = copy(session.getSnapshot().pending);
  expect(original?.action).toBe("replace");
  expect(session.getSnapshot().error).toBe("");
  expect(await session.refresh()).toBe(true);
  expect(session.getSnapshot().pending).toBeNull();
  expect(session.getSnapshot().error).toBe("");
  const replaces = f.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "replace");
  expect(replaces).toHaveLength(2);
  expect(replaces[0][1].operationID).toBe(replaces[1][1].operationID);
  expect(f.current.qso.call).toBe("K1ABC");
});
it("silently retries a pending QSO save with the same identity during refresh", async () => {
  const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
  const backend = f.request.getMockImplementation()!;
  let failed = false;
  f.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply" && params?.action === "save" && !failed) { failed = true; throw new Error("IPC lost"); }
    if (method === "logbook_operator_draft_receipt") return { receipt: null };
    return backend(method, params);
  });
  await expect(session.commit("save")).rejects.toThrow("IPC lost");
  const original = copy(session.getSnapshot().pending);
  expect(session.getSnapshot().error).toBe("");
  expect(await session.refresh()).toBe(true);
  expect(session.getSnapshot().pending).toBeNull();
  const saves = f.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save");
  expect(saves).toHaveLength(2);
  expect(saves[0][1].operationID).toBe(original?.operationID);
  expect(saves[1][1].operationID).toBe(original?.operationID);
  expect(f.contacts).toHaveLength(1);
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
    if (method === "logbook_operator_draft_receipt") throw new Error("Receipt transport unavailable");
    return result;
  });
  await expect(session.commit("save")).rejects.toThrow("Lost");
  f.request.mockImplementation(backend);
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
      if (method === "logbook_operator_draft_receipt") throw new Error("Receipt transport unavailable");
      return result;
    });
    await expect(session.commit("save")).rejects.toThrow("IPC lost");
    expect(f.journal?.pending?.action).toBe("save");
    expect(session.getSnapshot().locked).toBe(true);
    const calls = f.request.mock.calls.length;
    f.request.mockImplementation(backend);
    const restored = f.make(readDraftJournal(JSON.stringify(f.journal)));
    await restored.load();
    expect(f.contacts).toHaveLength(1);
    expect(restored.getSnapshot().pending).toBeNull();
    expect(restored.getSnapshot().locked).toBe(false);
    expect(f.request.mock.calls.slice(calls).map(([method]) => method)).toEqual(["logbook_operator_draft_receipt", "logbook_operator_draft"]);
  });
  it("coalesces concurrent read-only checks of a retained operation", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply" && params.action === "save") throw new Error("lost acknowledgement");
      if (method === "logbook_operator_draft_receipt") return { receipt: null };
      return result;
    });
    await expect(session.commit("save")).rejects.toThrow();
    const gate = deferred<any>();
    f.request.mockImplementation(async (method, params) => method === "logbook_operator_draft_receipt" ? gate.promise : backend(method, params));
    const first = session.reconcile(), second = session.reconcile();
    expect(first).toBe(second);
    expect(f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_receipt")).toHaveLength(2);
    gate.resolve({ receipt: null }); await first;
    expect(session.getSnapshot().pending).toBeTruthy();
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
  it("recovers a committed operation after an ordinary lost acknowledgement", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "K1ABC"); await session.flush();
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply" && params?.action === "save") throw new Error("IPC lost after commit");
      return result;
    });
    expect((await session.commit("save"))?.call).toBe("K1ABC");
    expect(session.getSnapshot().pending).toBeNull(); expect(f.contacts).toHaveLength(1);
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
      if (method === "logbook_operator_draft_apply") throw new Error("lost ack");
      if (method === "logbook_operator_draft_receipt") throw new Error("receipt unavailable"); return result; });
    await expect(session.flush()).rejects.toThrow(); type(session, "K1ABC");
    f.request.mockImplementation(backend);
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
  it("recovers a mismatched direct acknowledgement from the durable receipt", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply") result.receipt.mutation.operationID = "wrong-operation";
      return result;
    });
    await expect(session.flush()).resolves.toBeUndefined();
    expect(session.getSnapshot().draft?.call).toBe("OM0RX"); expect(session.getSnapshot().pending).toBeNull();
  });
  it("fetches current state after a historical receipt, without rolling back newer remote text", async () => {
    const f = fixture(), session = f.make(); await session.load(); type(session, "OM0RX");
    const backend = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => { const result = await backend(method, params);
      if (method === "logbook_operator_draft_apply") throw new Error("lost ack");
      if (method === "logbook_operator_draft_receipt") throw new Error("receipt unavailable"); return result; });
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
