import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, ContestServerError } from "./client";
import type { ContestCreateInput, ContestDraftFields, ContestExportPrepareRequest, ContestFullQSO, ContestRequest, ContestWorkerResponse } from "./types";

type Frame = ContestWorkerResponse<unknown>;
type Operation = { request: Record<string, unknown>; response: Frame };
type Fixture = {
  schemaVersion: number; catalog: Frame; invalidCreateResponse: Frame;
  wve: { createRequest: Record<string, unknown>; createResponse: Frame; reserveRequest: Record<string, unknown>; reserveResponse: Frame };
  dx: {
    createRequest: Record<string, unknown>; createResponse: Frame; reserveRequest: Record<string, unknown>; reserveResponse: Frame;
    reserveReplayResponse: Frame; applyRequest: Record<string, unknown>; applyResponse: Frame; commitRequest: Record<string, unknown>;
    commitResponse: Frame; openRequest: Record<string, unknown>; openResponse: Frame; getRequest: Record<string, unknown>; getResponse: Frame;
    correctionRequest: Record<string, unknown>; correctionResponse: Frame; deleteRequest: Record<string, unknown>; deleteResponse: Frame;
    exports: Record<"cabrillo" | "adif", { request: Record<string, unknown>; response: Frame; readRequest: Record<string, unknown>; readResponse: Frame }>;
  };
};

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/arrl-rtty-worker-wire.json", import.meta.url), "utf8")) as Fixture;
const payloadInput = (request: Record<string, unknown>) => {
  const { sessionID: _sessionID, ...input } = request.payload as ContestCreateInput & { sessionID: string };
  return input;
};
function operationClient(operations: Operation[]) {
  const queue = [...operations];
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const operation = queue.shift();
    if (!operation) throw new Error(`Unexpected ${method}`);
    expect(params).toEqual(operation.request);
    return operation.response;
  }) as ContestRequest;
  const ids = operations.flatMap(operation => {
    const value = operation.request;
    return value.expectedRevision === 0 ? [value.sessionID as string, value.requestID as string] : value.requestID ? [value.requestID as string] : [];
  });
  const digests = operations.filter(operation => "payloadDigest" in operation.request).map(operation => operation.request.payloadDigest as string);
  const times = operations.filter(operation => "operationTimestamp" in operation.request).map(operation => operation.request.operationTimestamp as string);
  return { client: new ContestClient(request, () => ids.shift()!, async () => digests.shift()!, undefined, () => times.shift()!), request };
}

describe("generated ARRL RTTY worker wire", () => {
  it("parses conditional W/VE and DX authority plus the durable DX lifecycle", async () => {
    expect(fixture.schemaVersion).toBe(1);
    const catalogClient = new ContestClient(vi.fn(async () => fixture.catalog) as ContestRequest);
    const catalog = await catalogClient.catalog();
    const rule = catalog.rules.find(item => item.identity.id === "arrl-rtty-roundup")!;
    expect(rule.entryDescriptorVersion).toBe(2);
    expect("stationResolvedSerial" in rule.entry && rule.entry.stationResolvedSerial?.allocatedSerialFieldID).toBe("serial");

    const wve = operationClient([
      { request: fixture.wve.createRequest, response: fixture.wve.createResponse },
      { request: fixture.wve.reserveRequest, response: fixture.wve.reserveResponse },
    ]);
    const wveCreated = await wve.client.create(catalog.workspaceGeneration, payloadInput(fixture.wve.createRequest));
    expect(wveCreated.session.resolvedSerial?.requirement).toBe("none");
    await expect(wve.client.reserveSerial(wveCreated.session, wveCreated.draft.draftID)).rejects.toMatchObject<Partial<ContestServerError>>({ code: "serial_not_supported" });

    const dx = operationClient([
      { request: fixture.dx.createRequest, response: fixture.dx.createResponse },
      { request: fixture.dx.reserveRequest, response: fixture.dx.reserveResponse },
      { request: fixture.dx.applyRequest, response: fixture.dx.applyResponse },
      { request: fixture.dx.commitRequest, response: fixture.dx.commitResponse },
      { request: fixture.dx.openRequest, response: fixture.dx.openResponse },
      { request: fixture.dx.getRequest, response: fixture.dx.getResponse },
      { request: fixture.dx.correctionRequest, response: fixture.dx.correctionResponse },
      { request: fixture.dx.deleteRequest, response: fixture.dx.deleteResponse },
    ]);
    const created = await dx.client.create(catalog.workspaceGeneration, payloadInput(fixture.dx.createRequest));
    expect(created.session.station.stationFields).toEqual({ section: "DX" });
    expect(created.session.resolvedSerial?.requirement).toBe("requiredForCommit");
    const reserved = await dx.client.reserveSerial(created.session, created.draft.draftID);
    const applied = await dx.client.applyDraft(reserved.session, reserved.draft.draftID,
      (fixture.dx.applyRequest.payload as { fields: ContestDraftFields }).fields);
    expect(applied.draft.fields.sentReport).toBe("589");
    expect(applied.draft.fields.receivedReport).toBe("579");
    const committed = await dx.client.commitQSO(applied.session, applied.draft.draftID);
    expect(committed.draft.reservedSerial).toBeNull();
    expect(committed.draft.fields.sentExchangeFields).toEqual({ location: "", serial: "" });
    const opened = await dx.client.open(committed.session.sessionID, committed.session.workspaceGeneration);
    const got = await dx.client.qso(opened.session, committed.qso.qsoID);
    expect(got.qso.sentReport).toBe("589");
    expect(got.qso.receivedReport).toBe("579");
    const correctedPayload = (fixture.dx.correctionRequest.payload as { qso: Omit<ContestFullQSO,"entity">; reason: string });
    expect([correctedPayload.qso.sentReport, correctedPayload.qso.receivedReport]).toEqual(["589", "579"]);
    const corrected = await dx.client.correctQSO(opened.session, { ...correctedPayload.qso, entity: got.qso.entity }, correctedPayload.reason);
    expect(corrected.currentTarget?.receivedExchangeFields).toEqual({ exchange: "NY" });
    expect([corrected.currentTarget?.sentReport, corrected.currentTarget?.receivedReport]).toEqual(["589", "579"]);
    const deletedPayload = fixture.dx.deleteRequest.payload as { qsoID: string; reason: string };
    const deleted = await dx.client.deleteQSO(corrected.session as never, deletedPayload.qsoID, deletedPayload.reason);
    expect(deleted.qsoCount).toBe(0);
    for (const format of ["cabrillo", "adif"] as const) {
      const artifact = fixture.dx.exports[format];
      let reply = artifact.response;
      const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
        expect(params).toEqual(reply === artifact.response ? artifact.request : artifact.readRequest);
        const current = reply; reply = artifact.readResponse; return current;
      }) as ContestRequest;
      const exportClient = new ContestClient(request);
      const prepared = await exportClient.prepareExport(artifact.request as unknown as ContestExportPrepareRequest);
      const chunk = await exportClient.readExport(artifact.readRequest as never);
      const document = new TextDecoder().decode(Uint8Array.from(atob(chunk.dataBase64), character => character.charCodeAt(0)));
      expect(prepared.formatterVersion).toBe(format === "cabrillo" ? "arrl-rtty-preview-1" : "arrl-rtty-preview-1");
      expect(document).toContain(format === "cabrillo" ? "LOCATION: DX" : "<CALL:5>K1AAA");
    }
  });

  it("rejects crossed optional members and malformed known descriptors", async () => {
    const catalogMutations = [
      (frame: any) => { const rule = frame.result.rules.find((item: any) => item.identity.id === "arrl-rtty-roundup"); delete rule.entry.stationFields; },
      (frame: any) => { const rule = frame.result.rules.find((item: any) => item.identity.id === "naqp-cw"); rule.entry.stationFields = []; },
      (frame: any) => { const rule = frame.result.rules.find((item: any) => item.identity.id === "arrl-rtty-roundup"); rule.entry.stationResolvedSerial.allowedScopes = ["band"]; },
    ];
    for (const mutate of catalogMutations) {
      const frame = structuredClone(fixture.catalog); mutate(frame);
      await expect(new ContestClient(vi.fn(async () => frame) as ContestRequest).catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
    }
    const crossed = structuredClone(fixture.dx.openResponse) as any;
    delete crossed.result.session.resolvedSerial;
    const request = vi.fn(async (_method: string, params: Record<string, unknown>) => { expect(params).toEqual(fixture.dx.openRequest); return crossed; }) as ContestRequest;
    await expect(new ContestClient(request).open(fixture.dx.openRequest.sessionID as string,
      fixture.dx.openRequest.workspaceGeneration as string)).rejects.toThrow("Malformed or stale contest_open response");
  });

  it("binds every draft result to the immutable session serial authority", async () => {
    const noSerial = { requirement: "none", allowedScopes: [], allocatedFieldID: null };
    const requiredSerial = { requirement: "requiredForCommit", allowedScopes: ["session"], allocatedFieldID: "serial" };
    const crossedDX = (frame: Frame) => {
      const value = structuredClone(frame) as any;
      value.result.draft.resolvedSerial = noSerial;
      value.result.draft.fields.sentExchangeFields.location = "CA";
      value.result.draft.fields.sentExchangeFields.serial = "";
      return value as Frame;
    };
    const create = operationClient([{ request: fixture.dx.createRequest, response: crossedDX(fixture.dx.createResponse) }]);
    await expect(create.client.create((fixture.catalog as any).result.workspaceGeneration,
      payloadInput(fixture.dx.createRequest))).rejects.toMatchObject({ name: "ContestMutationUncertain" });

    const reserve = operationClient([{ request: fixture.dx.reserveRequest, response: crossedDX(fixture.dx.reserveResponse) }]);
    const createdSession = (fixture.dx.createResponse as any).result.session;
    await expect(reserve.client.reserveSerial(createdSession, fixture.dx.reserveRequest.draftID as string))
      .rejects.toMatchObject({ name: "ContestMutationUncertain" });

    const apply = operationClient([{ request: fixture.dx.applyRequest, response: crossedDX(fixture.dx.applyResponse) }]);
    const reservedSession = (fixture.dx.reserveResponse as any).result.session;
    await expect(apply.client.applyDraft(reservedSession, fixture.dx.applyRequest.draftID as string,
      (fixture.dx.applyRequest.payload as { fields: ContestDraftFields }).fields))
      .rejects.toMatchObject({ name: "ContestMutationUncertain" });

    const commit = operationClient([{ request: fixture.dx.commitRequest, response: crossedDX(fixture.dx.commitResponse) }]);
    const appliedSession = (fixture.dx.applyResponse as any).result.session;
    await expect(commit.client.commitQSO(appliedSession, fixture.dx.commitRequest.draftID as string))
      .rejects.toMatchObject({ name: "ContestMutationUncertain" });

    const crossedOpen = crossedDX(fixture.dx.openResponse);
    const readRequest = vi.fn(async (method: string) => {
      expect(["contest_open", "contest_draft_get"]).toContain(method);
      return crossedOpen;
    }) as ContestRequest;
    const readClient = new ContestClient(readRequest);
    const openSession = (fixture.dx.openResponse as any).result.session;
    await expect(readClient.open(openSession.sessionID, openSession.workspaceGeneration))
      .rejects.toThrow("Malformed or stale contest_open response");
    await expect(readClient.draft(openSession)).rejects.toThrow("Malformed or stale contest_draft_get response");

    const crossedWVE = structuredClone(fixture.wve.createResponse) as any;
    crossedWVE.result.draft.resolvedSerial = requiredSerial;
    const wve = operationClient([{ request: fixture.wve.createRequest, response: crossedWVE }]);
    await expect(wve.client.create((fixture.catalog as any).result.workspaceGeneration,
      payloadInput(fixture.wve.createRequest))).rejects.toMatchObject({ name: "ContestMutationUncertain" });
  });
});
