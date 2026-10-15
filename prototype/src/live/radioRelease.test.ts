import { expect, it, vi } from "vitest";
import { RadioReleaseSession, type ReleaseReceipt, type ReleaseTarget } from "./radioRelease";
const target: ReleaseTarget = { provider: "direct_agent", selection_generation: 2, selection_id: "00000000-0000-4000-8000-000000000002", worker_generation: 7, connection_generation: 4 };
function fixture() {
  let retained: string[] = [];
  const receipts = new Map<string, ReleaseReceipt>();
  const request = vi.fn(async (params: Record<string, any>): Promise<any> => {
    if (params.action === "snapshot") return { target, receipts: [...receipts.values()].filter(r => r.status === "unknown") };
    if (params.action === "receipt") return receipts.get(params.operation_id) ?? null;
    if (params.action === "review") { const receipt = { ...receipts.get(params.operation_id)!, status: "reviewed" as const }; receipts.set(params.operation_id, receipt); return receipt; }
    expect(retained).toContain(params.operation_id);
    const receipt: ReleaseReceipt = { operation_id: params.operation_id, target: params.target, status: "acknowledged" };
    receipts.set(params.operation_id, receipt); return receipt;
  });
  const journal = { read: () => retained, write: (ids: string[]) => { retained = ids; } };
  return { request, journal, receipts, session: new RadioReleaseSession(request, journal) };
}
it("journals before dispatch and distinguishes Agent acknowledgement from confirmation", async () => {
  const { session, request } = fixture();
  expect(await session.cancel("direct_agent")).toEqual({ accepted: true, confirmed: false });
  expect(session.getSnapshot().pending).toEqual([]);
  expect(session.getSnapshot().message).toContain("release remains unconfirmed");
  expect(request.mock.calls.filter(([p]) => p.action === "cancel")).toHaveLength(1);
});
it("recovers a lost reply by receipt check after remount without replaying Cancel", async () => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation(async params => { const value = await normal(params); if (params.action === "cancel") throw new Error("reply lost"); return value; });
  await expect(f.session.cancel("direct_agent")).rejects.toThrow("reply lost");
  const [id] = f.session.getSnapshot().pending;
  const remounted = new RadioReleaseSession(f.request, f.journal); await remounted.refresh();
  expect(f.request).toHaveBeenCalledWith({ action: "receipt", operation_id: id });
  expect(remounted.getSnapshot().pending).toEqual([]);
  expect(f.request.mock.calls.filter(([p]) => p.action === "cancel")).toHaveLength(1);
});
it("allows a new explicit Cancel despite an unknown release and old receipt resolution preserves newer feedback", async () => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  let first = true;
  f.request.mockImplementation(async params => {
    const value = await normal(params);
    if (params.action === "cancel" && first) { first = false; value.status = "unknown"; }
    return value;
  });
  await expect(f.session.cancel("direct_agent")).rejects.toThrow("unknown");
  const [old] = f.session.getSnapshot().pending;
  await f.session.cancel("direct_agent"); const message = f.session.getSnapshot().message;
  await f.session.review(old);
  expect(f.session.getSnapshot().message).toEqual(message);
  expect(f.request.mock.calls.filter(([p]) => p.action === "cancel")).toHaveLength(2);
});
it("keeps a newer pre-dispatch failure ahead of an older receipt resolution", async () => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation(async params => {
    const value = await normal(params);
    if (params.action === "cancel") value.status = "unknown";
    return value;
  });
  await expect(f.session.cancel("direct_agent")).rejects.toThrow("unknown");
  const [old] = f.session.getSnapshot().pending;
  f.request.mockImplementation(async params => params.action === "snapshot"
    ? { target: null, receipts: [...f.receipts.values()].filter(receipt => receipt.status === "unknown") }
    : normal(params));
  await expect(f.session.cancel("direct_agent")).rejects.toThrow("selected radio");
  const message = f.session.getSnapshot().message;
  await f.session.review(old);
  expect(f.session.getSnapshot().message).toEqual(message);
});
it("cannot discard an identity while native admission is in flight and recovers its terminal receipt", async () => {
  let retained: string[] = [], admit!: () => void;
  const gate = new Promise<void>(resolve => { admit = resolve; });
  const receipts = new Map<string, ReleaseReceipt>();
  const request = vi.fn(async (params: Record<string, any>): Promise<any> => {
    if (params.action === "snapshot") return { target, receipts: [] };
    if (params.action === "receipt") return receipts.get(params.operation_id) ?? null;
    await gate;
    receipts.set(params.operation_id, { operation_id: params.operation_id, target: params.target, status: "acknowledged" });
    throw new Error("reply lost");
  });
  const journal = { read: () => retained, write: (ids: string[]) => { retained = ids; } };
  const session = new RadioReleaseSession(request, journal), cancel = session.cancel("direct_agent");
  await vi.waitFor(() => expect(session.getSnapshot().pending).toHaveLength(1));
  const [id] = session.getSnapshot().pending;
  await expect(session.check(id)).rejects.toThrow("still being admitted");
  expect(session.getSnapshot().pending).toEqual([id]);
  admit(); await expect(cancel).rejects.toThrow("reply lost");
  const remounted = new RadioReleaseSession(request, journal); await remounted.refresh();
  expect(remounted.getSnapshot().pending).toEqual([]);
  expect(request.mock.calls.filter(([params]) => params.action === "cancel")).toHaveLength(1);
});
it("rejects mismatched receipts and failed renderer journal before transport", async () => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation(async params => { const value = await normal(params); return params.action === "cancel" ? { ...value, operation_id: crypto.randomUUID() } : value; });
  await expect(f.session.cancel("direct_agent")).rejects.toThrow("verified"); expect(f.session.getSnapshot().pending).toHaveLength(1);
  const blocked = new RadioReleaseSession(f.request, { read: () => [], write: () => { throw new Error("storage unavailable"); } });
  const before = f.request.mock.calls.filter(([p]) => p.action === "cancel").length;
  await expect(blocked.cancel("direct_agent")).rejects.toThrow("storage unavailable");
  expect(f.request.mock.calls.filter(([p]) => p.action === "cancel")).toHaveLength(before);
});
it("rejects a changed provider and uses the native action-boundary target despite stale renderer telemetry", async () => {
  const f = fixture();
  await expect(f.session.cancel("direct_flex_lan")).rejects.toThrow("selected radio");
  await f.session.cancel("direct_agent", { selection: { provider: "direct_agent", generation: 2, selection_id: target.selection_id }, radio: { snapshot: { generation: 3 } } } as any);
  expect(f.request.mock.calls.find(([p]) => p.action === "cancel")![0].target).toEqual(target);
});
