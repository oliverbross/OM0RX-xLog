import { afterEach, expect, it, vi } from "vitest";
import { OperatorDraftSession, type DraftJournal, type DraftMutation, type DraftSnapshot } from "./operatorDraftSession";
import { LogbookContactSession } from "./logbookContactSession";
import { activationDisablesFollow, SpotActivationEditor, validSpotActivationSnapshot, type SpotActivationSnapshot } from "./spotActivation";
import { type SpotActivationBarrier } from "./spotActivationBarrier";
import { SpotActivationClient } from "./spotActivationClient";

const generation = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000002";
const barrierId = "00000000-0000-4000-8000-000000000003";
const copy = <T,>(value: T): T => structuredClone(value);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const barrier = (change: Partial<SpotActivationBarrier> = {}): SpotActivationBarrier => ({ operationId, barrierId, generation,
  draftId: "draft", expectedRevision: 0, deadline: Date.now() + 5000, ...change });
const preparing = (change: Partial<SpotActivationBarrier> = {}): SpotActivationSnapshot => { const value = barrier(change); return { operationId: value.operationId, phase: "preparing", barrier: value, admitted: false }; };
const terminal = (phase: "blocked" | "confirmed" | "failed" | "uncertain" = "blocked"): SpotActivationSnapshot => ({ operationId, phase, tuneConfirmed: false, rotor: "not_requested" });
const idle: SpotActivationSnapshot = { phase: "idle", operationId: null, barrier: null };
function fixture() {
  let current: DraftSnapshot = { generation, revision: 0, qso: { id: "draft", call: "K1ABC", band: "20m", mode: "CW" } };
  let journal: DraftJournal | null = null;
  const request = vi.fn(async (method: string, value: any = {}): Promise<any> => {
    if (method === "logbook_operator_draft") return { draft: copy(current) };
    if (method === "logbook_operator_draft_receipt") return { receipt: null };
    if (method !== "logbook_operator_draft_apply") throw new Error(`Unexpected request ${method}`);
    const mutation = value as DraftMutation;
    current = { ...current, revision: current.revision + 1, qso: copy(mutation.qso!) };
    return { status: "applied", receipt: { mutation, draft: copy(current) } };
  });
  const write = vi.fn((value: DraftJournal) => { journal = copy(value); });
  const session = new OperatorDraftSession(request, write);
  const read = vi.fn(async () => ({ draft: copy(current) }));
  return { session, request, read, write, get current() { return current; }, set current(value: DraftSnapshot) { current = value; }, get journal() { return journal; } };
}
async function ready() {
  const f = fixture(); await f.session.load();
  const editor = new SpotActivationEditor([f.session], f.read); await editor.registeredWith(idle);
  return Object.assign(f, { editor });
}
afterEach(() => vi.useRealTimers());

it("releases the Desk's frozen editor after uncertain receipt recovery and permits the next explicit DX selection without replay", async () => {
  const f = fixture(); await f.session.load();
  const editor = new SpotActivationEditor([f.session], f.read);
  const stale = { ...terminal("uncertain"), reservationActive: true };
  await editor.registeredWith(stale);
  expect(f.session.canAcceptLocalInput()).toBe(false);
  const closed = { ...stale, reservationActive: false }, nextId = crypto.randomUUID();
  const native = vi.fn(async (command: string) => {
    if (command === "spot_activation_snapshot") return stale;
    if (command === "spot_activation_reconcile") { await editor.observe(closed); return closed; }
    if (command === "activate_spot") return { ...terminal("confirmed"), operationId: nextId, reservationActive: false };
    throw Error(`Unexpected recovery action ${command}`);
  });
  const client = new SpotActivationClient(native, () => nextId);
  await client.refresh(); expect(client.canActivate()).toBe(true);
  expect(f.session.canAcceptLocalInput()).toBe(true); expect(f.read).toHaveBeenCalledOnce();
  await client.activate({ id: "next-dx-report", activation: { sourceEpoch: crypto.randomUUID(), spotVersion: crypto.randomUUID() } });
  expect(native.mock.calls.map(([command]) => command)).toEqual(["spot_activation_snapshot", "spot_activation_reconcile", "activate_spot"]);
  expect(f.request.mock.calls.every(([method]) => method === "logbook_operator_draft")).toBe(true);
});

it("retires opportunity follow synchronously before a terminal remount reads and releases the shared draft", async () => {
  const f = fixture(); await f.session.load(); let following = true;
  const read = vi.fn(async () => { expect(following).toBe(false); expect(f.session.canAcceptLocalInput()).toBe(false); return { draft:copy(f.current) }; });
  const editor = new SpotActivationEditor([f.session],read,snapshot => { if (activationDisablesFollow(snapshot)) following = false; return { ready:true }; });
  await editor.registeredWith({ ...terminal("confirmed"),draftOnly:true });
  expect(following).toBe(false); expect(f.session.canAcceptLocalInput()).toBe(true); expect(read).toHaveBeenCalledOnce();
});

it("keeps Follow armed for its own draft transaction but disables it for explicit Read radio", () => {
  const outcome = { operationId, phase: "confirmed", tuneConfirmed: false, rotor: "not-requested", draftOnly: true } as const;
  expect(activationDisablesFollow({ ...outcome, intent: "follow-radio" })).toBe(false);
  expect(activationDisablesFollow({ ...outcome, intent: "read-radio" })).toBe(true);
});

it("starts editors read-only until actual verified registration and freezes synchronously before every readiness callback", async () => {
  const f = fixture(); await f.session.load();
  const local = vi.fn(() => { expect(f.session.canAcceptLocalInput()).toBe(false); return { ready: true }; });
  const editor = new SpotActivationEditor([f.session], f.read, local);
  expect(f.session.getSnapshot().activationFrozen).toBe(true);
  expect(() => f.session.edit({ ...f.current.qso, call: "LOST" })).toThrow("retained");
  await editor.registeredWith(idle); expect(f.session.canAcceptLocalInput()).toBe(true);
  const preparingReply = editor.observe(preparing());
  expect(f.session.getSnapshot().activationFrozen).toBe(true);
  expect(await preparingReply).toEqual({ operationId, barrierId, ready: true });
  expect(local).toHaveBeenCalledOnce(); expect(f.read).not.toHaveBeenCalled();
});

it.each(["generation", "draftId", "expectedRevision"] as const)("refuses a mismatched %s and retains the freeze until blocked is reconciled", async field => {
  const f = await ready();
  const changes = { generation: crypto.randomUUID(), draftId: "another", expectedRevision: 1 };
  const ack = await f.editor.observe(preparing({ [field]: changes[field] }));
  expect(ack?.ready).toBe(false); expect(f.session.canAcceptLocalInput()).toBe(false);
  await f.editor.observe(idle); expect(f.session.canAcceptLocalInput()).toBe(false);
  await f.editor.observe(terminal()); expect(f.session.canAcceptLocalInput()).toBe(true); expect(f.read).toHaveBeenCalledOnce();
});

it("keeps dirty text, unfinished fields and explicit power intent without flushing or discarding on prepare", async () => {
  const f = await ready(); f.session.edit({ ...f.session.getSnapshot().draft!, call: "MYTEXT" });
  f.session.setManualPower("42"); f.session.setLocalInputPending(true);
  const journal = copy(f.journal), requests = f.request.mock.calls.length;
  expect((await f.editor.observe(preparing()))?.ready).toBe(false);
  for (const operation of [() => f.session.edit({ ...f.current.qso, call: "OTHER" }), () => f.session.setManualPower("43"),
    () => f.session.resumeAutomaticPower(), () => f.session.keepLocal(), () => f.session.reset()]) expect(operation).toThrow("retained");
  for (const operation of [() => f.session.flush(), () => f.session.commit("save"), () => f.session.commit("clear"),
    () => f.session.retry(), () => f.session.reconcile(), () => f.session.useShared(), () => f.session.withWorkspaceRestore(vi.fn())])
    await expect(operation()).rejects.toThrow("retained");
  expect(await f.session.refresh()).toBe(false);
  expect(f.request).toHaveBeenCalledTimes(requests); expect(f.journal).toEqual(journal);
  await f.editor.observe(terminal());
  expect(f.session.getSnapshot()).toMatchObject({ draft: { call: "MYTEXT", txPower: "42" }, powerIntent: { action: "manual", value: "42" }, activationFrozen: false });
  expect(f.session.dirty).toBe(true); expect(await f.session.refresh()).toBe(false);
});

it("does not let an earlier Replace continue into Save after prepare, even when its receipt unlocks the ordinary action", async () => {
  const f = await ready(), gate = deferred<any>(), backend = f.request.getMockImplementation()!;
  f.session.edit({ ...f.session.getSnapshot().draft!, call: "MYTEXT" });
  f.request.mockImplementationOnce((method, params) => backend(method, params).then(result => gate.promise.then(() => result)));
  const saving = f.session.commit("save"); const rejected = expect(saving).rejects.toThrow("retained");
  expect((await f.editor.observe(preparing()))?.ready).toBe(false);
  await expect(f.editor.observe(terminal())).rejects.toThrow("incomplete");
  gate.resolve(null); await rejected;
  expect(f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply")).toHaveLength(1);
  expect(f.request.mock.calls[1][1].action).toBe("replace");
  expect(f.session.getSnapshot()).toMatchObject({ locked: false, activationFrozen: true, draft: { call: "MYTEXT" } });
  await f.editor.observe(terminal()); expect(f.session.canAcceptLocalInput()).toBe(true);
});

it("stops a queued second Replace at admission while retaining newer text", async () => {
  const f = await ready(), gate = deferred<any>(), backend = f.request.getMockImplementation()!;
  f.session.edit({ ...f.session.getSnapshot().draft!, call: "FIRST" });
  f.request.mockImplementationOnce((method, params) => backend(method, params).then(result => gate.promise.then(() => result)));
  const flushing = f.session.flush(); const rejected = expect(flushing).rejects.toThrow("retained");
  f.session.edit({ ...f.session.getSnapshot().draft!, call: "NEWER" });
  await f.editor.observe(preparing()); gate.resolve(null); await rejected;
  expect(f.session.getSnapshot().draft?.call).toBe("NEWER"); expect(f.session.dirty).toBe(true);
  expect(f.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply")).toHaveLength(1);
});

it("does not enter workspace restore after prepare overtakes its prerequisite draft flush", async () => {
  const f = await ready(), gate = deferred<any>(), backend = f.request.getMockImplementation()!, restore = vi.fn();
  f.session.edit({ ...f.current.qso, call: "MYTEXT" });
  f.request.mockImplementationOnce((method, params) => backend(method, params).then(result => gate.promise.then(() => result)));
  const restoring = f.session.withWorkspaceRestore(restore); const rejected = expect(restoring).rejects.toThrow("retained");
  expect((await f.editor.observe(preparing()))?.ready).toBe(false);
  gate.resolve(null); await rejected;
  expect(restore).not.toHaveBeenCalled(); expect(f.session.getSnapshot()).toMatchObject({ draft: { call: "MYTEXT" }, locked: false, activationFrozen: true });
  await f.editor.observe(terminal()); expect(f.session.canAcceptLocalInput()).toBe(true);
});

it("fences pre-prepare refresh and conflict-replacement reads without losing locally buffered text", async () => {
  const f = await ready(), held = deferred<any>();
  f.request.mockImplementationOnce(() => held.promise);
  const useShared = f.session.useShared(); const rejected = expect(useShared).rejects.toThrow("retained");
  await f.editor.observe(preparing()); held.resolve({ draft: { ...copy(f.current), revision: 1, qso: { ...f.current.qso, call: "LATE" } } }); await rejected;
  expect(f.session.getSnapshot().draft?.call).toBe("K1ABC"); expect(f.session.getSnapshot().activationFrozen).toBe(true);
  await f.editor.observe(terminal());
  const read = deferred<any>(); f.request.mockImplementationOnce(() => read.promise);
  const refreshing = f.session.refresh(); await f.editor.observe(preparing({ operationId: crypto.randomUUID() }));
  read.resolve({ draft: { ...copy(f.current), revision: 1, qso: { ...f.current.qso, call: "LATE" } } });
  expect(await refreshing).toBe(false); expect(f.session.getSnapshot().draft?.call).toBe("K1ABC");
});

it("preserves pending journals for manual recovery and never retries them during terminal reconciliation", async () => {
  const f = fixture(); await f.session.load(); f.session.edit({ ...f.current.qso, call: "PENDING" });
  f.request.mockRejectedValueOnce(new Error("lost reply")); await expect(f.session.flush()).rejects.toThrow("lost reply");
  const journal = copy(f.journal), count = f.request.mock.calls.length;
  const editor = new SpotActivationEditor([f.session], f.read); await editor.registeredWith(preparing());
  await editor.observe(terminal("uncertain"));
  expect(f.request).toHaveBeenCalledTimes(count); expect(f.session.getSnapshot().pending).toEqual(journal?.pending);
  expect(f.session.getSnapshot().draft?.call).toBe("PENDING"); expect(f.session.getSnapshot().activationFrozen).toBe(false);
});

it("does not replace invalid buffered fields when the canonical draft changed during a blocked activation", async () => {
  const f = await ready(); f.session.setLocalInputPending(true); await f.editor.observe(preparing());
  f.current.qso.call = "REMOTE"; f.current.revision++;
  await f.editor.observe(terminal());
  expect(f.session.getSnapshot()).toMatchObject({ draft: { call: "K1ABC" }, conflict: { qso: { call: "REMOTE" } }, activationFrozen: false });
});

it.each(["blocked", "confirmed", "failed", "uncertain"] as const)("keeps %s frozen until an independent current canonical read succeeds", async phase => {
  vi.useFakeTimers(); const f = await ready(), held = deferred<any>(); f.read.mockReturnValueOnce(held.promise);
  await f.editor.observe(preparing()); const finishing = f.editor.observe(terminal(phase));
  await vi.advanceTimersByTimeAsync(60000); expect(f.session.canAcceptLocalInput()).toBe(false);
  held.resolve({ draft: copy(f.current) }); await finishing;
  expect(f.session.canAcceptLocalInput()).toBe(true); expect(f.read).toHaveBeenCalledOnce();
  await f.editor.observe(terminal(phase)); expect(f.read).toHaveBeenCalledOnce();
});

it("keeps failed/unverified terminal reads frozen, ignores outcome.draft, and never automatically invokes activation", async () => {
  const f = await ready(); await f.editor.observe(preparing());
  f.read.mockRejectedValueOnce(new Error("read unavailable"));
  await expect(f.editor.observe({ ...terminal(), draft: f.current })).rejects.toThrow("unavailable");
  expect(f.session.canAcceptLocalInput()).toBe(false);
  f.read.mockResolvedValueOnce({ draft: { revision: 0, qso: f.current.qso } });
  await expect(f.editor.observe(terminal())).rejects.toThrow("verified"); expect(f.session.canAcceptLocalInput()).toBe(false);
  await f.editor.observe(terminal()); expect(f.session.canAcceptLocalInput()).toBe(true);
  expect(f.request.mock.calls.every(([method]) => method === "logbook_operator_draft")).toBe(true);
});

it("does not release a terminal operation while its native reservation remains active", async () => {
  const f = await ready(); await f.editor.observe(preparing());
  await f.editor.observe({ ...terminal("uncertain"), reservationActive: true });
  expect(f.session.canAcceptLocalInput()).toBe(false); expect(f.read).not.toHaveBeenCalled();
  await f.editor.observe({ ...terminal("uncertain"), reservationActive: false });
  expect(f.session.canAcceptLocalInput()).toBe(true); expect(f.read).toHaveBeenCalledOnce();
});

it("does not release on disposal, a different operation, or a terminal read superseded by a later native status", async () => {
  const f = await ready(), held = deferred<any>(); await f.editor.observe(preparing()); f.read.mockReturnValueOnce(held.promise);
  const finishing = f.editor.observe(terminal());
  await expect(f.editor.observe({ ...terminal(), operationId: crypto.randomUUID() })).rejects.toThrow("earlier");
  await f.editor.observe(preparing()); held.resolve({ draft: copy(f.current) }); await finishing;
  expect(f.session.canAcceptLocalInput()).toBe(false);
  const late = deferred<any>(); f.read.mockReturnValueOnce(late.promise); const pending = f.editor.observe(terminal());
  f.editor.dispose(); late.resolve({ draft: copy(f.current) }); await pending;
  expect(f.session.canAcceptLocalInput()).toBe(false);
});

it("blocks historical edit admission and never treats an existing clean contact editor as ready", async () => {
  const f = await ready(), contact = { ...copy(f.current), qso: { ...f.current.qso, id: "contact" } };
  const request = vi.fn(async () => ({ contact })), session = new LogbookContactSession(request, vi.fn());
  await session.open("contact");
  const editor = new SpotActivationEditor([f.session, session], f.read); await editor.registeredWith(idle);
  expect((await editor.observe(preparing()))?.ready).toBe(false);
  expect(() => session.edit({ ...contact.qso, call: "OTHER" })).toThrow("retained"); expect(() => session.cancel()).toThrow("retained");
  await expect(session.open("another")).rejects.toThrow("retained");
  for (const action of [() => session.save(), () => session.retry(), () => session.reconcile(), () => session.useCurrent()]) await expect(action()).rejects.toThrow("retained");
  await editor.observe(terminal()); expect(session.getSnapshot()).toMatchObject({ draft: { id: "contact", call: "K1ABC" }, activationFrozen: false });
  expect(request).toHaveBeenCalledOnce();
});

it("fences a contact-open reply that began before prepare and retains the separate freeze when its ordinary lock clears", async () => {
  const f = await ready(), held = deferred<any>(), request = vi.fn(() => held.promise), contact = new LogbookContactSession(request, vi.fn());
  const opening = contact.open("contact"); const rejected = expect(opening).rejects.toThrow("retained");
  const editor = new SpotActivationEditor([f.session, contact], f.read); await editor.registeredWith(idle);
  expect((await editor.observe(preparing()))?.ready).toBe(false);
  held.resolve({ contact: { ...copy(f.current), qso: { ...f.current.qso, id: "contact" } } }); await rejected;
  expect(contact.getSnapshot()).toMatchObject({ draft: null, locked: false, activationFrozen: true });
  await editor.observe(terminal()); expect(contact.canAcceptLocalInput()).toBe(true);
});

it("retains the contact activation freeze when an already-admitted update receipt closes its ordinary editor", async () => {
  const f = await ready(), held = deferred<any>(), saved = { ...copy(f.current), qso: { ...f.current.qso, id: "contact" } };
  const request = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === "logbook_contact") return { contact: copy(saved) };
    if (method === "logbook_contact_apply") return held.promise.then(() => ({ status: "applied", receipt: { mutation: params,
      contact: { ...copy(saved), revision: params.expectedRevision + 1 } } }));
    throw new Error(`Unexpected request ${method}`);
  });
  const contact = new LogbookContactSession(request, vi.fn()); await contact.open("contact");
  const updating = contact.save(); const editor = new SpotActivationEditor([f.session, contact], f.read);
  await editor.registeredWith(idle); expect((await editor.observe(preparing()))?.ready).toBe(false);
  held.resolve(null); await updating;
  expect(contact.getSnapshot()).toMatchObject({ draft: null, locked: false, activationFrozen: true });
  await editor.observe(terminal()); expect(contact.canAcceptLocalInput()).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});

it("registers a new editor during admitted tuning as frozen without requiring a preparing barrier", async () => {
  const f = fixture(); await f.session.load(); const editor = new SpotActivationEditor([f.session], f.read);
  await editor.registeredWith({ operationId, phase: "tuning", admitted: true }); expect(f.session.canAcceptLocalInput()).toBe(false);
  await editor.observe(idle); expect(f.session.canAcceptLocalInput()).toBe(false);
  await editor.observe(terminal("confirmed")); expect(f.session.canAcceptLocalInput()).toBe(true);
});

it("rejects malformed state/registration and an external close/Dock veto without unlocking or changing text", async () => {
  const f = fixture(); await f.session.load(); const editor = new SpotActivationEditor([f.session], f.read, () => ({ ready: false, reason: "Window is closing or docking." }));
  await expect(editor.registeredWith({ phase: "idle" })).rejects.toThrow("verified"); expect(f.session.canAcceptLocalInput()).toBe(false);
  await editor.registeredWith(idle); expect((await editor.observe(preparing()))).toMatchObject({ ready: false, reason: "Window is closing or docking." });
  await expect(editor.observe({ operationId, phase: "confirmed", tuneConfirmed: "yes", rotor: "none" })).rejects.toThrow("verified");
  expect(f.session.canAcceptLocalInput()).toBe(false); expect(f.session.getSnapshot().draft?.call).toBe("K1ABC");
  expect(validSpotActivationSnapshot({ operationId, phase: "preparing", barrier: { ...barrier(), expectedRevision: true } })).toBe(false);
});
