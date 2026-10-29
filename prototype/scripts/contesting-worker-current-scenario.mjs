import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

// Exercise the current host's generation-bound network-context read separately
// from mutation revision admission. Neither rejected request may change a draft.
export async function checkStaleContestRequests({ call, fail, worker, sessionID, generation, projection, correction }) {
  const valid = await call(worker, "contest_network_pending", { sessionID, workspaceGeneration: generation, limit: 1 });
  assert.equal(valid.workspaceGeneration, generation);
  const rejectedGeneration = randomUUID();
  assert.notEqual(rejectedGeneration, generation);
  const contextError = await fail(worker, "contest_network_pending",
    { sessionID, workspaceGeneration: rejectedGeneration, limit: 1 }, "stale_generation");
  assert.equal(contextError.code, "stale_generation");
  const expectedRevision = projection.revision - 1;
  const revisionError = await fail(worker, "contest_qso_correct",
    { sessionID, operationID: randomUUID(), expectedRevision, ...correction }, "stale_revision");
  assert.equal(revisionError.code, "stale_revision");
  assert.deepEqual((await call(worker, "contest_projection", { sessionID })).projection, projection);
  return { generation: { method: "contest_network_pending", code: contextError.code,
      requested: rejectedGeneration, current: generation },
    revision: { method: "contest_qso_correct", code: revisionError.code,
      requested: expectedRevision, current: projection.revision } };
}

export function rejectionAssertions(checks) {
  const staleGenerationRejected = checks?.generation?.method === "contest_network_pending" &&
    checks.generation.code === "stale_generation" && typeof checks.generation.current === "string" &&
    typeof checks.generation.requested === "string" && checks.generation.requested !== checks.generation.current;
  const staleRevisionRejected = checks?.revision?.method === "contest_qso_correct" &&
    checks.revision.code === "stale_revision" && Number.isSafeInteger(checks.revision.requested) &&
    Number.isSafeInteger(checks.revision.current) && checks.revision.requested < checks.revision.current;
  return { staleGenerationRejected, staleRevisionRejected,
    staleGenerationAndRevisionRejected: staleGenerationRejected && staleRevisionRejected };
}
import { writeFileSync } from "node:fs";

// The process-owning worker runs the current Python protocol. Keep the legacy
// scenario's user-level invariants, using the same wire contract as Not1MM UI.
export async function currentContestScenario({ first, record, success, error, WorkerProcess,
  inspectDescriptors, assertNormalWorkspaceEmpty, evidenceRoot }) {
  const call = async (worker, method, params = {}) => success(await record(worker, method, params));
  const fail = async (worker, method, params, code) => error(await record(worker, method, params), code);
  const catalog = await call(first, "contest_catalog");
  assert.equal(catalog.protocolVersion, 1);
  assert.equal(catalog.plugins.length, 97);
  assert.ok(catalog.plugins.every(row => row.engine === "not1mm-python"));
  assert.ok(catalog.plugins.some(row => row.id === "cq_ww_cw"));
  assert.ok(catalog.plugins.some(row => row.id === "cq_wpx_cw"));
  // Catalog is intentionally available before a normal logbook exists. Normal
  // log mutations still require an explicit workspace.
  await fail(first, "logbook_operator_draft", {}, "workspace_required");
  const descriptorEvidenceFirst = await inspectDescriptors(first);
  assert.equal((await call(first, "workspace_create", { mode: "empty" })).qso_count, 0);
  assertNormalWorkspaceEmpty(await call(first, "workspace_status"));
  const normalDraft = await call(first, "logbook_operator_draft");
  const generation = normalDraft.draft.generation;
  assert.match(generation, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  const cases = [];
  const fields = projection => Object.fromEntries(projection.fields.map(row => [row.id, row.value]));
  const mutate = async (state, method, changes = {}) => {
    const params = { sessionID: state.id, workspaceGeneration: generation, operationID: randomUUID(),
      expectedRevision: state.projection.revision, ...changes };
    const result = await call(first, method, params);
    assert.deepEqual(result.actions, [], "Plain mutations must not create output actions");
    state.projection = result.projection;
    return { method, params, result };
  };
  const score = async (worker, state, expected) => {
    const result = await call(worker, "contest_score", { sessionID: state.id });
    const actual = result.score;
    assert.deepEqual({ qsos: actual.qsos, points: actual.points, multipliers: actual.multipliers, total: actual.total }, expected);
    return result;
  };
  const log = (worker, state) => call(worker, "contest_log_page", { sessionID: state.id, offset: 0, limit: 25 });
  const replay = async (worker, operation) => {
    const result = await call(worker, operation.method, operation.params);
    assert.equal(result.replayed, true);
    assert.deepEqual({ ...result, replayed: false }, operation.result);
    assert.deepEqual(result.actions, []);
  };
  const receipt = async (worker, state, operation) => {
    const result = await call(worker, "contest_operation_receipt", { sessionID: state.id, operationID: operation.params.operationID });
    assert.equal(result.found, true);
    assert.deepEqual({ ...result.result, replayed: false }, operation.result);
    assert.deepEqual(result.result.actions, []);
    return result;
  };
  const exportChecks = [];
  async function exports(worker, state, expectedCall, expectedScore) {
    for (const format of ["adif", "cabrillo"]) {
      const prepared = await call(worker, "contest_export_prepare", { sessionID: state.id, format, expectedRevision: state.projection.revision });
      assert.ok(prepared.byteLength > 0);
      const scope = { sessionID: state.id, workspaceGeneration: generation, exportID: prepared.artifactID };
      const chunks = []; let offset = 0;
      while (offset < prepared.byteLength) {
        const result = await call(worker, "contest_export_read", { ...scope, offset, length: Math.min(65_536, prepared.byteLength - offset) });
        assert.equal(result.offset, offset);
        const bytes = Buffer.from(result.dataBase64, "base64"); assert.ok(bytes.length > 0);
        chunks.push(bytes); offset += bytes.length;
        assert.equal(result.eof, offset === prepared.byteLength);
      }
      const bytes = Buffer.concat(chunks), text = bytes.toString("utf8");
      assert.equal(bytes.length, prepared.byteLength);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), prepared.sha256);
      assert.ok(text.includes(expectedCall));
      if (format === "cabrillo") assert.match(text, new RegExp(`CLAIMED-SCORE: ${expectedScore}(?:\\r?\\n)`));
      writeFileSync(join(evidenceRoot, `${state.plugin}-${state.projection.revision}.${format === "adif" ? "adi" : "log"}`), bytes, { flag: "wx" });
      await call(worker, "contest_export_release", scope);
      exportChecks.push({ plugin: state.plugin, format, sha256: prepared.sha256, bytes: bytes.length });
    }
  }
  for (const [plugin, worked, exchange, frequency, expected] of [
    ["cq_ww_cw", "K1ABC", "5", 14_025_000, { qsos: 1, points: 3, multipliers: 2, total: 6 }],
    ["cq_wpx_cw", "DL1ABC", "1", 7_025_000, { qsos: 1, points: 2, multipliers: 1, total: 2 }],
  ]) {
    const id = randomUUID();
    const create = { sessionID: id, workspaceGeneration: generation, operationID: randomUUID(), expectedRevision: 0,
      pluginID: plugin, name: `Synthetic ${plugin} process acceptance`,
      station: { Call: "OM0RX", GridSquare: "JN88", CQZone: "15" }, operator: "OM0RX", frequencyHz: frequency,
      settings: { SentExchange: plugin === "cq_ww_cw" ? "15" : "#", OperatorCategory: "SINGLE-OP", BandCategory: "ALL", PowerCategory: "LOW" } };
    const created = await call(first, "contest_create", create);
    assert.equal(created.revision, 1); assert.equal(created.projection.engine, "not1mm-python");
    const state = { id, plugin, projection: created.projection, qsoID: randomUUID(), operations: [] };
    const opened = await call(first, "contest_open", { sessionID: id });
    assert.deepEqual(opened.projection, state.projection);
    await mutate(state, "contest_draft_apply", { fields: { callsign: worked, other_2: exchange } });
    if (plugin === "cq_wpx_cw") assert.equal(Number(fields(state.projection).other_1), 1);
    const committed = await mutate(state, "contest_qso_commit", { qsoID: state.qsoID,
      timestamp: "2026-10-17 03:13:00", frequencyHz: frequency });
    state.operations.push(committed);
    await score(first, state, expected);
    const rows = await log(first, state); assert.equal(rows.total, 1);
    const row = rows.rows[0];
    assert.equal(row.ID, state.qsoID); assert.equal(row.Call, worked); assert.equal(row.Operator, "OM0RX");
    assert.equal(row.TS, "2026-10-17 03:13:00"); assert.equal(row.StationPrefix, "OM0RX");
    assert.equal(row.CountryPrefix, plugin === "cq_ww_cw" ? "K" : "DL");
    if (plugin === "cq_wpx_cw") assert.equal(Number(row.SentNr), 1);
    state.original = row;
    state.receipt = await receipt(first, state, committed);
    await replay(first, committed);
    await fail(first, "contest_qso_commit", { ...committed.params, fields: { callsign: "JA1ABC", other_2: "25" } }, "payload_conflict");
    await exports(first, state, worked, expected.total);
    cases.push(state);
  }
  const [ww, wpx] = cases;
  const pending = await mutate(wpx, "contest_draft_apply", { fields: { callsign: "K1ABC", other_2: "2" }, frequencyHz: 7_025_000 });
  const pendingFields = fields(wpx.projection); assert.equal(Number(pendingFields.other_1), 2);
  assert.equal(wpx.projection.dupe, false);
  const correction = { qsoID: wpx.qsoID, fields: { callsign: "K1ABC", other_2: "2", receive: "579" }, reason: "Synthetic copied-call correction" };
  const forged = await fail(first, "contest_qso_correct", { sessionID: wpx.id, operationID: randomUUID(), expectedRevision: wpx.projection.revision,
    ...correction, fields: { ...correction.fields, CountryPrefix: "FORGED" } }, "invalid_request");
  assert.match(forged.message, /Unknown correction field/);
  const rejectedRequests = await checkStaleContestRequests({ call, fail, worker: first,
    sessionID: wpx.id, generation, projection: wpx.projection, correction });
  const corrected = await mutate(wpx, "contest_qso_correct", correction); wpx.operations.push(corrected);
  await score(first, wpx, { qsos: 1, points: 6, multipliers: 1, total: 6 });
  const correctedRow = (await log(first, wpx)).rows[0];
  assert.equal(correctedRow.Call, "K1ABC"); assert.equal(correctedRow.CountryPrefix, "K");
  for (const key of ["ID", "TS", "SentNr", "Operator", "StationPrefix"]) assert.deepEqual(correctedRow[key], wpx.original[key]);
  assert.deepEqual(fields(wpx.projection), pendingFields); assert.equal(wpx.projection.dupe, true);
  await receipt(first, wpx, corrected);
  const deleted = await mutate(wpx, "contest_qso_delete", { qsoID: wpx.qsoID, reason: "Synthetic invalid contact deletion" });
  wpx.operations.push(deleted);
  assert.equal((await log(first, wpx)).total, 0);
  await score(first, wpx, { qsos: 0, points: 0, multipliers: 0, total: 0 });
  assert.deepEqual(fields(wpx.projection), pendingFields); assert.equal(wpx.projection.dupe, false);
  await receipt(first, wpx, deleted);
  const replacementID = randomUUID();
  const replacement = await mutate(wpx, "contest_qso_commit", { qsoID: replacementID, timestamp: "2026-10-17 03:20:00", frequencyHz: 7_025_000 });
  wpx.operations.push(replacement);
  const replaced = (await log(first, wpx)).rows;
  assert.equal(replaced.length, 1); assert.equal(replaced[0].ID, replacementID); assert.equal(Number(replaced[0].SentNr), 2);
  assert.equal(Number(fields(wpx.projection).other_1), 3);
  await score(first, wpx, { qsos: 1, points: 6, multipliers: 1, total: 6 });
  for (const method of ["cluster_connect", "station_connect", "online_log_configure", "lookup_call"]) await fail(first, method, {}, "external_io_disabled");
  assertNormalWorkspaceEmpty(await call(first, "workspace_status"));
  const descriptorEvidenceAfterMutations = await inspectDescriptors(first), firstExit = await first.stop();
  const second = new WorkerProcess("restart");
  const health = await call(second, "health"); assert.equal(health.mode, "contesting_test");
  assertNormalWorkspaceEmpty(await call(second, "workspace_status"));
  const sessions = await call(second, "contest_sessions"); assert.equal(sessions.sessions.length, 2);
  for (const state of cases) {
    const reopened = await call(second, "contest_open", { sessionID: state.id });
    assert.deepEqual(reopened.projection, state.projection);
    const rows = await log(second, state); assert.equal(rows.total, 1);
    for (const operation of state.operations) { await replay(second, operation); await receipt(second, state, operation); }
  }
  // Cached pre-correction/deletion receipts remain immutable. Their replay must
  // never resurrect the deleted row or reissue its serial in the current log.
  const finalRows = (await log(second, wpx)).rows;
  assert.equal(finalRows.length, 1); assert.equal(finalRows[0].ID, replacementID); assert.equal(Number(finalRows[0].SentNr), 2);
  assert.equal(Number(fields((await call(second, "contest_projection", { sessionID: wpx.id })).projection).other_1), 3);
  await score(second, ww, { qsos: 1, points: 3, multipliers: 2, total: 6 });
  await score(second, wpx, { qsos: 1, points: 6, multipliers: 1, total: 6 });
  assertNormalWorkspaceEmpty(await call(second, "workspace_status"));
  const descriptorEvidenceRestart = await inspectDescriptors(second), secondExit = await second.stop();
  assert.equal(exportChecks.length, 4);
  return { descriptorEvidenceFirst, descriptorEvidenceAfterMutations, descriptorEvidenceRestart, firstExit, secondExit, first, second, rejectedRequests,
    contestMutation: { engine: "not1mm-python", originalQSOID: wpx.qsoID, replacementQSOID: replacementID,
      correctionRequestID: corrected.params.operationID, deletionRequestID: deleted.params.operationID,
      correctedCountryPrefix: correctedRow.CountryPrefix, committedSerials: [1, 2], nextReservedSerial: 3,
      finalRevision: wpx.projection.revision, exportChecks } };
}
