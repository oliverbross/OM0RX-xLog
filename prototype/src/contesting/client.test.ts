import { describe, expect, it, vi } from "vitest";
import { canonicalJSON, ContestClient, ContestMutationUncertain, ContestServerError, validateCreateInput, validateDraftFields } from "./client";
import type { HistorySelection } from "./contestCallHistory";
import type { ContestDraftFields, ContestRequest, ContestRuleMetadata, ContestScoreSummary, ContestSessionSummary } from "./types";

const rule: ContestRuleMetadata = { identity: { id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "source-1" }, displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1,
  entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 },
    exchange: { sent: "cqZone", received: "cqZone", sentDefault: "stationSnapshot", adifFields: "none" }, serial: { requirement: "none", allowedScopes: [] } },
  referenceDataVersion: "cty-2026.10", sourceVerification: "verified", sourceNote: "Checked" };
const session: ContestSessionSummary = { sessionID: "session-1", workspaceGeneration: "generation-1", revision: 7, name: "WW", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 0, updatedAt: "2026-10-17T00:00:00Z" };
const fields: ContestDraftFields = { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "05", frequencyHz: 14025000, band: "20m", mode: "CW" };
function draft(revision = 8) { return { draftID: "draft-1", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision, fields, reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" }, updatedAt: "2026-10-17T00:00:01Z" }; }
function result(params: Record<string, unknown>) { const next = { ...session, revision: 8 }; return { session: next, draft: draft(), receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: 8, committedAt: "2026-10-17T00:00:01Z" } }; }
function ssbSession(): ContestSessionSummary {
  return { ...session, rule: { ...rule, identity: { ...rule.identity, id: "cq-ww-ssb" }, displayName: "CQ WW SSB", mode: "SSB",
    entry: { ...rule.entry, mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", cabrilloFormatterVersion: "ssb-pilot-1",
      cabrilloProjectionFormatterVersion: "ssb-pilot-2", report: { format: "phoneRS", defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2 } } } };
}

describe("ContestClient", () => {
  it("keeps durable commit score summaries scalar", () => {
    const summary = { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: 8, qsos: 1, points: 3,
      multipliers: 1, claimedScore: 3, sourceVerification: "provisional" } satisfies ContestScoreSummary;
    expect(summary).not.toHaveProperty("multiplierLabels");
  });

  it("scopes receipt lookup and retries the exact structured operation", async () => {
    const mock = vi.fn().mockRejectedValueOnce(new Error("reply lost")).mockImplementationOnce(async (_method, params) => ({ id: "frame", ok: true, result: result(params) })).mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } });
    const client = new ContestClient(mock as ContestRequest, () => "request-1", async () => "digest-1");
    let uncertain!: ContestMutationUncertain;
    try { await client.applyDraft(session, "draft-1", fields); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain).toBeInstanceOf(ContestMutationUncertain);
    await client.retry(uncertain.operation);
    expect(mock.mock.calls[1]).toEqual(mock.mock.calls[0]);
    await client.receipt(uncertain.operation);
    expect(mock).toHaveBeenLastCalledWith("contest_operation_receipt", { sessionID: "session-1", workspaceGeneration: "generation-1", requestID: "request-1", payloadDigest: "digest-1" });
  });

  it("keeps confirmed validation and stale revision failures editable", async () => {
    for (const code of ["invalid_exchange", "stale_revision"]) {
      const request = vi.fn(async () => ({ id: "frame", ok: false as const, error: { code, message: code, outcome: "confirmed" as const } })) as ContestRequest;
      const client = new ContestClient(request, () => "request", async () => "digest");
      await expect(client.applyDraft(session, "draft-1", fields)).rejects.toMatchObject({ name: "ContestServerError", code, outcome: "confirmed" });
      await client.applyDraft(session, "draft-1", fields).catch(cause => expect(cause).not.toBeInstanceOf(ContestMutationUncertain));
    }
  });

  it("fails closed on malformed dates, modes, IDs, revisions, and old generations", async () => {
    const cases = [
      { ...result({ requestID: "request", payloadDigest: "digest" }), session: { ...session, revision: 8, updatedAt: "not-a-date" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), draft: { ...draft(), fields: { ...fields, mode: "SSB" } } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), draft: { ...draft(), draftID: "wrong" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), receipt: { requestID: "request", payloadDigest: "digest", committedRevision: 9, committedAt: "2026-10-17T00:00:01Z" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), session: { ...session, revision: 8, workspaceGeneration: "old" } },
    ];
    for (const bad of cases) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: bad })) as ContestRequest;
      const client = new ContestClient(request, () => "request", async () => "digest");
      await expect(client.applyDraft(session, "draft-1", fields)).rejects.toMatchObject({ name: "ContestMutationUncertain", operation: { scope: { requestID: "request" } } });
    }
  });

  it("rejects crossed rule families and missing or unknown descriptor versions before any mutation", async () => {
    const crossedMode = structuredClone(rule) as unknown as Record<string, unknown>;
    crossedMode.mode = "SSB"; crossedMode.entry = ssbSession().rule.entry;
    const crossedFamily = structuredClone(rule) as unknown as Record<string, unknown>;
    crossedFamily.entry = { ...rule.entry, exchange: { sent: "serialNumber", received: "serialNumber", sentDefault: "reservedSerial", adifFields: "stxSrx" },
      serial: { requirement: "requiredForCommit", allowedScopes: ["session", "band", "transmitter"] } };
    const sac = structuredClone(rule) as unknown as Record<string, unknown>;
    sac.identity = { id: "sac-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" };
    sac.displayName = "Scandinavian Activity Contest CW";
    sac.entry = { ...rule.entry, exchange: { sent: "serialNumber", received: "serialNumber", sentDefault: "reservedSerial", adifFields: "exchangeStrings" },
      serial: { requirement: "requiredForCommit", allowedScopes: ["session", "band", "transmitter"] } };
    const wrongSACIdentity = structuredClone(sac) as Record<string, unknown>;
    wrongSACIdentity.identity = { ...(sac.identity as Record<string, unknown>), edition: "source-26.10.11" };
    const wrongSACFamily = structuredClone(sac) as Record<string, unknown>;
    (wrongSACFamily.entry as Record<string, any>).exchange.adifFields = "stxSrx";
    const missingVersion = structuredClone(rule) as unknown as Record<string, unknown>; delete missingVersion.entryDescriptorVersion;
    const unknownVersion = { ...rule, entryDescriptorVersion: 2 };
    for (const badRule of [crossedMode, crossedFamily, wrongSACIdentity, wrongSACFamily, missingVersion, unknownVersion]) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: { workspaceGeneration: "generation-1", rules: [badRule] } }));
      const client = new ContestClient(request as ContestRequest);
      await expect(client.catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
      expect(request.mock.calls).toEqual([["contest_catalog", {}]]);
    }
  });

  it("rejects an oversized SSB report in reads and treats it as uncertain after a mutation", async () => {
    const selected = ssbSession();
    const badFields: ContestDraftFields = { ...fields, mode: "SSB", sentReport: "599", receivedReport: "59" };
    const badDraft = { ...draft(7), revision: 7, fields: badFields };
    const openRequest = vi.fn(async () => ({ id: "frame", ok: true as const, result: { session: selected, draft: badDraft } }));
    await expect(new ContestClient(openRequest as ContestRequest).open(selected.sessionID, selected.workspaceGeneration))
      .rejects.toThrow("Malformed or stale contest_open response");
    expect(openRequest.mock.calls).toEqual([["contest_open", { sessionID: selected.sessionID, workspaceGeneration: selected.workspaceGeneration }]]);

    const mutationRequest = vi.fn(async (_method: string, params: Record<string, unknown> = {}) => ({ id: "frame", ok: true as const, result: {
      session: { ...selected, revision: 8 }, draft: { ...badDraft, revision: 8 },
      receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: 8, committedAt: "2026-10-17T00:00:01Z" },
    } }));
    const client = new ContestClient(mutationRequest as ContestRequest, () => "request", async () => "digest");
    await expect(client.applyDraft(selected, badDraft.draftID, { ...badDraft.fields, sentReport: "59" }))
      .rejects.toMatchObject({ name: "ContestMutationUncertain", operation: { scope: { requestID: "request" } } });
    expect(mutationRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects non-finite and oversized outbound values before digesting", async () => {
    expect(() => canonicalJSON({ frequencyHz: Number.NaN })).toThrow("finite");
    expect(() => canonicalJSON({ frequencyHz: Number.POSITIVE_INFINITY })).toThrow("finite");
    expect(() => validateDraftFields({ ...fields, callsign: "X".repeat(33) })).toThrow("oversized");
    expect(() => validateDraftFields({ ...fields, sentReport: "5999" })).toThrow("oversized");
    expect(() => validateCreateInput({ name: "😀".repeat(64), ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
      station: session.station, operator: session.operator })).toThrow("oversized");
    const digest = vi.fn(async () => "digest");
    const client = new ContestClient(vi.fn() as ContestRequest, () => "request", digest);
    await expect(client.applyDraft(session, "draft-1", { ...fields, frequencyHz: Number.NaN })).rejects.toThrow("invalid");
    expect(digest).not.toHaveBeenCalled();
  });

  it("allows partial callsign drafts to reach backend validation and remain editable", () => {
    expect(() => validateDraftFields({ ...fields, callsign: "K" })).not.toThrow();
    expect(() => validateDraftFields({ ...fields, callsign: "K1" })).not.toThrow();
    expect(() => validateDraftFields({ ...fields, callsign: "K1/" })).not.toThrow();
  });

  it("pins exact rule and reference identities into a preallocated create scope", async () => {
    const request = vi.fn(async (_method, params = {}) => ({ id: "frame", ok: true as const, result: result(params) })) as ContestRequest;
    const ids = ["session-new", "request-new"]; const client = new ContestClient(request, () => ids.shift()!, async () => "digest");
    await client.create("generation-1", { name: "WW", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion, station: session.station, operator: session.operator }).catch(() => undefined);
    expect(request).toHaveBeenCalledWith("contest_create", expect.objectContaining({ sessionID: "session-new", expectedRevision: 0, payload: expect.objectContaining({ sessionID: "session-new", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion }) }));
  });

  it("keeps the original commit identity when a committed reply is malformed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { ...result({ requestID: "request-commit", payloadDigest: "digest" }), receipt: { requestID: "request-commit", payloadDigest: "digest", committedRevision: 99, committedAt: "2026-10-17T00:00:01Z" } } })
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } }) as ContestRequest;
    const client = new ContestClient(request, () => "request-commit", async () => "digest"); let uncertain!: ContestMutationUncertain;
    try { await client.commitQSO(session, "draft-1"); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope.requestID).toBe("request-commit"); await client.receipt(uncertain.operation);
    expect(request).toHaveBeenLastCalledWith("contest_operation_receipt", expect.objectContaining({ requestID: "request-commit", sessionID: "session-1" }));
  });

  it("keeps the preallocated create session and request IDs when its committed reply is malformed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { session: { ...session, sessionID: "wrong-session" }, draft: draft(), receipt: { requestID: "request-create", payloadDigest: "digest", committedRevision: 1, committedAt: "2026-10-17T00:00:01Z" } } })
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } }) as ContestRequest;
    const generated = ["session-create", "request-create"], client = new ContestClient(request, () => generated.shift()!, async () => "digest"); let uncertain!: ContestMutationUncertain;
    try { await client.create("generation-1", { name: "WW", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion, station: session.station, operator: session.operator }); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope).toMatchObject({ sessionID: "session-create", requestID: "request-create", expectedRevision: 0 });
    await client.receipt(uncertain.operation); expect(request).toHaveBeenLastCalledWith("contest_operation_receipt", expect.objectContaining({ sessionID: "session-create", requestID: "request-create" }));
  });

  it("generates one finite operation timestamp and preserves it while receipt lookup stays unchanged", async () => {
    const timestamp = "2026-10-17T03:04:05.000Z";
    const mock = vi.fn().mockRejectedValueOnce(new Error("reply lost")).mockImplementationOnce(async (_method, params) => ({ id: "frame", ok: true, result: result(params) })).mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } });
    const request = mock as ContestRequest;
    const client = new ContestClient(request, () => "timestamp-request", async () => "digest", undefined, () => timestamp); let uncertain!: ContestMutationUncertain;
    try { await client.applyDraft(session, "draft-1", fields); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope.operationTimestamp).toBe(timestamp);
    await client.retry(uncertain.operation); expect(mock.mock.calls[1][1].operationTimestamp).toBe(timestamp);
    await client.receipt(uncertain.operation);
    expect(mock.mock.calls[2][1]).toEqual({ sessionID: "session-1", workspaceGeneration: "generation-1", requestID: "timestamp-request", payloadDigest: "digest" });
  });

  it("rejects a noncanonical operation timestamp before dispatch", async () => {
    const request = vi.fn() as ContestRequest;
    const client = new ContestClient(request, () => "request", async () => "digest", undefined, () => "2026-10-17T03:04:05+00:00");
    await expect(client.applyDraft(session, "draft-1", fields)).rejects.toThrow("canonical UTC ISO timestamp");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends an explicit call-history selection through the normal mutation envelope", async () => {
    const request = vi.fn(async () => ({ id: "frame", ok: false as const,
      error: { code: "fixture_stop", message: "captured", outcome: "confirmed" as const } })) as ContestRequest;
    const client = new ContestClient(request, () => "history-request", async () => "history-digest",
      undefined, () => "2026-10-17T03:04:05.000Z");
    const projected = { ...fields, receivedExchange: "04" };
    const selection = {
      context: { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
        sessionRevision: session.revision, draftID: "draft-1", draftRevision: 8,
        inputCallsign: "K1ABC", requestID: "history-query", ruleIdentity: rule.identity,
        referenceDataVersion: session.referenceDataVersion },
      dataset: { generation: "history-generation", sha256: "a".repeat(64), sourceName: "history.any",
        importedAtUTC: "2026-10-17T00:00:00.000Z", byteCount: 1, recordCount: 1,
        indexableRecordCount: 1, unindexableRecordCount: 0, duplicateCallCount: 0 },
      record: { recordID: "record-1", sourceOrdinal: 0, sourceLine: 2, normalizedCallsign: "K1ABC",
        indexingIssue: null, values: [] },
      projections: [{ id: "legacy-received-zone", sourceKey: "cqzone", target: "legacyReceivedExchange",
        fieldID: null, label: "CQ zone", rawValue: "04", normalizedValue: "04" }],
    } as HistorySelection;
    await expect(client.applyHistoryProjection(session, "draft-1", selection,
      ["legacy-received-zone"], projected)).rejects.toMatchObject({ code: "fixture_stop", outcome: "confirmed" });
    expect(request).toHaveBeenCalledWith("contest_history_apply", expect.objectContaining({
      sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      expectedRevision: session.revision, draftID: "draft-1", requestID: "history-request",
      payloadDigest: "history-digest", payload: {
        selection: { ...selection.context, recordID: selection.record.recordID },
        projectionIDs: ["legacy-received-zone"], fields: projected,
      },
    }));
  });

  it("fails closed on unknown and malformed structured descriptor versions", async () => {
    const identity = { id: "naqp-rtty", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8" };
    const malformed = { identity, displayName: "North American QSO Party RTTY", mode: "RTTY", entryDescriptorVersion: 2,
      entry: { version: 2, mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY", cabrilloFormatterVersion: "naqp-preview-1", cabrilloProjectionFormatterVersion: "naqp-preview-1",
        report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
        exchange: { sent: "structured", received: "structured", sentDefault: "stationFields", adifFields: "exchangeStrings", sentFields: [], receivedFields: [] },
        serial: { requirement: "none", allowedScopes: [] }, modeProfiles: [], scorePolicy: "pointsTimesMultipliers" },
      referenceDataVersion: "cty", sourceVerification: "provisional", sourceNote: "preview" };
    for (const candidate of [{ ...malformed, entryDescriptorVersion: 3 }, malformed]) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: { workspaceGeneration: "generation-1", rules: [candidate] } })) as ContestRequest;
      await expect(new ContestClient(request).catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
    }
  });
});
