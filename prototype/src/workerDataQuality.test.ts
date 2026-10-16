import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
import { requestQSODataQuality } from "./worker";

const scope = { contactID: "11111111-1111-1111-1111-111111111111", generation: "22222222-2222-2222-2222-222222222222", expectedRevision: 7 };
beforeEach(() => invoke.mockReset());
describe("read-only QSO data-quality bridge", () => {
  it("sends only the exact retained scope and preserves explicit unknowns", async () => {
    const report = { contactID: scope.contactID, contactRevision: 7, referenceComparison: null, retainedPowerObservation: null };
    invoke.mockResolvedValue({ ok: true, result: { generation: scope.generation, read_only: true, data_quality: report } });
    expect((await requestQSODataQuality({ ...scope, refresh_provider: true } as typeof scope)).data_quality).toEqual(report);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("worker_request", {
      request: { id: expect.any(String), method: "logbook_data_quality", params: scope },
    });
  });
  it("forwards only a selected retained conflict ID, with no resolution action", async () => {
    const conflictID = "33333333-3333-3333-3333-333333333333";
    invoke.mockResolvedValue({ ok: true, result: { generation: scope.generation, read_only: true, data_quality: null } });
    await requestQSODataQuality({ ...scope, conflictID });
    expect(invoke.mock.calls[0][1].request.params).toEqual({ ...scope, conflictID });
  });
  it("rejects malformed scope before invoking the desktop bridge", async () => {
    for (const change of [{ contactID: "bad" }, { generation: "bad" }, { expectedRevision: -1 }, { expectedRevision: 1.1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { conflictID: "bad" }]) {
      await expect(requestQSODataQuality({ ...scope, ...change })).rejects.toThrow("Invalid contact review scope");
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not expose findings for mismatched contact, revision, generation or write authority", async () => {
    for (const result of [
      { generation: scope.generation, read_only: true, data_quality: { contactID: scope.contactID, contactRevision: 8 } },
      { generation: scope.generation, read_only: true, data_quality: { contactID: scope.generation, contactRevision: 7 } },
      { generation: scope.contactID, read_only: true, data_quality: null },
      { generation: scope.generation, read_only: false, data_quality: null },
      { read_only: true, data_quality: null },
      { generation: scope.generation, read_only: true, data_quality: { contactID: 42, contactRevision: 7 } },
    ]) {
      invoke.mockResolvedValue({ ok: true, result });
      await expect(requestQSODataQuality(scope)).rejects.toThrow("context changed");
    }
  });
  it("returns stale statuses without retrying or refreshing anything", async () => {
    for (const result of [{ generation: scope.contactID, status: "workspace_changed" }, { generation: scope.generation, read_only: true, status: "contact_changed" }]) {
      invoke.mockResolvedValue({ ok: true, result });
      expect(await requestQSODataQuality(scope)).toEqual(result);
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
