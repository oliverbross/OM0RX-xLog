import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, ContestMutationUncertain, ContestServerError, type ContestMutation } from "./client";
import type { ContestCreateInput, ContestDraftFields, ContestRequest, ContestSessionSummary, ContestWorkerResponse } from "./types";

type WireFixture = {
  schemaVersion: number;
  requests: Record<"create" | "reserve" | "apply" | "commit" | "postCommitApply", Record<string, unknown>>;
  responses: Record<"catalog" | "create" | "apply" | "commit" | "replay" | "confirmedError" | "postCommitUncertain" | "receiptAfterUncertain", ContestWorkerResponse<unknown>> &
    { reserve?: ContestWorkerResponse<unknown> };
  assertions: { replayResultExactlyEqual: boolean; allContestUUIDsCanonicalLowercase: boolean };
  provenance: { liveWorkerResponses: string[]; postCommitUncertain: string };
};

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/contesting-worker-wire.json", import.meta.url), "utf8")) as WireFixture;
type LifecycleRequestKey = "create" | "reserve" | "apply" | "commit";
const lifecycleRequestKey: Record<string, LifecycleRequestKey> = {
  contest_create: "create", contest_serial_reserve: "reserve", contest_draft_apply: "apply", contest_qso_commit: "commit",
};
const UUID_KEYS = new Set(["sessionID", "workspaceGeneration", "requestID", "draftID", "qsoID"]);
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    expect(fixture.schemaVersion).toBe(2);
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
    expect(replayed).toEqual(committed);
    expect(request).toHaveBeenCalledTimes(6);
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
    expect(receipt).toMatchObject({ status: "committed", receipt: { requestID, payloadDigest, committedRevision: 6 } });
  });
});
