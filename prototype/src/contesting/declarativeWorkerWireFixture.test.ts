import { describe, expect, it, vi } from "vitest";
import fixture from "../../../docs/contesting/fixtures/declarative-activation-worker-wire.json";
import { ContestClient, validateDraftFields } from "./client";
import type { ContestFullQSO, ContestRequest, ContestSessionSummary } from "./types";

describe("declarative worker-to-client fixture", () => {
  it("reads and corrects actual nonserial and serial-name worker records", async () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases.map(item => item.definitionID).sort()).toEqual(["cwops-cwt", "cwops-open"]);
    for (const item of fixture.cases) {
      const session = item.session as unknown as ContestSessionSummary;
      const getResult = item.qsoGet as unknown as { qso: ContestFullQSO };
      const correctionParams = item.correctionParams as Record<string, any>;
      const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === "contest_qso_get") return { id: "fixture", ok: true as const, result: item.qsoGet };
        expect(method).toBe("contest_qso_correct");
        expect(params).toEqual(correctionParams);
        return { id: "fixture", ok: true as const, result: item.correction };
      }) as ContestRequest;
      const client = new ContestClient(request, () => correctionParams.requestID,
        async () => correctionParams.payloadDigest, undefined, () => correctionParams.operationTimestamp);
      const read = await client.qso(session, getResult.qso.qsoID);
      expect(read.qso.allocatedSerial).toBe(read.qso.normalizedSentExchange);
      const correctedPayload = correctionParams.payload.qso as Omit<ContestFullQSO, "entity">;
      const corrected = await client.correctQSO(session, { ...correctedPayload, entity: read.qso.entity }, correctionParams.payload.reason);
      expect(corrected.currentTarget?.callsign).toBe("N1NEW");
      expect(Object.keys(corrected.currentTarget?.sentExchangeFields ?? {}).sort())
        .toEqual(Object.keys(read.qso.sentExchangeFields ?? {}).sort());
    }
  });

  it("accepts an actual worker commit in a supported nondefault mode", async () => {
    const item = fixture.nondefaultModeCommit;
    const session = item.session as unknown as ContestSessionSummary;
    const commitParams = item.commitParams as Record<string, any>;
    expect(session.rule.mode).toBe("SSB");
    expect(session.rule.supportedModes).toContain("AM");
    expect(() => validateDraftFields(item.commitResult.draft.fields, session.rule)).not.toThrow();
    const catalogRequest = vi.fn(async () => ({ id: "fixture", ok: true as const,
      result: { workspaceGeneration: session.workspaceGeneration, rules: [item.commitResult.session.rule] } })) as ContestRequest;
    await expect(new ContestClient(catalogRequest).catalog()).resolves.toBeTruthy();
    const sessionsRequest = vi.fn(async () => ({ id: "fixture", ok: true as const,
      result: { sessions: [item.commitResult.session] } })) as ContestRequest;
    await expect(new ContestClient(sessionsRequest).sessions()).resolves.toBeTruthy();
    const openRequest = vi.fn(async () => ({ id: "fixture", ok: true as const,
      result: { session: item.commitResult.session, draft: item.commitResult.draft } })) as ContestRequest;
    await expect(new ContestClient(openRequest).open(session.sessionID, session.workspaceGeneration)).resolves.toBeTruthy();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe("contest_qso_commit");
      expect(params).toEqual(commitParams);
      return { id: "fixture", ok: true as const, result: item.commitResult };
    }) as ContestRequest;
    const client = new ContestClient(request, () => commitParams.requestID,
      async () => commitParams.payloadDigest, undefined, () => commitParams.operationTimestamp);
    const committed = await client.commitQSO(session, item.draftID);
    expect(committed.qso.mode).toBe("AM");

    const qsoSession = item.qsoSession as unknown as ContestSessionSummary;
    const qsoResult = item.qsoGet as unknown as { qso: ContestFullQSO };
    const correctionParams = item.correctionParams as Record<string, any>;
    const qsoRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "contest_qso_get") return { id: "fixture", ok: true as const, result: item.qsoGet };
      expect(method).toBe("contest_qso_correct");
      expect(params).toEqual(correctionParams);
      return { id: "fixture", ok: true as const, result: item.correction };
    }) as ContestRequest;
    const qsoClient = new ContestClient(qsoRequest, () => correctionParams.requestID,
      async () => correctionParams.payloadDigest, undefined, () => correctionParams.operationTimestamp);
    const read = await qsoClient.qso(qsoSession, qsoResult.qso.qsoID);
    expect(new TextEncoder().encode(read.qso.receivedExchange).length).toBe(74);
    const correctedPayload = correctionParams.payload.qso as Omit<ContestFullQSO, "entity">;
    await expect(qsoClient.correctQSO(qsoSession, { ...correctedPayload, entity: read.qso.entity },
      correctionParams.payload.reason)).resolves.toBeTruthy();

    expect(item.exports.map(entry => entry.format).sort()).toEqual(["adif", "cabrillo"]);
    for (const exported of item.exports) {
      const exportRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === "contest_export_prepare") { expect(params).toEqual(exported.prepareParams); return { id: "fixture", ok: true as const, result: exported.prepared }; }
        if (method === "contest_export_read") { expect(params).toEqual(exported.readParams); return { id: "fixture", ok: true as const, result: exported.chunk }; }
        expect(method).toBe("contest_export_release"); expect(params).toEqual(exported.releaseParams);
        return { id: "fixture", ok: true as const, result: exported.released };
      }) as ContestRequest;
      const exportClient = new ContestClient(exportRequest);
      const prepared = await exportClient.prepareExport(exported.prepareParams as any, "operatorArchive");
      await expect(exportClient.readExport(exported.readParams as any)).resolves.toBeTruthy();
      await expect(exportClient.releaseExport(prepared)).resolves.toBeTruthy();
    }

    const maximumFields = { name: "A".repeat(32), "member-number": "1".repeat(8), qth: "B".repeat(32) };
    const maximumAggregate = Object.values(maximumFields).join(" ");
    expect(new TextEncoder().encode(maximumAggregate).length).toBe(74);
    expect(() => validateDraftFields({ ...item.commitResult.draft.fields, callsign: "K1ABC",
      sentExchangeFields: maximumFields, receivedExchangeFields: maximumFields,
      sentExchange: maximumAggregate, receivedExchange: maximumAggregate }, session.rule)).not.toThrow();
  });
});
