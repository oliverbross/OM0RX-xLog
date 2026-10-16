import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
import { requestQSODataQuality, requestQSOCorrectionPreview } from "./worker";

const scope = { contactID: "11111111-1111-1111-1111-111111111111", generation: "22222222-2222-2222-2222-222222222222", expectedRevision: 7 };
const evidence = { field: "dxcc", value: "517", source: "suppliedCTYReference", date: null,
  dateRole: "referenceSourceDate", rawDate: null, referenceSource: "bundled_cty", referenceVersion: null };
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
  it("sends only the exact CTY evidence and accepts one read-only DXCC preview", async () => {
    const preview = { contactID: scope.contactID, expectedRevision: 7, observedRevision: 7, field: "dxcc" as const,
      retainedValue: "305", proposedValue: "517", changeCount: 1 as const, diffStatus: "complete" as const };
    invoke.mockResolvedValue({ ok: true, result: { generation: scope.generation, read_only: true, status: "reviewed",
      scope: "ctyReferenceDXCCOnly", evidence, preview } });
    expect((await requestQSOCorrectionPreview(scope, evidence)).preview).toEqual(preview);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("worker_request", { request: { id: expect.any(String),
      method: "logbook_correction_preview", params: { ...scope, evidence } } });
  });
  it("rejects broadened or mismatched correction previews", async () => {
    await expect(requestQSOCorrectionPreview({ ...scope, conflictID: scope.contactID }, evidence)).rejects.toThrow("Invalid correction preview scope");
    await expect(requestQSOCorrectionPreview(scope, { ...evidence, source: "storedFieldOriginUnknown" })).rejects.toThrow("Invalid correction preview scope");
    expect(invoke).not.toHaveBeenCalled();
    for (const result of [
      { generation: scope.generation, read_only: true, status: "reviewed", scope: "ctyReferenceDXCCOnly", evidence,
        preview: { contactID: scope.contactID, expectedRevision: 7, observedRevision: 7, field: "country", retainedValue: "", proposedValue: "X", changeCount: 1, diffStatus: "complete" } },
      { generation: scope.generation, read_only: true, status: "reviewed", scope: "ctyReferenceDXCCOnly", evidence: { ...evidence, value: "999" },
        preview: { contactID: scope.contactID, expectedRevision: 7, observedRevision: 7, field: "dxcc", retainedValue: "305", proposedValue: "999", changeCount: 1, diffStatus: "complete" } },
    ]) {
      invoke.mockResolvedValue({ ok: true, result });
      await expect(requestQSOCorrectionPreview(scope, evidence)).rejects.toThrow("evidence changed");
    }
  });
});
