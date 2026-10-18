import { expect, it, vi } from "vitest";
import { activationMessage, SpotActivationClient } from "./spotActivationClient";
const operationId = "00000000-0000-4000-8000-000000000001";
const token = { sourceEpoch: "00000000-0000-4000-8000-000000000002", spotVersion: "00000000-0000-4000-8000-000000000003" };
const report = { id: "report", activation: token, frequencyKHz: -100, mode: "arbitrary", callsign: "UNTRUSTED" };
const result = (phase: "confirmed" | "uncertain" | "blocked" = "confirmed", reservationActive = false) => ({ operationId, phase, reservationActive, tuneConfirmed: phase === "confirmed", rotor: "not_requested" });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

it("submits only native-issued opaque identity, never renderer tuning or QSO fields", async () => {
  const call = vi.fn().mockResolvedValue(result()), uuid = vi.fn(() => operationId), client = new SpotActivationClient(call, uuid);
  await client.activate(report);
  expect(call).toHaveBeenCalledExactlyOnceWith("activate_spot", { operationId, sourceEpoch: token.sourceEpoch, spotId: "report", spotVersion: token.spotVersion });
  expect(uuid).toHaveBeenCalledOnce();
});
it("uses the exact opportunity command and recovers lost replies without resubmitting or claiming a tune", async () => {
  const confirmed = { ...result(), draftOnly:true, tuneConfirmed:false };
  const call = vi.fn(async (command: string) => { if (command === "activate_opportunity") throw new Error("lost reply"); return confirmed; });
  const client = new SpotActivationClient(call, () => operationId, "activate_opportunity");
  await client.activate(report);
  expect(call).toHaveBeenNthCalledWith(1,"activate_opportunity",{ operationId, sourceEpoch:token.sourceEpoch, spotId:report.id, spotVersion:token.spotVersion });
  expect(call).toHaveBeenLastCalledWith("spot_activation_reconcile",{ operationId });
  expect(activationMessage(client.getSnapshot().status)).toContain("no station command was sent");
  expect(call.mock.calls.filter(([command]) => command.startsWith("activate_"))).toHaveLength(1);
});
it("does not allocate an operation for an unannotated, malformed, or removed identity", async () => {
  const call = vi.fn(), uuid = vi.fn(() => operationId), client = new SpotActivationClient(call, uuid);
  for (const spot of [{ id: "report" }, { ...report, activation: { ...token, spotVersion: "bad" } }, { ...report, id: "" }])
    await expect(client.activate(spot)).rejects.toThrow("Refresh");
  expect(call).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
});
it("automatically reconciles one operation after a lost acknowledgement without replaying activation", async () => {
  const call = vi.fn(async (command: string) => { if (command === "activate_spot") throw new Error("IPC lost"); return result("uncertain"); });
  const uuid = vi.fn(() => operationId), client = new SpotActivationClient(call, uuid);
  await client.activate(report);
  expect(call).toHaveBeenLastCalledWith("spot_activation_reconcile", { operationId });
  expect(call.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1); expect(uuid).toHaveBeenCalledOnce();
  expect(client.getSnapshot()).toMatchObject({ checked: false, status: { phase: "idle" } });
});
it("rejects overlapping clicks and never lets a late activation reply roll a verified terminal status backwards", async () => {
  const held = deferred<any>();
  const call = vi.fn((command: string) => command === "activate_spot" ? held.promise : Promise.resolve(result()));
  const client = new SpotActivationClient(call, () => operationId);
  const activating = client.activate(report); await expect(client.activate(report)).rejects.toThrow("existing");
  await client.refresh(); held.resolve({ operationId, phase: "tuning" }); await activating;
  expect(client.getSnapshot().status?.phase).toBe("confirmed"); expect(call.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1);
});
it("becomes ready after native retirement even when the older activation reply is stale", async () => {
  const held = deferred<any>();
  const call = vi.fn((command: string) => command === "activate_spot" ? held.promise : Promise.resolve(result("uncertain")));
  const client = new SpotActivationClient(call, () => operationId);
  const activating = client.activate(report);
  expect(client.canActivate()).toBe(false);
  await client.refresh();
  expect(client.canActivate()).toBe(false);
  held.resolve(result("uncertain", true));
  await activating;
  expect(client.getSnapshot().status?.phase).toBe("idle");
  expect(client.canActivate()).toBe(true);
});
it("does not reuse an old operation's checked permission for a newly observed uncertain operation", async () => {
  const call = vi.fn().mockResolvedValue(result("uncertain")), client = new SpotActivationClient(call, () => operationId);
  await client.activate(report); await client.reconcile();
  const next = { ...result("uncertain", true), operationId: crypto.randomUUID() }; call.mockResolvedValue(next);
  await client.refresh(); expect(client.getSnapshot().checked).toBe(false);
  await expect(client.activate(report)).rejects.toThrow("existing");
});
it("terminal uncertain receipts with an explicitly closed reservation never block a new report after remount", async () => {
  const nextId = crypto.randomUUID();
  const call = vi.fn(async (command: string) => command === "activate_spot" ? { ...result(), operationId: nextId } : result("uncertain"));
  const client = new SpotActivationClient(call, () => nextId);
  await client.refresh(); expect(client.getSnapshot().checked).toBe(false);
  await client.activate({ ...report, id: "new-report" });
  expect(call.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1);
});
it("automatically retires a closed uncertain receipt and ignores its obsolete snapshots", async () => {
  const nextId = crypto.randomUUID(); let clicks = 0;
  const call = vi.fn(async (command: string) => {
    if (command === "activate_spot") { if (++clicks === 1) throw Error("lost reply"); return { ...result(), operationId: nextId }; }
    return result("uncertain");
  });
  const uuid = vi.fn().mockReturnValueOnce(operationId).mockReturnValue(nextId), client = new SpotActivationClient(call, uuid);
  await client.activate(report);
  expect(client.getSnapshot().status?.phase).toBe("idle");
  await client.refresh(); expect(client.getSnapshot().status?.phase).toBe("idle");
  await client.activate({ ...report, id: "new-report" });
  expect(clicks).toBe(2); expect(call.mock.calls.filter(([command]) => command === "spot_activation_reconcile")).toHaveLength(1);
});
it("failed automatic reconciliation cannot unlock an unverified reservation or manufacture permission", async () => {
  const call = vi.fn(async (command: string) => {
    if (command === "spot_activation_reconcile") throw Error("receipt unreadable");
    return result("uncertain", true);
  });
  const client = new SpotActivationClient(call, () => operationId);
  await client.refresh();
  await expect(client.activate(report)).rejects.toThrow("existing");
  expect(call.mock.calls.every(([command]) => !command.startsWith("activate_"))).toBe(true);
});
it("keeps active reservations/miscorrelated replies fenced and discards disposed results", async () => {
  const call = vi.fn().mockResolvedValue(result("uncertain", true)), client = new SpotActivationClient(call, () => operationId);
  await client.activate(report); await expect(client.activate(report)).rejects.toThrow("existing");
  call.mockResolvedValue({ ...result(), operationId: crypto.randomUUID() }); await client.refresh();
  expect(client.getSnapshot().error).toContain("correlated");
  const held = deferred<any>(); call.mockReturnValue(held.promise); const refreshing = client.refresh(); client.dispose(); held.resolve(result()); await refreshing;
  expect(client.getSnapshot().status).toMatchObject({ phase: "uncertain", reservationActive: true });
});
