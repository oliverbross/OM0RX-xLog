import { beforeEach, expect, it, vi } from "vitest";
import { ContestExportSaveOwner, nativeContestExportSave, nativeSavePrepared, validateContestExportSaveResult,
  type ContestExportSavePrepared } from "./contestExportSave";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestPreparedExport } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const prepared: ContestPreparedExport = { artifactID: "10000000-0000-4000-8000-000000000001", sessionID: "20000000-0000-4000-8000-000000000002",
  workspaceGeneration: "30000000-0000-4000-8000-000000000003", revision: 7, format: "cabrillo", inputSchemaVersion: "1",
  formatterVersion: "pilot-2", generatedAtUTC: "2026-10-18T00:00:00.000Z", qsoCount: 2, totalPoints: 6,
  multiplierCount: 2, claimedScore: 12, byteLength: 450, sha256: "a".repeat(64), chunkLimit: 64, expiresAfterSeconds: 60 };

beforeEach(() => native.invoke.mockReset());

it("maps the worker artifact coordinate to the exact native prepared DTO", () => {
  expect(nativeSavePrepared(prepared)).toEqual({ artifactID: prepared.artifactID, sessionID: prepared.sessionID,
    workspaceGeneration: prepared.workspaceGeneration, revision: 7, byteLength: 450, sha256: "a".repeat(64), format: "cabrillo" });
});

it("strips worker presentation metadata before invoking the strict native save contract", async () => {
  const expected = nativeSavePrepared(prepared);
  native.invoke.mockResolvedValue({ status: "cancelled", artifactID: prepared.artifactID, sha256: prepared.sha256 });
  await expect(nativeContestExportSave({ ...expected, filename: "OM0RX-CQ-WW.log" } as ContestExportSavePrepared))
    .resolves.toMatchObject({ status: "cancelled" });
  expect(native.invoke).toHaveBeenCalledWith("contest_export_save", { prepared: expected });
});

it("forwards an owner action coordinate so native save can acknowledge across the modal boundary", async () => {
  const expected = nativeSavePrepared(prepared), completion = { operatingContext: "40000000-0000-4000-8000-000000000004",
    sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration,
    requestID: "50000000-0000-4000-8000-000000000005", projectionRevision: 6 };
  native.invoke.mockResolvedValue({ status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "log.log" });
  await nativeContestExportSave(expected, completion);
  expect(native.invoke).toHaveBeenCalledWith("contest_export_save", { prepared: expected, completion });
});

it("strictly validates correlated native outcomes", () => {
  const expected = nativeSavePrepared(prepared);
  expect(validateContestExportSaveResult({ status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "log.cbr" }, expected).status).toBe("saved");
  expect(validateContestExportSaveResult({ status: "cancelled", artifactID: prepared.artifactID, sha256: prepared.sha256 }, expected).status).toBe("cancelled");
  expect(validateContestExportSaveResult({ status: "failed", artifactID: prepared.artifactID, sha256: prepared.sha256, message: "Could not save." }, expected).status).toBe("failed");
  for (const malformed of [
    { status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "../log.cbr" },
    { status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "log.cbr", message: "extra" },
    { status: "cancelled", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "log.cbr" },
    { status: "failed", artifactID: prepared.artifactID, sha256: "b".repeat(64), message: "Could not save." },
  ]) expect(() => validateContestExportSaveResult(malformed, expected)).toThrow(/malformed or mismatched/);
});

it("marks before invoking, survives remount, and never auto-retries an unknown outcome", async () => {
  const storage = new MemoryContestRecoveryStorage(); let resolve!: () => void;
  const gate = new Promise<void>(done => { resolve = done; });
  const adapter = vi.fn(async () => { await gate; throw new Error("reply lost"); });
  const release = vi.fn(async () => ({})), owner = new ContestExportSaveOwner(adapter, storage);
  const saving = owner.save(prepared, release);
  expect(owner.snapshot().phase).toBe("saving");
  expect(new ContestExportSaveOwner(adapter, storage).snapshot().phase).toBe("unknown");
  resolve(); await saving;
  expect(owner.snapshot().phase).toBe("unknown"); expect(adapter).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled();
  await owner.save(prepared, release); expect(adapter).toHaveBeenCalledTimes(1);
  owner.acknowledgeUnknown(); expect(owner.snapshot().phase).toBe("idle"); expect(release).toHaveBeenCalledWith(prepared);
});

it("releases known saved and cancelled outcomes but retains failed artifacts for explicit retry", async () => {
  const storage = new MemoryContestRecoveryStorage(), release = vi.fn(async () => ({}));
  const results = [
    { status: "failed", artifactID: prepared.artifactID, sha256: prepared.sha256, message: "Disk full." } as const,
    { status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "log.cbr" } as const,
  ];
  const adapter = vi.fn(async () => results.shift()!); const owner = new ContestExportSaveOwner(adapter, storage);
  await owner.save(prepared, release); expect(owner.snapshot().phase).toBe("failed"); expect(release).not.toHaveBeenCalled();
  await owner.retry({ sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration }); expect(owner.snapshot().phase).toBe("saved"); expect(adapter).toHaveBeenCalledTimes(2); expect(release).toHaveBeenCalledWith(prepared);
  const cancelRelease = vi.fn(async () => ({}));
  const cancel = new ContestExportSaveOwner(async () => ({ status: "cancelled", artifactID: prepared.artifactID, sha256: prepared.sha256 }), new MemoryContestRecoveryStorage());
  await cancel.save(prepared, cancelRelease); expect(cancel.snapshot().phase).toBe("cancelled"); expect(cancelRelease).toHaveBeenCalledWith(prepared);
});

it("retains origin scope and refuses a failed artifact retry from another contest", async () => {
  const result = { status: "failed", artifactID: prepared.artifactID, sha256: prepared.sha256, message: "Artifact expired." } as const;
  const adapter = vi.fn(async () => result), release = vi.fn(async () => ({}));
  const owner = new ContestExportSaveOwner(adapter, new MemoryContestRecoveryStorage());
  await owner.save(prepared, release);
  expect(owner.snapshot()).toMatchObject({ phase: "failed", scope: { sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration } });
  await owner.retry({ sessionID: "40000000-0000-4000-8000-000000000004", workspaceGeneration: prepared.workspaceGeneration });
  expect(adapter).toHaveBeenCalledTimes(1);
  owner.discardKnown();
  expect(owner.snapshot().phase).toBe("idle"); expect(release).toHaveBeenCalledWith(prepared);
});

it("restores a pending marker with its original session and generation scope", () => {
  const storage = new MemoryContestRecoveryStorage();
  storage.setItem("xlog.contesting.export-save.pending.v1", JSON.stringify({ version: 1, artifactID: prepared.artifactID,
    sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration, revision: prepared.revision,
    sha256: prepared.sha256, format: prepared.format }));
  const owner = new ContestExportSaveOwner(vi.fn(), storage);
  expect(owner.snapshot()).toEqual({ phase: "unknown", scope: { sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration } });
});

it("treats a malformed native reply as unknown and cannot report saved", async () => {
  const expected = nativeSavePrepared(prepared), release = vi.fn(async () => ({}));
  const owner = new ContestExportSaveOwner(async value => validateContestExportSaveResult(
    { status: "saved", artifactID: value.artifactID, sha256: value.sha256, filename: "log.cbr", unexpected: true }, expected),
    new MemoryContestRecoveryStorage());
  await owner.save(prepared, release);
  expect(owner.snapshot().phase).toBe("unknown"); expect(release).not.toHaveBeenCalled();
});
