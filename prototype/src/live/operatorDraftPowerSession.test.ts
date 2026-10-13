import { expect, it, vi } from "vitest";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import { OperatorDraftSession, readDraftJournal, validDraftSnapshot,
  type DraftJournal, type DraftMutation, type DraftPowerState, type DraftSnapshot } from "./operatorDraftSession";

const copy = <T>(value: T): T => structuredClone(value);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
function fixture(legacy = false) {
  const id = crypto.randomUUID(), sessionID = crypto.randomUUID();
  const contact = { workspaceID: testWorkspaceGeneration, draftID: id, call: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000 };
  const power: DraftPowerState = { revision: 0, enabled: true, fallback: "100", manualOverride: false, selectedValue: "100", contact };
  let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, power: legacy ? undefined : power,
    qso: { id, call: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000, txPower: "100", notes: "", name: "", extraFields: { OTHER: "keep" } } };
  const receipts = new Map<string, any>();
  const request = vi.fn(async (method: string, params: any = {}) => {
    if (method === "logbook_operator_draft") return { draft: copy(current) };
    if (method === "logbook_operator_draft_receipt") return { receipt: copy(receipts.get(params.operationID) ?? null) };
    if (method !== "logbook_operator_draft_apply") throw new Error("Unexpected method");
    const mutation = params as DraftMutation;
    if (receipts.has(mutation.operationID)) return { status: "applied", receipt: copy(receipts.get(mutation.operationID)) };
    if (mutation.expectedRevision !== current.revision || mutation.draftID !== current.qso.id)
      return { status: "conflict", draft: copy(current) };
    if (mutation.action !== "replace") throw new Error("Only Replace is expected");
    const qso = copy(mutation.qso!), nextPower = copy(current.power ?? { ...power, enabled: false });
    const changedContact = qso.call.trim().toUpperCase() !== nextPower.contact.call;
    nextPower.contact = { ...nextPower.contact, call: qso.call.trim().toUpperCase(), band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz };
    if (changedContact || mutation.powerIntent) {
      nextPower.revision++; nextPower.selectedSample = null; nextPower.selectedContext = null; nextPower.selectedContact = null;
      nextPower.activeScope = null; nextPower.sessionPeak = null; nextPower.lastObservedAt = null;
      if (!nextPower.manualOverride || mutation.powerIntent?.action === "automatic") nextPower.selectedValue = nextPower.fallback;
    }
    if (mutation.powerIntent?.action === "manual") { nextPower.manualOverride = true; nextPower.selectedValue = mutation.powerIntent.value; }
    if (mutation.powerIntent?.action === "automatic") nextPower.manualOverride = false;
    qso.txPower = nextPower.selectedValue;
    current = { ...current, revision: current.revision + 1, qso, power: nextPower };
    const receipt = { mutation: copy(mutation), draft: copy(current), savedQSO: null };
    receipts.set(mutation.operationID, receipt);
    return { status: "applied", receipt: copy(receipt) };
  });
  let journal: DraftJournal | null = null;
  const write = vi.fn((value: DraftJournal) => { journal = copy(value); });
  const make = (saved: DraftJournal | null = null) => new OperatorDraftSession(request, write, saved);
  const meter = (watts: number) => {
    const sample = { source: "kpa500_output" as const, unit: "W" as const, watts, sessionID,
      observedAt: "2026-10-14T00:00:01Z", radioObservedAt: "2026-10-14T00:00:01Z",
      amplifierObservedAt: "2026-10-13T23:59:56Z", receivedAt: "2026-10-14T00:00:01Z" };
    const context = { providerID: "station-1", selectionID: "radio-1", sessionID, sessionStartedAt: "2026-10-14T00:00:00Z",
      source: "direct_agent" as const, meterSource: "kpa500_output" as const };
    current = { ...current, qso: { ...current.qso, txPower: String(watts) }, power: { ...current.power!, revision: current.power!.revision + 1,
      selectedValue: String(watts), selectedSample: sample, selectedContext: context, selectedContact: copy(current.power!.contact), lastContext: context } };
    return copy(current);
  };
  const enableAutomatic = () => { current = { ...current, power: { ...current.power!, revision: current.power!.revision + 1, enabled: true } }; return copy(current); };
  return { request, write, make, meter, enableAutomatic, get current() { return current; }, get journal() { return journal; } };
}

it.each(["100", ""])("journals explicit manual intent for same/empty value '%s' and flushes it", async value => {
  const f = fixture(), session = f.make(); await session.load();
  session.setManualPower(value);
  expect(session.dirty).toBe(true);
  expect(f.journal?.powerIntent).toEqual({ action: "manual", value });
  expect(readDraftJournal(JSON.stringify(f.journal))?.powerIntent).toEqual({ action: "manual", value });
  await session.flush();
  const sent = f.request.mock.calls.find(([method]) => method === "logbook_operator_draft_apply")![1];
  expect(sent.powerIntent).toEqual({ action: "manual", value });
  expect(sent).not.toHaveProperty("powerIntentID");
  expect(session.getSnapshot().base?.power?.manualOverride).toBe(true);
  expect(session.getSnapshot().draft?.txPower).toBe(value);
  expect(session.getSnapshot().powerIntent).toBeNull(); expect(session.dirty).toBe(false);
});

it("resumes automatic capture through explicit intent and waits for the canonical fallback", async () => {
  const f = fixture(), session = f.make(); await session.load(); session.setManualPower("25"); await session.flush();
  session.resumeAutomaticPower();
  expect(session.getSnapshot().draft?.txPower).toBe("25");
  expect(f.journal?.powerIntent).toEqual({ action: "automatic" });
  await session.flush();
  expect(f.current.power?.manualOverride).toBe(false); expect(session.getSnapshot().draft?.txPower).toBe("100");
  expect(f.request.mock.calls.at(-1)![1].powerIntent).toEqual({ action: "automatic" });
});

it("merges equal-edit-revision power updates while retaining dirty contact text without conflict", async () => {
  const f = fixture(), session = f.make(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, notes: "unfinished note", name: "Oliver" });
  const revision = session.getSnapshot().base!.revision;
  session.receiveSnapshot(f.meter(550));
  expect(session.getSnapshot().base?.revision).toBe(revision);
  expect(session.getSnapshot().base?.power?.revision).toBe(1);
  expect(session.getSnapshot().draft).toMatchObject({ notes: "unfinished note", name: "Oliver", txPower: "550" });
  expect(session.getSnapshot().conflict).toBeNull(); expect(session.getSnapshot().error).toBe("");
  await session.flush();
  expect(f.current.qso).toMatchObject({ notes: "unfinished note", name: "Oliver", txPower: "550" });
});

it("does not apply captured power to an unacknowledged different contact", async () => {
  const f = fixture(), session = f.make(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, call: "JA1ABC" });
  session.receiveSnapshot(f.meter(550));
  expect(session.getSnapshot().draft).toMatchObject({ call: "JA1ABC", txPower: "100" });
  expect(session.getSnapshot().conflict).toBeNull();
  await session.flush(); expect(f.current.qso).toMatchObject({ call: "JA1ABC", txPower: "100" });
});

it("ignores older power snapshots at equal edit revision", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const old = copy(f.current); session.receiveSnapshot(f.meter(500)); session.receiveSnapshot(old);
  expect(session.getSnapshot().draft?.txPower).toBe("500"); expect(session.getSnapshot().base?.power?.revision).toBe(1);
  expect(session.getSnapshot().conflict).toBeNull();
});

it("does not erase a real text conflict when a delayed power-only snapshot arrives", async () => {
  const f = fixture(), session = f.make(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, notes: "local" });
  session.receiveSnapshot({ ...copy(f.current), revision: 1, qso: { ...f.current.qso, notes: "other window" } });
  const conflict = copy(session.getSnapshot().conflict);
  session.receiveSnapshot(f.meter(500));
  expect(session.getSnapshot().draft).toMatchObject({ notes: "local", txPower: "500" });
  expect(session.getSnapshot().conflict).toEqual(conflict);
  await expect(session.flush()).rejects.toThrow("another window");
});

it("preserves unsent and in-flight manual power against newer equal-revision meter snapshots", async () => {
  const f = fixture(), session = f.make(), gate = deferred(); await session.load();
  session.setManualPower("42"); session.receiveSnapshot(f.meter(600));
  expect(session.getSnapshot().draft?.txPower).toBe("42"); expect(session.getSnapshot().powerIntent).toEqual({ action: "manual", value: "42" });
  const backend = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => { if (method === "logbook_operator_draft_apply") await gate.promise; return backend(method, params); });
  const sending = session.flush(), pending = copy(session.getSnapshot().pending);
  session.receiveSnapshot(f.meter(700));
  expect(session.getSnapshot().pending).toEqual(pending); expect(session.getSnapshot().draft?.txPower).toBe("42");
  expect(session.getSnapshot().conflict).toBeNull(); gate.resolve(); await sending;
  expect(f.current.qso.txPower).toBe("42"); expect(session.dirty).toBe(false);
});

it("retries a not-delivered empty manual intent with its exact operation and payload", async () => {
  const f = fixture(), session = f.make(); await session.load(); session.setManualPower("");
  const backend = f.request.getMockImplementation()!; let rejected = false;
  f.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply" && !rejected) { rejected = true; throw new Error("IPC unavailable"); }
    return backend(method, params);
  });
  await expect(session.flush()).rejects.toThrow("IPC");
  const original = copy(f.journal!.pending), restored = f.make(readDraftJournal(JSON.stringify(f.journal)));
  await restored.retry();
  const sent = f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply").map(([, params]) => params);
  expect(sent).toEqual([original, original]); expect(restored.getSnapshot().draft?.txPower).toBe("");
  expect(restored.getSnapshot().powerIntent).toBeNull(); expect(restored.dirty).toBe(false);
});

it("retains an identical newer manual intent after lost acknowledgement and restart", async () => {
  const f = fixture(), session = f.make(); await session.load(); session.setManualPower("42");
  const backend = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => { const result = await backend(method, params);
    if (method === "logbook_operator_draft_apply") throw new Error("lost ack"); return result; });
  await expect(session.flush()).rejects.toThrow("lost ack");
  const pendingID = session.getSnapshot().pendingPowerIntentID;
  session.setManualPower("42");
  expect(session.getSnapshot().powerIntentID).not.toBe(pendingID);
  const restored = f.make(readDraftJournal(JSON.stringify(f.journal))); await restored.load();
  expect(restored.getSnapshot().pending).toBeNull(); expect(restored.getSnapshot().powerIntent).toEqual({ action: "manual", value: "42" });
  expect(restored.dirty).toBe(true); expect(restored.getSnapshot().conflict).toBeNull();
  f.request.mockImplementation(backend); await restored.flush();
  const sent = f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply").map(([, params]) => params);
  expect(sent).toHaveLength(2); expect(sent[0].operationID).not.toBe(sent[1].operationID);
  expect(sent[1].powerIntent).toEqual(sent[0].powerIntent); expect(restored.dirty).toBe(false);
});

it("retains newer typing while merging canonical power from the acknowledged Replace", async () => {
  const f = fixture(), session = f.make(), gate = deferred(); await session.load();
  session.edit({ ...session.getSnapshot().draft!, notes: "first" });
  const backend = f.request.getMockImplementation()!; let writes = 0;
  f.request.mockImplementation(async (method, params) => { if (method === "logbook_operator_draft_apply" && ++writes === 1) await gate.promise;
    return backend(method, params); });
  const sending = session.flush(); session.edit({ ...session.getSnapshot().draft!, notes: "latest" });
  f.meter(500); gate.resolve(); await sending;
  expect(f.current.qso).toMatchObject({ notes: "latest", txPower: "500" }); expect(writes).toBe(2); expect(session.dirty).toBe(false);
});

it("rejects malformed metadata and intent journals without weakening legacy snapshots", async () => {
  const f = fixture(), session = f.make(); await session.load();
  const malformed = copy(f.current); (malformed.power as any).revision = -1;
  expect(validDraftSnapshot(malformed)).toBe(false); expect(() => session.receiveSnapshot(malformed)).toThrow("verified");
  const journal = copy(f.journal!); journal.powerIntent = { action: "manual", value: 50 } as any;
  expect(readDraftJournal(JSON.stringify(journal))).toBeNull();
  journal.powerIntent = { action: "automatic", value: "50" } as any;
  expect(readDraftJournal(JSON.stringify(journal))).toBeNull();
  const legacy = copy(f.current); delete legacy.power; expect(validDraftSnapshot(legacy)).toBe(true);
  const unavailable = new OperatorDraftSession(async () => ({ draft: legacy }), () => {}); await unavailable.load();
  expect(() => unavailable.resumeAutomaticPower()).toThrow("power-enabled");
});

it.each(["100", ""])("retains explicit '%s' manual intent entered before automatic capture is first enabled", async value => {
  const f = fixture(true), session = f.make(); await session.load();
  expect(session.getSnapshot().base?.power).toBeUndefined();
  session.setManualPower(value); await session.flush();
  expect(f.current.power).toMatchObject({ enabled: false, manualOverride: true, selectedValue: value });
  session.receiveSnapshot(f.enableAutomatic());
  expect(session.getSnapshot().base?.power).toMatchObject({ enabled: true, manualOverride: true, selectedValue: value });
  expect(session.getSnapshot().draft?.txPower).toBe(value); expect(session.getSnapshot().conflict).toBeNull();
});
