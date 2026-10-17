import assert from "node:assert/strict";

const EDITABLE_KEYS = new Set([
  "callsign", "sentReport", "receivedReport", "receivedExchange",
  "normalizedReceivedExchange", "frequencyHz", "band", "mode",
]);

export function correctedQSOFromRead(qso, changes) {
  assert.ok(qso && typeof qso === "object" && !Array.isArray(qso), "A full QSO read is required.");
  for (const key of Object.keys(changes)) assert.ok(EDITABLE_KEYS.has(key), `Acceptance correction cannot change ${key}.`);
  const { entity: _serverResolvedEntity, ...correction } = qso;
  const result = { ...correction, ...changes };
  assert.equal("entity" in result, false, "Correction requests must not supply entity data.");
  for (const key of ["qsoID", "sessionID", "originalUTC", "operatorCallsign", "stationLocation",
    "sentExchange", "normalizedSentExchange", "allocatedSerial", "provenance", "ruleIdentity", "referenceDataVersion"]) {
    assert.deepEqual(result[key], qso[key], `Acceptance correction changed immutable ${key}.`);
  }
  return result;
}
