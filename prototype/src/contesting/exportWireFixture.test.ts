import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, ContestServerError } from "./client";
import type {
  ContestExportChunk, ContestExportPrepareRequest, ContestExportReadRequest, ContestPreparedExport, ContestRequest, ContestWorkerResponse,
} from "./types";

type ExportFixture = {
  schemaVersion: number;
  requests: { prepare: ContestExportPrepareRequest; reads: Array<Record<string, unknown>>; release: Record<string, unknown> };
  responses: {
    prepare: ContestWorkerResponse<ContestPreparedExport>; replay: ContestWorkerResponse<ContestPreparedExport>;
    reads: Array<ContestWorkerResponse<ContestExportChunk>>; release: ContestWorkerResponse<unknown>;
    unavailable: ContestWorkerResponse<unknown>; unknownMethod: ContestWorkerResponse<unknown>;
    wrongProfile: ContestWorkerResponse<unknown>; stopped: ContestWorkerResponse<unknown>;
  };
  provenance: { liveWorkerResponses: boolean; wrongWindow: string };
  assertions: { replayResultExactlyEqual: boolean; releasedReadUnavailable: boolean;
    prepareDidNotAdvanceRevision: boolean; historicalReadAfterLaterMutation: boolean };
};

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/contest-export-worker-wire.json", import.meta.url), "utf8")) as ExportFixture;

describe("Swift contest export worker wire fixture", () => {
  it("replays, reassembles, verifies, and releases the actual prepared artifact", async () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.provenance.liveWorkerResponses).toBe(true);
    expect(fixture.provenance.wrongWindow).toContain("native worker surface-admission tests");
    let readIndex = 0, prepareCount = 0;
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "contest_export_prepare") {
        expect(params).toEqual(fixture.requests.prepare);
        return prepareCount++ === 0 ? fixture.responses.prepare : fixture.responses.replay;
      }
      if (method === "contest_export_read") {
        expect(params).toEqual(fixture.requests.reads[readIndex]);
        return fixture.responses.reads[readIndex++];
      }
      expect(method).toBe("contest_export_release");
      expect(params).toEqual(fixture.requests.release);
      return fixture.responses.release;
    }) as ContestRequest;
    const client = new ContestClient(request);

    const prepared = await client.prepareExport(fixture.requests.prepare);
    const replayed = await client.prepareExport(fixture.requests.prepare);
    expect(prepared.formatterVersion).toBe("pilot-2");
    expect(prepared.sha256).toBe("5df42719e8029ab403d7c2774716b66a07e5501a4bb7854449d54bd5cd0a60f1");
    expect(fixture.assertions.replayResultExactlyEqual).toBe(true);
    expect(fixture.assertions.prepareDidNotAdvanceRevision).toBe(true);
    expect(fixture.assertions.historicalReadAfterLaterMutation).toBe(true);
    expect(replayed).toEqual(prepared);
    const bytes = await client.readPreparedExport(prepared);
    expect(bytes).toHaveLength(prepared.byteLength);
    expect(new TextDecoder().decode(bytes)).toContain("START-OF-LOG: 3.0\r\n");
    expect(readIndex).toBe(fixture.requests.reads.length);
    expect(await client.releaseExport(prepared)).toEqual({ artifactID: prepared.artifactID, released: true });
  });

  it("preserves typed unavailable, profile, and shutdown failures without recapture", async () => {
    expect(fixture.assertions.releasedReadUnavailable).toBe(true);
    for (const response of [fixture.responses.unavailable, fixture.responses.wrongProfile, fixture.responses.stopped]) {
      const client = new ContestClient(vi.fn(async () => response) as ContestRequest);
      const failure = await client.prepareExport(fixture.requests.prepare).catch(error => error);
      expect(failure).toBeInstanceOf(ContestServerError);
      expect(failure).toMatchObject({ code: response.ok ? "" : response.error.code, outcome: "confirmed" });
    }
    expect(fixture.responses.unknownMethod).toMatchObject({ ok: false, error: { code: "unknown_method", outcome: "confirmed" } });
  });

  it("rejects oversized metadata and malformed chunk coordinates, encoding, or digest", async () => {
    if (!fixture.responses.prepare.ok || !fixture.responses.reads[0]?.ok) throw new Error("Swift export fixture is incomplete.");
    const oversized = { ...fixture.responses.prepare, result: { ...fixture.responses.prepare.result, byteLength: 32 * 1_024 * 1_024 + 1 } };
    const oversizedClient = new ContestClient(vi.fn(async () => oversized) as ContestRequest);
    await expect(oversizedClient.prepareExport(fixture.requests.prepare)).rejects.toThrow("Malformed or stale contest_export_prepare response");

    const neverDispatched = vi.fn();
    const validatingClient = new ContestClient(neverDispatched as ContestRequest);
    expect(() => validatingClient.prepareExport({ ...fixture.requests.prepare,
      exportID: fixture.requests.prepare.exportID.toUpperCase() })).toThrow("preparation request is invalid");
    expect(() => validatingClient.readExport({ ...fixture.requests.reads[0], length: 65_537 } as ContestExportReadRequest)).toThrow("read request is invalid");
    expect(neverDispatched).not.toHaveBeenCalled();

    const prepared = fixture.responses.prepare.result;
    for (const result of [
      { ...fixture.responses.reads[0].result, offset: 1 },
      { ...fixture.responses.reads[0].result, dataBase64: "!!!!" },
      { ...fixture.responses.reads[0].result, sha256: "0".repeat(64) },
    ]) {
      const client = new ContestClient(vi.fn(async (method: string) => method === "contest_export_read"
        ? { ...fixture.responses.reads[0], result } : fixture.responses.prepare) as ContestRequest);
      await expect(client.readPreparedExport(prepared)).rejects.toThrow();
    }
  });

  it("accepts the full canonical lowercase UUID domain", async () => {
    if (!fixture.responses.prepare.ok) throw new Error("Swift export fixture is incomplete.");
    const request: ContestExportPrepareRequest = {
      ...fixture.requests.prepare,
      exportID: "018f0c8a-7b6d-7def-8123-456789abcdef",
      sessionID: "00000000-0000-0000-0000-000000000001",
      workspaceGeneration: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    };
    const response: ContestWorkerResponse<ContestPreparedExport> = {
      ...fixture.responses.prepare,
      result: { ...fixture.responses.prepare.result, artifactID: request.exportID,
        sessionID: request.sessionID, workspaceGeneration: request.workspaceGeneration },
    };
    const transport = vi.fn(async () => response) as ContestRequest;
    const prepared = await new ContestClient(transport).prepareExport(request);
    expect(prepared.artifactID).toBe(request.exportID);
    expect(transport).toHaveBeenCalledWith("contest_export_prepare", request);
  });

  it("reassembles multiple chunks and rejects wrong revision, eof, or same-length corruption", async () => {
    if (!fixture.responses.prepare.ok) throw new Error("Swift export fixture is incomplete.");
    const bytes = new TextEncoder().encode("abcdefghij");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const prepared: ContestPreparedExport = { ...fixture.responses.prepare.result,
      byteLength: bytes.length, chunkLimit: 4, sha256: digest };
    const responseFor = (offset: number, corrupt = false, revision = prepared.revision, eof = offset + Math.min(4, bytes.length - offset) === bytes.length) => {
      const length = Math.min(4, bytes.length - offset);
      const data = bytes.slice(offset, offset + length);
      if (corrupt) data[0] ^= 1;
      return { id: "chunk", ok: true as const, result: {
        artifactID: prepared.artifactID, sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration,
        revision, offset, dataBase64: Buffer.from(data).toString("base64"), eof,
        byteLength: prepared.byteLength, sha256: prepared.sha256,
      } };
    };
    const clientFor = (change?: (offset: number) => ContestWorkerResponse<ContestExportChunk>) => new ContestClient(
      vi.fn(async (_method: string, params: Record<string, unknown>) => change?.(params.offset as number) ?? responseFor(params.offset as number)) as ContestRequest);

    await expect(clientFor().readPreparedExport(prepared)).resolves.toEqual(bytes);
    await expect(clientFor(offset => responseFor(offset, offset === 4)).readPreparedExport(prepared)).rejects.toThrow("digest mismatch");
    await expect(clientFor(offset => responseFor(offset, false, prepared.revision + 1)).readPreparedExport(prepared)).rejects.toThrow("coordinate changed");
    await expect(clientFor(offset => responseFor(offset, false, prepared.revision, offset === 0)).readPreparedExport(prepared)).rejects.toThrow("chunk boundary is invalid");
  });
});
