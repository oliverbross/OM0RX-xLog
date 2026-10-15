// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectSpotEditor } from "./spotEditorRegistration";
import { OperatorDraftSession } from "./operatorDraftSession";
const operationId = "00000000-0000-4000-8000-000000000002", generation = "00000000-0000-4000-8000-000000000001";
const canonical = { generation, revision: 0, qso: { id: "draft", call: "K1ABC" } };
const preparing = () => ({ operationId, phase: "preparing", barrier: { operationId, barrierId: "00000000-0000-4000-8000-000000000003", generation,
  draftId: "draft", expectedRevision: 0, deadline: Date.now() + 5000 } });
const terminal = () => ({ operationId, phase: "blocked", tuneConfirmed: false, rotor: "not_requested", reservationActive: false });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(0);
async function fixture() {
  const session = new OperatorDraftSession(async () => ({ draft: structuredClone(canonical) }), vi.fn()); await session.load();
  let snapshot: any = { phase: "idle", operationId: null, barrier: null }, wake!: () => void;
  const stop = vi.fn(), changed = vi.fn(), failed = vi.fn();
  const call = vi.fn(async (command: string, _params?: Record<string, unknown>) => {
    if (command === "spot_editor_state") return { draft: structuredClone(canonical) };
    if (["spot_editor_register", "spot_activation_snapshot", "spot_activation_reconcile"].includes(command)) return snapshot;
    if (command === "spot_editor_ack") expect(session.canAcceptLocalInput()).toBe(false);
    return undefined;
  });
  const adapter = { call, listen: vi.fn(async (callback: () => void): Promise<() => void> => { wake = callback; return stop; }) };
  const connect = (before = Promise.resolve(), instance: string = crypto.randomUUID()) => connectSpotEditor([session], () => ({ ready: true }), changed, failed, adapter, before, instance);
  return { session, call, adapter, connect, changed, failed, stop, wake: () => wake(), set snapshot(value: any) { snapshot = value; } };
}
it("subscribes before registration, freezes before acknowledgement, and sends only one ACK per barrier", async () => {
  const f = await fixture(), connection = f.connect(); expect(f.session.canAcceptLocalInput()).toBe(false); await settle();
  expect(f.session.canAcceptLocalInput()).toBe(true);
  expect(f.adapter.listen.mock.invocationCallOrder[0]).toBeLessThan(f.call.mock.invocationCallOrder[0]);
  f.snapshot = preparing(); f.wake(); await settle();
  expect(f.session.canAcceptLocalInput()).toBe(false);
  expect(f.call.mock.calls.filter(([method]) => method === "spot_editor_ack")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(6000);
  expect(f.call.mock.calls.filter(([method]) => method === "spot_editor_ack")).toHaveLength(1); expect(f.session.canAcceptLocalInput()).toBe(false);
  f.snapshot = terminal(); f.wake(); await settle(); expect(f.session.canAcceptLocalInput()).toBe(true);
  await connection.dispose(); expect(f.stop).toHaveBeenCalledOnce();
});
it("accepts the legitimate preparing/no-barrier registration race without issuing a premature ACK", async () => {
  const f = await fixture(); f.snapshot = { operationId, phase: "preparing", barrier: null };
  const connection = f.connect(); await settle(); expect(f.session.canAcceptLocalInput()).toBe(false);
  expect(f.failed).not.toHaveBeenCalled(); expect(f.call.mock.calls.some(([method]) => method === "spot_editor_ack")).toBe(false);
  f.snapshot = preparing(); f.wake(); await settle();
  expect(f.call.mock.calls.find(([method]) => method === "spot_editor_ack")?.[1]).toMatchObject({ ready: true });
  await connection.dispose();
});
it("retains invalid text through ready=false, active reservation and explicit status-only reconciliation", async () => {
  const f = await fixture(), connection = f.connect(); await settle(); f.session.setLocalInputPending(true);
  f.snapshot = preparing(); f.wake(); await settle();
  expect(f.call.mock.calls.find(([method]) => method === "spot_editor_ack")?.[1]).toMatchObject({ ready: false });
  f.snapshot = { ...terminal(), reservationActive: true }; f.wake(); await settle(); expect(f.session.canAcceptLocalInput()).toBe(false);
  f.snapshot = terminal(); await connection.reconcile(); expect(f.session.canAcceptLocalInput()).toBe(true);
  expect(await f.session.refresh()).toBe(false); expect(f.session.getSnapshot().draft?.call).toBe("K1ABC");
  expect(f.call.mock.calls.some(([method]) => method === "activate_spot")).toBe(false); await connection.dispose();
});
it("settles a confirmed Follow operation only after canonical editor reconciliation", async () => {
  const f = await fixture(), instance = "00000000-0000-4000-8000-000000000012", connection = f.connect(Promise.resolve(), instance); await settle();
  f.snapshot = { ...terminal(), phase: "confirmed", intent: "follow-radio", draftOnly: true };
  f.wake(); await settle();
  const canonicalRead = f.call.mock.calls.findIndex(([method]) => method === "spot_editor_state");
  const settlement = f.call.mock.calls.findIndex(([method]) => method === "operator_draft_follow_settled");
  expect(canonicalRead).toBeGreaterThanOrEqual(0); expect(settlement).toBeGreaterThan(canonicalRead);
  expect(f.call.mock.calls[settlement]).toEqual(["operator_draft_follow_settled", { instance, operationId }]);
  expect(f.session.canAcceptLocalInput()).toBe(true);
  await connection.dispose();
});
it("serializes a StrictMode replacement behind the old register completion and unregister", async () => {
  const f = await fixture(), held = deferred<any>(), original = f.call.getMockImplementation()!;
  f.call.mockImplementationOnce(() => held.promise);
  const firstId = "00000000-0000-4000-8000-000000000010", secondId = "00000000-0000-4000-8000-000000000011";
  const first = f.connect(Promise.resolve(), firstId); await settle(); const disposed = first.dispose();
  const second = f.connect(disposed, secondId); await settle();
  expect(f.call.mock.calls.filter(([method]) => method === "spot_editor_register")).toHaveLength(1);
  held.resolve({ phase: "idle", operationId: null, barrier: null }); await settle(); await disposed;
  expect(f.call.mock.calls.slice(0, 3)).toEqual([["spot_editor_register", { instance: firstId }], ["spot_editor_unregister", { instance: firstId }], ["spot_editor_register", { instance: secondId }]]);
  expect(original).toBeDefined(); await second.dispose();
});
it("cleans a late listener and never registers or adopts a disposed editor", async () => {
  const f = await fixture(), held = deferred<() => void>(); f.adapter.listen.mockReturnValueOnce(held.promise);
  const connection = f.connect(); await settle(); const disposal = connection.dispose(); held.resolve(f.stop); await disposal;
  expect(f.stop).toHaveBeenCalledOnce(); expect(f.call).not.toHaveBeenCalled(); expect(f.changed).not.toHaveBeenCalled(); expect(f.session.canAcceptLocalInput()).toBe(false);
});
