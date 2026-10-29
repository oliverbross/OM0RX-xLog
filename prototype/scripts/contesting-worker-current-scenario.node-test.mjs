import assert from "node:assert/strict";
import test from "node:test";
import { checkStaleContestRequests, rejectionAssertions } from "./contesting-worker-current-scenario.mjs";

const generation = "f1111111-2222-4333-9444-555555555555";
const projection = { revision: 5, fields: [{ id: "callsign", value: "K1ABC" }] };
function fixture(overrides = {}) {
  const calls = [];
  const call = async (worker, method, params) => {
    assert.equal(worker, "fake-worker"); calls.push({ method, params });
    if (method === "contest_network_pending") {
      assert.equal(params.workspaceGeneration, generation);
      return { workspaceGeneration: generation, contacts: [] };
    }
    assert.equal(method, "contest_projection");
    return { projection: structuredClone(projection) };
  };
  const fail = async (worker, method, params, code) => {
    assert.equal(worker, "fake-worker"); calls.push({ method, params, code });
    if (method === "contest_network_pending") {
      assert.notEqual(params.workspaceGeneration, generation);
      assert.equal(code, "stale_generation");
    } else {
      assert.equal(method, "contest_qso_correct");
      assert.equal(params.expectedRevision, 4);
      assert.equal(params.qsoID, "retained-contact");
      assert.equal(code, "stale_revision");
    }
    return { code };
  };
  return { calls, args: { call, fail, worker: "fake-worker", sessionID: "session", generation,
    projection, correction: { qsoID: "retained-contact", fields: { receive: "579" } }, ...overrides } };
}

test("injects distinct stale generation and revision requests with positive context and unchanged draft controls", async () => {
  const { calls, args } = fixture();
  const checks = await checkStaleContestRequests(args);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(row => row.code).filter(Boolean), ["stale_generation", "stale_revision"]);
  assert.deepEqual(rejectionAssertions(checks), {
    staleGenerationRejected: true, staleRevisionRejected: true, staleGenerationAndRevisionRejected: true,
  });
  assert.equal(checks.generation.requested, calls[1].params.workspaceGeneration);
  assert.equal(checks.revision.requested, calls[2].params.expectedRevision);
});

test("cannot turn missing, wrong-code or non-stale evidence into a combined pass", () => {
  const checks = { generation: { method: "contest_network_pending", code: "stale_generation", requested: "old", current: generation },
    revision: { method: "contest_qso_correct", code: "stale_revision", requested: 4, current: 5 } };
  assert.equal(rejectionAssertions(undefined).staleGenerationAndRevisionRejected, false);
  for (const change of [
    { generation: undefined }, { revision: undefined },
    { generation: { ...checks.generation, code: "invalid_request" } },
    { generation: { ...checks.generation, requested: generation } },
    { revision: { ...checks.revision, code: "invalid_request" } },
    { revision: { ...checks.revision, requested: 5 } },
  ]) assert.equal(rejectionAssertions({ ...checks, ...change }).staleGenerationAndRevisionRejected, false);
});

test("rejects an unexpected error or incorrect positive context response", async () => {
  await assert.rejects(checkStaleContestRequests(fixture({ fail: async () => ({ code: "invalid_request" }) }).args));
  await assert.rejects(checkStaleContestRequests(fixture({ call: async () => ({ workspaceGeneration: "other" }) }).args));
});

test("rejections must leave the full projection unchanged", async () => {
  const { args } = fixture();
  const original = args.call;
  args.call = async (...request) => request[1] === "contest_projection"
    ? { projection: { ...projection, revision: 6 } } : original(...request);
  await assert.rejects(checkStaleContestRequests(args));
});
