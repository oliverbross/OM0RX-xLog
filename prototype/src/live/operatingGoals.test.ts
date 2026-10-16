import { expect, it, vi } from "vitest";
import { evaluateOperatingGoals, readOperatingGoalResult } from "./operatingGoals";

const result = () => ({ evaluated_at: 1_800_000_000, station_scope: { profile_id: 7, callsign: "OM0RX", all_stations: false },
  sources: { contacts: { state: "retained", count: 12 }, opportunities: { state: "retained", count: 2 }, cluster_observations: { state: "not_included", count: 0 } },
  evaluations: [{ goal: { id: "call:K1ABC", type: "callsign", callsign: "K1ABC" }, worked: true, worked_count: 2,
    confirmed: true, confirmed_count: 1, evidence_eligible: null, credited: null,
    reasons: ["Worked in the selected local station history.", "Paper/LoTW confirmation recorded locally.", "Sponsor evidence eligibility and target credit have not been assessed."],
    evidence: [{ id: "feed-1", source: "Official retained feed", source_url: "https://example.test/feed", callsign: "K1ABC", reference: "K-0001", band: "20m", mode: "SSB",
      observed_at: 1_799_999_970, time_basis: "publisher_observed_at", expires_at: 1_800_000_090, starts_at: null, age_seconds: 30, freshness: "active",
      reason: "Selected goal matches unexpired source evidence; current activity is unverified." }] }], read_only: true, tunes: false, transmits: false });

it("accepts distinct local completion and unknown sponsor states while preserving the cluster omission", () => {
  const value = readOperatingGoalResult(result());
  expect(value.evaluations[0]).toMatchObject({ worked: true, confirmed: true, evidence_eligible: null, credited: null });
  expect(value.sources.cluster_observations).toEqual({ state: "not_included", count: 0 });
});

it.each([
  { read_only: false },
  { sources: { ...result().sources, cluster_observations: { state: "retained", count: 1 } } },
  { evaluations: [{ ...result().evaluations[0], worked: false }] },
  { evaluations: [{ ...result().evaluations[0], evidence_eligible: "unknown" }] },
  { evaluations: [{ ...result().evaluations[0], goal: { id: "reference:fake:K-0001", type: "reference", programme: "FAKE", reference: "K-0001" } }] },
  { evaluated_at: 32_503_680_000 },
  { evaluations: [{ ...result().evaluations[0], evidence: [{ ...result().evaluations[0].evidence[0], observed_at: -32_503_680_000 }] }] },
  { evaluations: [{ ...result().evaluations[0], evidence: [{ ...result().evaluations[0].evidence[0], expires_at: 32_503_680_000 }] }] },
  { evaluations: [{ ...result().evaluations[0], evidence: [{ ...result().evaluations[0].evidence[0], starts_at: 32_503_680_000 }] }] },
])("rejects unverified or broadened projections %j", change => {
  expect(() => readOperatingGoalResult({ ...result(), ...change })).toThrow("could not be verified");
});

it("requests only the read-only evaluator with explicit goals, scope and clock", async () => {
  const request = vi.fn(async () => ({ result: result() }));
  await evaluateOperatingGoals([{ type: "callsign", callsign: "K1ABC" }], { profileID: 7, stationCall: "OM0RX" }, request, () => 1_800_000_000);
  expect(request).toHaveBeenCalledWith("operating_goals_evaluate", { goals: [{ type: "callsign", callsign: "K1ABC" }], now: 1_800_000_000, station_profile_id: 7, station_call: "OM0RX" });
});
