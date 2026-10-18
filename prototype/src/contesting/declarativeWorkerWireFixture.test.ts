import { describe, expect, it, vi } from "vitest";
import fixture from "../../../docs/contesting/fixtures/declarative-activation-worker-wire.json";
import { ContestClient, validateDraftFields } from "./client";
import type { ContestFullQSO, ContestRequest, ContestSessionSummary } from "./types";

describe("declarative worker-to-client fixture", () => {
  it("reads and corrects actual nonserial and serial-name worker records", async () => {
    expect(fixture.schemaVersion).toBe(2);
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

  it("admits all actual stored declarative policies and their eleven exact signal modes", async () => {
    expect(fixture.operatorProfiles).toHaveLength(7);
    expect(fixture.operatorProfiles.reduce((count, item) =>
      count + ((item.catalogRule.operatorCapability?.signalProfiles?.length ?? 0)), 0)).toBe(11);
    for (const item of fixture.operatorProfiles) {
      const rule = item.catalogRule as unknown as ContestSessionSummary["rule"];
      expect(rule.operatorCapability?.auditDigest).toBe(rule.declarativeDefinition?.definitionDigest);
      for (const profile of rule.operatorCapability?.signalProfiles ?? []) {
        expect(profile.signal).toBe(profile.mode === "CW" ? "cw" : "phone");
      }
      const catalogRequest = vi.fn(async () => ({ id: "fixture", ok: true as const,
        result: { workspaceGeneration: item.session.workspaceGeneration, rules: [item.catalogRule] } })) as ContestRequest;
      await expect(new ContestClient(catalogRequest).catalog(), `${item.definitionID} catalog`).resolves.toBeTruthy();
      const openRequest = vi.fn(async () => ({ id: "fixture", ok: true as const,
        result: { session: item.session, draft: item.draft } })) as ContestRequest;
      const opened = await new ContestClient(openRequest).open(item.session.sessionID, item.session.workspaceGeneration)
        .catch(cause => { throw new Error(`${item.definitionID} open: ${String(cause)}`); });
      expect(opened.draft.operatorReadiness?.capabilityDigest).toBe(rule.operatorCapability?.auditDigest);
    }

    const original = fixture.operatorProfiles[0].catalogRule as any;
    for (const malformed of [
      { ...structuredClone(original), operatorCapability: { ...original.operatorCapability, auditDigest: "f".repeat(64) } },
      { ...structuredClone(original), operatorCapability: { ...original.operatorCapability,
        signalProfiles: [{ ...original.operatorCapability.signalProfiles[0], signal: "phone" }] } },
      { ...structuredClone(original), operatorCapability: { ...original.operatorCapability,
        signalProfiles: original.operatorCapability.signalProfiles.map((profile: any) => ({ ...profile, mode: "future" })) } },
    ]) {
      const request = vi.fn(async () => ({ id: "fixture", ok: true as const,
        result: { workspaceGeneration: fixture.operatorProfiles[0].session.workspaceGeneration, rules: [malformed] } })) as ContestRequest;
      await expect(new ContestClient(request).catalog()).rejects.toThrow("Malformed or stale contest_catalog response.");
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
