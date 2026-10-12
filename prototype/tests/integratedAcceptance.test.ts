import { describe, expect, it } from "vitest";
import { validIsolatedHealth, validSavedContact } from "../src/integratedAcceptance";

describe("current integrated UI evidence", () => {
  it("requires the isolated real logbook with every external service disabled", () => {
    const health = { mode: "isolated_local_acceptance", isolated_workspace: true, local_logbook: true,
      platform_services: false, station_io: false, credentials_accessed: false, network_contact: false };
    expect(validIsolatedHealth(health)).toBe(true);
    for (const key of ["isolated_workspace", "local_logbook"]) expect(validIsolatedHealth({ ...health, [key]: false })).toBe(false);
    for (const key of ["platform_services", "station_io", "credentials_accessed", "network_contact"]) expect(validIsolatedHealth({ ...health, [key]: true })).toBe(false);
    expect(validIsolatedHealth({ ...health, mode: "integrated" })).toBe(false);
    expect(validIsolatedHealth({})).toBe(false);
  });
  it("requires exact persisted contact fields, not just a successful response", () => {
    const row = { call: "W1AW", frequencyHz: 14_240_000, band: "20m", mode: "SSB", comment: "Isolated native UI acceptance" };
    expect(validSavedContact({ total: 1, qsos: [row] })).toBe(true);
    expect(validSavedContact({ total: 0, qsos: [] })).toBe(false);
    expect(validSavedContact({ total: 2, qsos: [row, row] })).toBe(false);
    for (const key of Object.keys(row)) expect(validSavedContact({ total: 1, qsos: [{ ...row, [key]: "wrong" }] })).toBe(false);
  });
});
