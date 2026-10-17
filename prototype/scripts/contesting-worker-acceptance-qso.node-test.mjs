import assert from "node:assert/strict";
import test from "node:test";
import { correctedQSOFromRead } from "./contesting-worker-acceptance-qso.mjs";

const full = {
  qsoID: "qso", sessionID: "session", originalUTC: "2026-10-17T03:13:00.000Z",
  callsign: "DL1ABC", band: "40m", mode: "CW", frequencyHz: 7_025_000,
  sentReport: "599", receivedReport: "599", sentExchange: "001", normalizedSentExchange: "001",
  allocatedSerial: "001", receivedExchange: "1", normalizedReceivedExchange: "1",
  entity: { adif: 230, countryPrefix: "DL" }, operatorCallsign: "OM0RX", stationLocation: "",
  provenance: { source: "operatorEntry", sourceIdentity: "cty", importedClaimedScore: null },
  ruleIdentity: { id: "cq-wpx-cw", version: "1", edition: "2026", sourceRevision: "source" },
  referenceDataVersion: "cty",
};

test("builds an entity-free correction while preserving immutable contact identity", () => {
  const corrected = correctedQSOFromRead(full, {
    callsign: "K1ABC", receivedReport: "579", receivedExchange: "2", normalizedReceivedExchange: "2",
  });
  assert.equal(corrected.callsign, "K1ABC");
  assert.equal(corrected.receivedExchange, "2");
  assert.equal("entity" in corrected, false);
  assert.equal(corrected.qsoID, full.qsoID);
  assert.equal(corrected.originalUTC, full.originalUTC);
  assert.equal(corrected.allocatedSerial, "001");
  assert.deepEqual(corrected.provenance, full.provenance);
});

test("rejects harness edits to immutable fields", () => {
  assert.throws(() => correctedQSOFromRead(full, { originalUTC: "2026-10-17T03:14:00.000Z" }),
    /cannot change originalUTC/);
  assert.throws(() => correctedQSOFromRead(full, { entity: { adif: 291 } }), /cannot change entity/);
});
