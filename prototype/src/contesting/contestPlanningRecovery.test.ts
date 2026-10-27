import { expect, it, vi } from "vitest";
import { ContestServerError } from "./client";
import { planningMutation, planningRecoveryKey } from "./contestPlanningRecovery";

const scope = { sessionID: "disposable-session", workspaceGeneration: "disposable-workspace" };
const operationID = "00000000-0000-4000-8000-000000000001";
const method = "contest_message_bank_save";
function params(extra: Record<string, unknown> = {}) {
  return { ...scope, expectedRevision: 4, draftID: "draft-original", operationID,
    bank: { name: "Weekend messages", macros: [] }, ...extra };
}
function storage(): Storage {
  const entries = new Map<string, string>();
  return { get length() { return entries.size; }, clear: () => entries.clear(),
    getItem: key => entries.get(key) ?? null, key: index => [...entries.keys()][index] ?? null,
    removeItem: key => { entries.delete(key); }, setItem: (key, value) => { entries.set(key, value); } };
}
function completed(id = operationID, actions: unknown[] = []) {
  return { operationID: id, projection: { ...scope, revision: 5 }, actions, waveResult: { banks: [] } };
}
async function loseReply(store: Storage) {
  const request = vi.fn(async (name: string) => {
    if (name === "contest_operation_receipt") return { found: false, result: null };
    throw new ContestServerError("transport_lost", "Reply was lost", "uncertain");
  });
  await expect(planningMutation(scope, method, params(), request, store)).rejects.toThrow("Reply was lost");
  return request;
}

it("retains an uncertain operation and retries the original identity and original payload", async () => {
  const store = storage();
  await loseReply(store);
  const originalRaw = store.getItem(planningRecoveryKey(scope))!, saved = JSON.parse(originalRaw);
  expect(saved.params.operationID).toBe(operationID);
  const request = vi.fn(async (name: string, _values: Record<string, unknown>): Promise<unknown> =>
    name === "contest_operation_receipt" ? { found: false, result: null } : completed());
  const result = await planningMutation(scope, method, params({ operationID: "00000000-0000-4000-8000-000000000002",
    expectedRevision: 99, draftID: "newer-draft", nowUTC: "2026-10-28T00:00:00Z" }), request, store);
  expect(request.mock.calls).toEqual([
    ["contest_operation_receipt", { sessionID: scope.sessionID, operationID }],
    [method, saved.params],
  ]);
  expect(result.operationID).toBe(operationID);
  expect(store.getItem(planningRecoveryKey(scope))).toBeNull();
});

it("recovers an existing host receipt without sending the mutation again", async () => {
  const store = storage();
  await loseReply(store);
  const receipt = completed(), request = vi.fn(async () => ({ found: true, result: receipt }));
  expect(await planningMutation(scope, null, {}, request, store)).toEqual(receipt);
  expect(request.mock.calls).toHaveLength(1);
  expect(request).toHaveBeenCalledWith("contest_operation_receipt", { sessionID: scope.sessionID, operationID });
  expect(store.getItem(planningRecoveryKey(scope))).toBeNull();
});

it("blocks a changed intent while preserving the original uncertain record", async () => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope)), request = vi.fn(async () => completed());
  await expect(planningMutation(scope, method, params({ bank: { name: "Different bank", macros: [] } }), request, store))
    .rejects.toThrow("Recover the previous planning action");
  expect(request).not.toHaveBeenCalled();
  expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
});

it.each(["{malformed", JSON.stringify({ version: 1, method, params: { ...params(), workspaceGeneration: "foreign" }, intent: "forged" })])(
  "preserves unreadable or foreign recovery bytes and sends no replacement request: %s", async raw => {
    const store = storage(), request = vi.fn(async () => completed());
    store.setItem(planningRecoveryKey(scope), raw);
    await expect(planningMutation(scope, method, params(), request, store)).rejects.toThrow(/recovery/);
    expect(request).not.toHaveBeenCalled();
    expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
  });

it("preserves the pending record when a confirmed rejection cannot be archived", async () => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope)), originalSet = store.setItem;
  store.setItem = (key, value) => { if (!key.includes("/rejected/")) originalSet(key, value); };
  const rejection = new ContestServerError("stale_revision", "Refresh contest first", "confirmed");
  const request = vi.fn(async (name: string) => {
    if (name === "contest_operation_receipt") return { found: false, result: null };
    throw rejection;
  });
  await expect(planningMutation(scope, null, {}, request, store)).rejects.toBe(rejection);
  expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
  expect(store.getItem(`${planningRecoveryKey(scope)}/rejected/${operationID}`)).toBeNull();
});

it("archives a confirmed rejection before clearing the pending record", async () => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope)), rejection = new ContestServerError("invalid_request", "Bank was rejected", "confirmed");
  const request = vi.fn(async (name: string) => {
    if (name === "contest_operation_receipt") return { found: false, result: null };
    throw rejection;
  });
  await expect(planningMutation(scope, null, {}, request, store)).rejects.toBe(rejection);
  expect(store.getItem(planningRecoveryKey(scope))).toBeNull();
  expect(store.getItem(`${planningRecoveryKey(scope)}/rejected/${operationID}`)).toBe(raw);
});

it("keeps an uncertain mutation pending when the receipt lookup itself is rejected", async () => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope));
  const rejection = new ContestServerError("session_unavailable", "Receipt cannot be read", "confirmed");
  const request = vi.fn(async () => { throw rejection; });
  await expect(planningMutation(scope, null, {}, request, store)).rejects.toBe(rejection);
  expect(request.mock.calls).toHaveLength(1);
  expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
  expect(store.getItem(`${planningRecoveryKey(scope)}/rejected/${operationID}`)).toBeNull();
});

it("rejects a receipt containing output actions and retains the original recovery record", async () => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope));
  const request = vi.fn(async () => ({ found: true, result: completed(operationID, [{ kind: "function_key", key: "F1" }]) }));
  await expect(planningMutation(scope, null, {}, request, store)).rejects.toThrow("receipt could not be verified");
  expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
  expect(request.mock.calls).toHaveLength(1);
});

it.each([undefined, {}, ""])("rejects malformed output-action evidence instead of treating it as empty: %s", async actions => {
  const store = storage();
  await loseReply(store);
  const raw = store.getItem(planningRecoveryKey(scope));
  const request = vi.fn(async () => ({ found: true, result: { ...completed(), actions } }));
  await expect(planningMutation(scope, null, {}, request, store)).rejects.toThrow("receipt could not be verified");
  expect(store.getItem(planningRecoveryKey(scope))).toBe(raw);
});

it("does not send a mutation if persisting its recovery record fails", async () => {
  const store = storage(), request = vi.fn(async () => completed());
  store.setItem = () => undefined;
  await expect(planningMutation(scope, method, params(), request, store)).rejects.toThrow("no operation was sent");
  expect(request).not.toHaveBeenCalled();
});
