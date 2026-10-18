import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, ContestMutationUncertain, ContestServerError, type ContestMutation } from "./client";
import type { ContestCreateInput, ContestDraftFields, ContestEntryDescriptorV2, ContestRequest, ContestSessionSummary, ContestWorkerResponse } from "./types";

type WireFixture = {
  schemaVersion: number;
  requests: Record<"create" | "reserve" | "apply" | "commit" | "qsoGet" | "qsoCorrect" | "qsoDelete" | "postCommitApply", Record<string, unknown>>;
  responses: Record<"catalog" | "create" | "apply" | "commit" | "qsoGet" | "qsoCorrect" | "qsoDelete" | "qsoCorrectReplayAfterDelete" | "qsoDeleteReplay" | "replay" | "confirmedError" | "postCommitUncertain" | "receiptAfterUncertain", ContestWorkerResponse<unknown>> &
    { reserve?: ContestWorkerResponse<unknown> };
  assertions: { replayResultExactlyEqual: boolean; qsoChangeReplayAfterDeleteExactlyEqual: boolean; allContestUUIDsCanonicalLowercase: boolean };
  provenance: { liveWorkerResponses: string[]; postCommitUncertain: string };
  naqp: {
    requests: Record<"create" | "partial" | "reset" | "open" | "complete" | "commit", Record<string, unknown>>;
    responses: Record<"create" | "partial" | "reset" | "open" | "complete" | "commit", ContestWorkerResponse<unknown>>;
  };
};

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/contesting-worker-wire.json", import.meta.url), "utf8")) as WireFixture;
const currentCatalogFixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/current-contesting-catalog-worker-wire.json", import.meta.url), "utf8")) as {
  schemaVersion: number;
  catalog: ContestWorkerResponse<{ workspaceGeneration: string; rules: unknown[] }>;
  assertions: { legacyOperatorCapabilities: number; declarativeOperatorCapabilities: number; inertRTTYRules: number; totalRules: number };
};
type LifecycleRequestKey = "create" | "reserve" | "apply" | "commit";
const lifecycleRequestKey: Record<string, LifecycleRequestKey> = {
  contest_create: "create", contest_serial_reserve: "reserve", contest_draft_apply: "apply", contest_qso_commit: "commit",
};
const UUID_KEYS = new Set(["sessionID", "workspaceGeneration", "requestID", "draftID", "qsoID"]);
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function contestUUIDs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(contestUUIDs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    UUID_KEYS.has(key) && typeof child === "string" ? [child] : contestUUIDs(child));
}

function createInput(): ContestCreateInput {
  const { sessionID: _sessionID, ...input } = fixture.requests.create.payload as ContestCreateInput & { sessionID: string };
  return input;
}

describe("Swift contest worker wire fixture", () => {
  it("parses the generated create, reserve, apply, commit, and exact replay lifecycle", async () => {
    expect(fixture.schemaVersion).toBe(8);
    expect(fixture.provenance.liveWorkerResponses).toContain("reserve");
    expect(fixture.provenance.postCommitUncertain).toBe("actual direct ContestLane error serialized by the Swift fixture test; not a LiveWorker response");
    expect(fixture.assertions.allContestUUIDsCanonicalLowercase).toBe(true);
    expect(contestUUIDs(fixture)).not.toHaveLength(0);
    for (const value of contestUUIDs(fixture)) expect(value).toMatch(LOWERCASE_UUID);

    const requestIDs = [
      fixture.requests.create.sessionID,
      fixture.requests.create.requestID,
      fixture.requests.reserve.requestID,
      fixture.requests.apply.requestID,
      fixture.requests.commit.requestID,
    ] as string[];
    const timestamps = ["create", "reserve", "apply", "commit"].map(key => fixture.requests[key as keyof WireFixture["requests"]].operationTimestamp as string);
    const operationStates: Array<[ContestMutation, string]> = [];
    let commitReplies = 0;
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "contest_catalog") return fixture.responses.catalog;
      const fixtureKey = lifecycleRequestKey[method];
      expect(params).toEqual(fixture.requests[fixtureKey]);
      if (fixtureKey === "commit") return commitReplies++ === 0 ? fixture.responses.commit : fixture.responses.replay;
      const response = fixture.responses[fixtureKey];
      if (!response) throw new Error(`Generated Swift fixture is missing responses.${fixtureKey}.`);
      return response;
    }) as ContestRequest;
    const client = new ContestClient(
      request,
      () => requestIDs.shift()!,
      async () => fixture.requests.create.payloadDigest as string,
      (operation, state) => operationStates.push([operation, state]),
      () => timestamps.shift()!,
    );

    const catalog = await client.catalog();
    expect(new Set(catalog.rules.map(rule => rule.identity.id))).toEqual(new Set(["cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb", "oceania-dx-cw", "oceania-dx-ssb", "sac-cw", "sac-ssb", "naqp-cw", "naqp-ssb", "naqp-rtty", "arrl-rtty-roundup", "jidx-cw", "jidx-ssb", "arrl-dx-cw", "arrl-dx-ssb"]));
    const entries = Object.fromEntries(catalog.rules.map(rule => [rule.identity.id,
      [rule.entryDescriptorVersion, rule.mode, rule.entry.cabrilloQSOType, rule.entry.report.defaultSent, rule.entry.serial.requirement]]));
    expect(entries).toEqual({
      "cq-ww-cw": [1, "CW", "CW", "599", "none"], "cq-wpx-cw": [1, "CW", "CW", "599", "requiredForCommit"],
      "cq-ww-ssb": [1, "SSB", "PH", "59", "none"], "cq-wpx-ssb": [1, "SSB", "PH", "59", "requiredForCommit"],
      "oceania-dx-cw": [1, "CW", "CW", "599", "requiredForCommit"], "oceania-dx-ssb": [1, "SSB", "PH", "59", "requiredForCommit"],
      "sac-cw": [1, "CW", "CW", "599", "requiredForCommit"], "sac-ssb": [1, "SSB", "PH", "59", "requiredForCommit"],
      "naqp-cw": [2, "CW", "CW", "", "none"], "naqp-ssb": [2, "SSB", "PH", "", "none"],
      "naqp-rtty": [2, "RTTY", "RY", "", "none"],
      "arrl-rtty-roundup": [2, "RTTY", "RY", "599", "none"],
      "jidx-cw": [2, "CW", "CW", "599", "none"], "jidx-ssb": [2, "SSB", "PH", "59", "none"],
      "arrl-dx-cw": [2, "CW", "CW", "599", "none"], "arrl-dx-ssb": [2, "SSB", "PH", "59", "none"],
    });
    const operatorRules = catalog.rules.filter(rule => rule.operatorCapability);
    expect(new Set(operatorRules.map(rule => rule.identity.id))).toEqual(new Set([
      "cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb", "oceania-dx-cw", "oceania-dx-ssb",
      "sac-cw", "sac-ssb", "naqp-cw", "naqp-ssb", "jidx-cw", "jidx-ssb", "arrl-dx-cw", "arrl-dx-ssb",
    ]));
    expect(new Set(operatorRules.map(rule => rule.operatorCapability!.auditDigest)).size).toBe(14);
    for (const candidate of operatorRules) expect(candidate.operatorCapability!.auditDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.rules.filter(rule => ["naqp-rtty", "arrl-rtty-roundup"].includes(rule.identity.id)))
      .toHaveLength(2);
    expect(catalog.rules.filter(rule => ["naqp-rtty", "arrl-rtty-roundup"].includes(rule.identity.id))
      .every(rule => rule.operatorCapability === undefined)).toBe(true);
    const created = await client.create(catalog.workspaceGeneration, createInput());
    const reserved = await client.reserveSerial(created.session, created.draft.draftID);
    const applied = await client.applyDraft(reserved.session, reserved.draft.draftID, (fixture.requests.apply.payload as { fields: ContestDraftFields }).fields);
    const committed = await client.commitQSO(applied.session, applied.draft.draftID);
    const commitOperation = operationStates.find(([operation, state]) => operation.method === "contest_qso_commit" && state === "inflight")![0];
    const replayed = await client.retry(commitOperation);

    expect(fixture.assertions.replayResultExactlyEqual).toBe(true);
    expect(fixture.responses.replay.ok).toBe(true);
    expect(fixture.responses.commit.ok).toBe(true);
    if (!fixture.responses.replay.ok || !fixture.responses.commit.ok) throw new Error("Generated replay fixture is not a successful worker frame.");
    expect(fixture.responses.replay.result).toEqual(fixture.responses.commit.result);
    expect(fixture.assertions.qsoChangeReplayAfterDeleteExactlyEqual).toBe(true);
    expect(fixture.responses.qsoCorrectReplayAfterDelete.ok && fixture.responses.qsoCorrectReplayAfterDelete.result)
      .toEqual(fixture.responses.qsoCorrect.ok && fixture.responses.qsoCorrect.result);
    expect(fixture.responses.qsoDeleteReplay.ok && fixture.responses.qsoDeleteReplay.result)
      .toEqual(fixture.responses.qsoDelete.ok && fixture.responses.qsoDelete.result);
    expect(fixture.responses.qsoGet.ok).toBe(true);
    expect(replayed).toEqual(committed);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("parses the generated NAQP create, partial, reset, reopen, and commit lifecycle through ContestClient", async () => {
    const sequence: Array<keyof WireFixture["naqp"]["requests"]> = ["create", "partial", "reset", "open", "complete", "commit"];
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      const key = sequence.shift();
      expect(key).toBeDefined();
      expect(method).toBe(key === "create" ? "contest_create" : key === "partial" || key === "reset" || key === "complete" ? "contest_draft_apply" : key === "open" ? "contest_open" : "contest_qso_commit");
      expect(params).toEqual(fixture.naqp.requests[key!]);
      return fixture.naqp.responses[key!];
    }) as ContestRequest;
    const ids = [fixture.naqp.requests.create.sessionID as string,
      ...["create", "partial", "reset", "complete", "commit"].map(key => fixture.naqp.requests[key as keyof WireFixture["naqp"]["requests"]].requestID as string)];
    const digests = ["create", "partial", "reset", "complete", "commit"].map(key => fixture.naqp.requests[key as keyof WireFixture["naqp"]["requests"]].payloadDigest as string);
    const timestamps = ["create", "partial", "reset", "complete", "commit"].map(key => fixture.naqp.requests[key as keyof WireFixture["naqp"]["requests"]].operationTimestamp as string);
    const client = new ContestClient(request, () => ids.shift()!, async () => digests.shift()!, undefined, () => timestamps.shift()!);
    const catalogResult = fixture.responses.catalog.ok ? fixture.responses.catalog.result as { workspaceGeneration: string; rules: ContestSessionSummary["rule"][] } : null;
    if (!catalogResult) throw new Error("Generated catalog fixture is unavailable.");
    const { sessionID: _sessionID, ...createInput } = fixture.naqp.requests.create.payload as ContestCreateInput & { sessionID: string };
    const created = await client.create(catalogResult.workspaceGeneration, createInput);
    expect(created.session.station.exchangeFields).toEqual({ name: "AL", location: "" });
    expect(created.draft.fields.receivedExchangeFields).toEqual({ name: "", location: "" });
    const partial = await client.applyDraft(created.session, created.draft.draftID,
      (fixture.naqp.requests.partial.payload as { fields: ContestDraftFields }).fields);
    expect(partial.draft.fields.receivedExchangeFields).toEqual({ name: "Sam", location: "" });
    expect(partial.draft.validation.errors.length).toBeGreaterThan(0);
    const reset = await client.applyDraft(partial.session, partial.draft.draftID,
      (fixture.naqp.requests.reset.payload as { fields: ContestDraftFields }).fields);
    expect(reset.draft.fields.receivedExchangeFields).toEqual({ name: "", location: "" });
    const reopened = await client.open(reset.session.sessionID, reset.session.workspaceGeneration);
    expect(reopened.draft.fields).toEqual(reset.draft.fields);
    const completed = await client.applyDraft(reopened.session, reopened.draft.draftID,
      (fixture.naqp.requests.complete.payload as { fields: ContestDraftFields }).fields);
    const committed = await client.commitQSO(completed.session, completed.draft.draftID);
    expect(committed.qso).toMatchObject({ sentExchange: "AL", receivedExchange: "Sam ca" });
    expect(committed.draft.fields.receivedExchangeFields).toEqual({ name: "", location: "" });
    expect(sequence).toHaveLength(0);
  });

  it("rejects each incoherent NAQP v2 descriptor mutation from the generated catalog", async () => {
    const mutations: Array<(entry: Record<string, any>) => void> = [
      entry => { entry.report.format = "cwRST"; },
      entry => { entry.report.defaultSent = "599"; },
      entry => { entry.report.maximumUTF8Bytes = 3; },
      entry => { entry.adifMode = "RTTY"; },
      entry => { entry.cabrilloQSOType = "RY"; },
      entry => { entry.cabrilloFormatterVersion = "pilot-1"; },
      entry => { entry.modeProfiles[0].adifSubmode = {}; },
      entry => { entry.exchange.sentFields = []; },
      entry => { entry.exchange.sentFields.reverse(); },
      entry => { entry.exchange.sentFields[0].acceptedKinds = ["subdivision"]; },
      entry => { entry.exchange.sentFields[1].required = true; },
      entry => { entry.exchange.receivedFields[1].adifField = "MY_STATE"; },
      entry => { entry.exchange.receivedFields[0].maximumUTF8Bytes = 31; },
    ];
    for (const mutate of mutations) {
      const frame = structuredClone(fixture.responses.catalog) as ContestWorkerResponse<unknown>;
      if (!frame.ok) throw new Error("Generated catalog fixture is unavailable.");
      const result = frame.result as { rules: Array<{ identity: { id: string }; entry: Record<string, any> }> };
      const rule = result.rules.find(item => item.identity.id === "naqp-cw");
      if (!rule) throw new Error("Generated NAQP rule is unavailable.");
      mutate(rule.entry);
      await expect(new ContestClient(vi.fn(async () => frame) as ContestRequest).catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
    }
  });

  it("rejects a generated legacy WPX reply crossed with an oversized structured draft shape", async () => {
    if (!fixture.responses.create.ok) throw new Error("Generated WPX create fixture is unavailable.");
    const result = structuredClone(fixture.responses.create.result) as { session: ContestSessionSummary; draft: { fields: ContestDraftFields } };
    result.draft.fields = { ...result.draft.fields, sentExchange: `${"X".repeat(32)} CA`,
      sentExchangeFields: { name: "X".repeat(32), location: "CA" }, receivedExchangeFields: { name: "", location: "" } };
    const request = vi.fn(async () => ({ id: "crossed-wpx", ok: true as const, result })) as ContestRequest;
    await expect(new ContestClient(request).open(result.session.sessionID, result.session.workspaceGeneration))
      .rejects.toThrow("Malformed or stale contest_open response");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps a generated confirmed rejection editable instead of making it uncertain", async () => {
    const fields = (fixture.requests.apply.payload as { fields: ContestDraftFields }).fields;
    const originalFields = structuredClone(fields);
    const observed: Array<[ContestMutation, string]> = [];
    const request = vi.fn(async () => fixture.responses.confirmedError) as ContestRequest;
    const client = new ContestClient(
      request,
      () => "c7654321-89ab-4cde-8fab-0123456789ab",
      async () => fixture.requests.apply.payloadDigest as string,
      (operation, state) => observed.push([operation, state]),
      () => fixture.requests.apply.operationTimestamp as string,
    );
    const session = (fixture.responses.create.ok ? fixture.responses.create.result : null) as { session: ContestSessionSummary };

    const rejection = await client.applyDraft(session.session, fixture.requests.apply.draftID as string, fields).catch(cause => cause);

    expect(rejection).toBeInstanceOf(ContestServerError);
    expect(rejection).not.toBeInstanceOf(ContestMutationUncertain);
    expect(rejection).toMatchObject({ code: "invalid_params", outcome: "confirmed" });
    expect(fields).toEqual(originalFields);
    expect(observed.map(([, state]) => state)).toEqual(["inflight", "confirmed"]);
  });

  it("parses generated full-QSO reads and server-resolved correction and deletion results", async () => {
    const committed = fixture.responses.commit.ok ? fixture.responses.commit.result as { session: ContestSessionSummary } : null;
    if (!committed || !fixture.responses.qsoGet.ok || !fixture.responses.qsoCorrect.ok || !fixture.responses.qsoDelete.ok) {
      throw new Error("Generated QSO change fixture is incomplete.");
    }
    const generated = [fixture.requests.qsoGet, fixture.requests.qsoCorrect, fixture.requests.qsoDelete];
    const replies = [fixture.responses.qsoGet, fixture.responses.qsoCorrect, fixture.responses.qsoDelete];
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      const expected = generated.shift();
      expect(method).toBe(expected === fixture.requests.qsoGet ? "contest_qso_get" : expected === fixture.requests.qsoCorrect ? "contest_qso_correct" : "contest_qso_delete");
      expect(params).toEqual(expected);
      return replies.shift()!;
    }) as ContestRequest;
    const ids = [fixture.requests.qsoCorrect.requestID, fixture.requests.qsoDelete.requestID] as string[];
    const digests = [fixture.requests.qsoCorrect.payloadDigest, fixture.requests.qsoDelete.payloadDigest] as string[];
    const timestamps = [fixture.requests.qsoCorrect.operationTimestamp, fixture.requests.qsoDelete.operationTimestamp] as string[];
    const client = new ContestClient(request, () => ids.shift()!, async () => digests.shift()!, undefined, () => timestamps.shift()!);
    const qsoID = fixture.requests.qsoGet.qsoID as string;

    const read = await client.qso(committed.session, qsoID);
    const corrected = await client.correctQSO(committed.session, {
      ...read.qso, callsign: "DL1AAA", receivedReport: "579", receivedExchange: "2", normalizedReceivedExchange: "2",
    }, "Correct copied call");
    const correctedRequestQSO = (fixture.requests.qsoCorrect.payload as { qso: Record<string, unknown> }).qso;
    expect(correctedRequestQSO).not.toHaveProperty("entity");
    expect(corrected.currentTarget).toMatchObject({ callsign: "DL1AAA", entity: { countryPrefix: "DL", name: "FED. REP. OF GERMANY" } });
    expect(corrected.score).toMatchObject({ qsos: 1, points: 1, multipliers: 1, claimedScore: 1 });

    const nextSession = { ...committed.session, ...corrected.session };
    const deleted = await client.deleteQSO(nextSession, qsoID, "Remove invalid contact");
    expect(deleted).toMatchObject({ operation: "deletion", qsoID, qsoCount: 0, currentTarget: null, score: { claimedScore: 0 } });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("retains the exact generated draft operation through a post-commit uncertainty and receipt check", async () => {
    const generated = fixture.requests.postCommitApply;
    const requestID = generated.requestID as string;
    const payloadDigest = generated.payloadDigest as string;
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "contest_draft_apply") {
        expect(params).toEqual(generated);
        return fixture.responses.postCommitUncertain;
      }
      expect(method).toBe("contest_operation_receipt");
      expect(params).toEqual({
        sessionID: generated.sessionID,
        workspaceGeneration: generated.workspaceGeneration,
        requestID,
        payloadDigest,
      });
      return fixture.responses.receiptAfterUncertain;
    }) as ContestRequest;
    const client = new ContestClient(
      request,
      () => requestID,
      async () => payloadDigest,
      undefined,
      () => generated.operationTimestamp as string,
    );
    const committed = (fixture.responses.commit.ok ? fixture.responses.commit.result : null) as { session: ContestSessionSummary; draft: { draftID: string } };
    const session = { ...committed.session, workspaceGeneration: generated.workspaceGeneration as string, revision: generated.expectedRevision as number };
    const fields = (generated.payload as { fields: ContestDraftFields }).fields;

    const uncertainty = await client.applyDraft(session, generated.draftID as string, fields).catch(cause => cause);
    expect(uncertainty).toBeInstanceOf(ContestMutationUncertain);
    expect({ ...uncertainty.operation.scope, payload: uncertainty.operation.payload }).toEqual(generated);
    expect(uncertainty.operation.method).toBe("contest_draft_apply");

    const receipt = await client.receipt(uncertainty.operation);
    expect(receipt).toEqual(fixture.responses.receiptAfterUncertain.ok && fixture.responses.receiptAfterUncertain.result);
    expect(receipt).toMatchObject({ status: "committed", receipt: { requestID, payloadDigest, committedRevision: 8 } });
  });
});

describe("current Swift contest catalog fixture", () => {
  it("partitions reviewed legacy and stored declarative operator capabilities", async () => {
    expect(currentCatalogFixture.schemaVersion).toBe(1);
    expect(currentCatalogFixture.assertions).toEqual({
      legacyOperatorCapabilities: 14, declarativeOperatorCapabilities: 7, inertRTTYRules: 2, totalRules: 23,
    });
    const request = vi.fn(async () => currentCatalogFixture.catalog) as ContestRequest;
    const catalog = await new ContestClient(request).catalog();
    const legacyOperatorIDs = new Set([
      "cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb", "oceania-dx-cw", "oceania-dx-ssb",
      "sac-cw", "sac-ssb", "naqp-cw", "naqp-ssb", "jidx-cw", "jidx-ssb", "arrl-dx-cw", "arrl-dx-ssb",
    ]);
    const declarativeOperatorIDs = new Set([
      "cwops-cwt", "cwops-open", "icwc-mst", "ten-ten-fallCW", "ten-ten-springCW", "ten-ten-summerPhone", "ten-ten-winterPhone",
    ]);
    const inertRTTYIDs = new Set(["naqp-rtty", "arrl-rtty-roundup"]);
    expect(catalog.rules).toHaveLength(23);
    const operatorRules = catalog.rules.filter(rule => rule.operatorCapability);
    expect(new Set(operatorRules.filter(rule => !rule.declarativeDefinition).map(rule => rule.identity.id))).toEqual(legacyOperatorIDs);
    const declarativeRules = operatorRules.filter(rule => rule.declarativeDefinition);
    expect(new Set(declarativeRules.map(rule => rule.identity.id))).toEqual(declarativeOperatorIDs);
    expect(catalog.rules.filter(rule => inertRTTYIDs.has(rule.identity.id)).every(rule => !rule.operatorCapability)).toBe(true);
    expect(new Set(operatorRules.map(rule => rule.operatorCapability!.auditDigest)).size).toBe(21);
    for (const rule of declarativeRules) {
      const capability = rule.operatorCapability;
      if (!capability || !rule.declarativeDefinition) throw new Error("Declarative worker rule omitted its reviewed capability binding.");
      const signalProfiles = capability.signalProfiles;
      if (!signalProfiles) throw new Error("Declarative worker rule omitted its reviewed signal profiles.");
      expect(capability.auditDigest).toBe(rule.declarativeDefinition.definitionDigest);
      expect(rule.entryDescriptorVersion).toBe(2);
      const entry = rule.entry as ContestEntryDescriptorV2;
      expect(entry.version).toBe(2);
      expect(signalProfiles.map(profile => profile.mode).sort())
        .toEqual(entry.modeProfiles.map(profile => profile.mode).sort());
    }
  });
});
