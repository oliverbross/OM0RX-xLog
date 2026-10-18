import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, validateDraftFields, validateEditableDraftFields } from "./client";
import { ContestSessionOwner, MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";
import activationFixture from "../../../docs/contesting/fixtures/declarative-activation-worker-wire.json";
import arrlDXFixture from "../../../docs/contesting/fixtures/arrl-dx-worker-wire.json";

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/contesting-worker-wire.json", import.meta.url), "utf8"));
const arrlFixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/arrl-rtty-worker-wire.json", import.meta.url), "utf8"));
const recoveryKey = (generation: string) => `xlog.contesting.local-test-workspace.v2:${encodeURIComponent(generation)}`;

function activateRecovered(session: ContestSessionSummary, draft: ContestDraftSnapshot, recovered: ContestDraftSnapshot["fields"]) {
  const storage = new MemoryContestRecoveryStorage();
  storage.setItem(recoveryKey(session.workspaceGeneration), JSON.stringify({ drafts: {
    [`${session.workspaceGeneration}/${session.sessionID}`]: {
      sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, draftID: draft.draftID, fields: recovered,
    },
  } }));
  const owner = new ContestSessionOwner(new ContestClient(vi.fn() as ContestRequest), storage);
  const lease = owner.acquireLease();
  const admission = owner.beginAdmission(lease)!;
  expect(owner.setWorkspaceGeneration(session.workspaceGeneration, lease, admission)).toBe(true);
  expect(owner.activate(session, draft, lease, admission)).toBe(true);
  return owner.draft!.fields;
}

describe("ContestSessionOwner structured recovery", () => {
  it("retains generic serial-name, Ten-Ten, and descriptor-valid aggregates over 64 bytes", () => {
    const profiles = (activationFixture as any).operatorProfiles as { definitionID: string; session: ContestSessionSummary; draft: ContestDraftSnapshot }[];
    const open = profiles.find(item => item.definitionID === "cwops-open")!;
    expect(activateRecovered(open.session, open.draft, open.draft.fields)).toEqual(open.draft.fields);
    const tenTen = profiles.find(item => item.definitionID === "ten-ten-winterPhone")!;
    expect(activateRecovered(tenTen.session, tenTen.draft, tenTen.draft.fields)).toEqual(tenTen.draft.fields);
    const cwt = profiles.find(item => item.definitionID === "cwops-cwt")!;
    const sentExchangeFields = { name: "A".repeat(32), "member-or-location": "B".repeat(32) };
    const fields = { ...cwt.draft.fields, sentExchange: `${sentExchangeFields.name} ${sentExchangeFields["member-or-location"]}`, sentExchangeFields };
    expect(new TextEncoder().encode(fields.sentExchange).length).toBe(65);
    expect(activateRecovered(cwt.session, cwt.draft, fields)).toEqual(fields);
  });

  it.each(["entry", "collection"] as const)("drops a corrupt draft %s without erasing an uncertain operation", corruption => {
    const profile = ((activationFixture as any).operatorProfiles as { session: ContestSessionSummary; draft: ContestDraftSnapshot }[])[0], storage = new MemoryContestRecoveryStorage();
    const operation = { method: "contest_draft_apply", scope: { sessionID: profile.session.sessionID,
      workspaceGeneration: profile.session.workspaceGeneration, requestID: "30000000-0000-4000-8000-000000000001",
      payloadDigest: "a".repeat(64), operationTimestamp: "2026-10-18T00:00:00.000Z", expectedRevision: 1,
      draftID: profile.draft.draftID }, payload: { fields: profile.draft.fields } };
    const corruptEntry = { corrupt: {
      sessionID: profile.session.sessionID, workspaceGeneration: profile.session.workspaceGeneration,
      draftID: profile.draft.draftID, fields: { ...profile.draft.fields, sentExchangeFields: [] },
    } };
    storage.setItem(recoveryKey(profile.session.workspaceGeneration), JSON.stringify({
      drafts: corruption === "entry" ? corruptEntry : [], pending: { operation, phase: "inflight" },
    }));
    const owner = new ContestSessionOwner(new ContestClient(vi.fn() as ContestRequest), storage), lease = owner.acquireLease(), admission = owner.beginAdmission(lease)!;
    expect(owner.setWorkspaceGeneration(profile.session.workspaceGeneration, lease, admission)).toBe(true);
    expect(owner.pendingPhase).toBe("uncertain");
    expect(owner.pendingOperation).toEqual(operation);
    expect(owner.activate(profile.session, profile.draft, lease, admission)).toBe(true);
    expect(owner.draft!.fields).toEqual(profile.draft.fields);
  });

  it("treats malformed recovery JSON as unrecoverable and removes it", () => {
    const profile = ((activationFixture as any).operatorProfiles as { session: ContestSessionSummary; draft: ContestDraftSnapshot }[])[0];
    const storage = new MemoryContestRecoveryStorage(), key = recoveryKey(profile.session.workspaceGeneration);
    storage.setItem(key, "{not-json");
    const owner = new ContestSessionOwner(new ContestClient(vi.fn() as ContestRequest), storage);
    const lease = owner.acquireLease(), admission = owner.beginAdmission(lease)!;
    expect(owner.setWorkspaceGeneration(profile.session.workspaceGeneration, lease, admission)).toBe(true);
    expect(owner.pendingOperation).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("retains a descriptor-valid long NAQP station aggregate", () => {
    const result = fixture.naqp.responses.create.result as { session: ContestSessionSummary; draft: ContestDraftSnapshot };
    const name = "A".repeat(32);
    const fields = { ...result.draft.fields, sentExchange: `${name} CA`, sentExchangeFields: { name, location: "CA" } };
    expect(activateRecovered(result.session, result.draft, fields)).toEqual(fields);
  });

  it("rejects a crossed structured shape from legacy recovery even when it passes the provisional structural bound", () => {
    const result = fixture.responses.create.result as { session: ContestSessionSummary; draft: ContestDraftSnapshot };
    const invalid = { ...result.draft.fields, sentExchange: `${"X".repeat(32)} CA`,
      sentExchangeFields: { name: "X".repeat(32), location: "CA" }, receivedExchangeFields: { name: "", location: "" } };
    expect(activateRecovered(result.session, result.draft, invalid)).toEqual(result.draft.fields);
  });

  it("retains an ARRL draft recovery only for its authoritative descriptor", () => {
    const result = arrlFixture.dx.applyResponse.result as { session: ContestSessionSummary; draft: ContestDraftSnapshot };
    expect(activateRecovered(result.session, result.draft, result.draft.fields)).toEqual(result.draft.fields);
    const naqp = fixture.naqp.responses.create.result as { session: ContestSessionSummary; draft: ContestDraftSnapshot };
    expect(activateRecovered(naqp.session, naqp.draft, result.draft.fields)).toEqual(naqp.draft.fields);
    expect(activateRecovered(result.session, result.draft, naqp.draft.fields)).toEqual(result.draft.fields);
  });

  it("retains bounded ARRL DX intermediate input locally while the wire boundary stays strict", () => {
    const result = (arrlDXFixture as any).scenarios["cw-wve"].create.response.result as {
      session: ContestSessionSummary; draft: ContestDraftSnapshot;
    };
    const fields = { ...result.draft.fields, receivedExchange: "KI",
      receivedExchangeFields: { location: "", power: "KI" } };
    expect(() => validateEditableDraftFields(fields, result.session.rule)).not.toThrow();
    expect(() => validateDraftFields(fields, result.session.rule)).toThrow("selected rule entry descriptor");
    expect(activateRecovered(result.session, result.draft, fields)).toEqual(fields);
    expect(activateRecovered(result.session, result.draft, { ...fields,
      receivedExchangeFields: { location: "", power: "KI", extra: "" } } as any)).toEqual(result.draft.fields);
  });
});
