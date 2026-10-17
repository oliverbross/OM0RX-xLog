import { describe, expect, it, vi } from "vitest";
import { canonicalJSON, ContestClient, ContestMutationUncertain, ContestServerError, validateCreateInput, validateDraftFields } from "./client";
import type { ContestDraftFields, ContestRequest, ContestSessionSummary } from "./types";

const rule = { identity: { id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "source-1" }, displayName: "CQ WW CW", mode: "CW", referenceDataVersion: "cty-2026.10", sourceVerification: "verified", sourceNote: "Checked" } as const;
const session: ContestSessionSummary = { sessionID: "session-1", workspaceGeneration: "generation-1", revision: 7, name: "WW", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 0, updatedAt: "2026-10-17T00:00:00Z" };
const fields: ContestDraftFields = { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "05", frequencyHz: 14025000, band: "20m", mode: "CW" };
function draft(revision = 8) { return { draftID: "draft-1", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision, fields, reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" }, updatedAt: "2026-10-17T00:00:01Z" }; }
function result(params: Record<string, unknown>) { const next = { ...session, revision: 8 }; return { session: next, draft: draft(), receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: 8, committedAt: "2026-10-17T00:00:01Z" } }; }

describe("ContestClient", () => {
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
});
