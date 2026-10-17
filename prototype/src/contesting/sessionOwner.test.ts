import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient } from "./client";
import { ContestSessionOwner, MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/contesting-worker-wire.json", import.meta.url), "utf8"));
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
});
