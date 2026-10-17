import { describe, expect, it } from "vitest";
import { clusterBatch, decodeClassifications, opportunityLabel, classificationTone } from "../src/integration";
import { emptyDraft, spots, MAX_SESSION_QSOS, initialState, reducer } from "../src/model";

const response = () => ({ schema_version: 1, history_scope: "synthetic_session", station_io: false,
  spots: spots.map(s => ({ id: s.id, call: s.call, frequency_hz: Math.round(s.mhz * 1e6), band: s.band, mode: s.mode,
    call_status: "New Call", dxcc_status: "ATNO", score: 85 })) });
describe("native cluster classification boundary", () => {
  it("caps complete session history before the worker limit and preserves data at capacity", () => {
    const qsos = Array.from({ length: MAX_SESSION_QSOS }, (_, i) => ({ ...emptyDraft(), call: "LONGCALL1234567890ABC", id: `q${i}`, time: "2026-10-12T00:00:00Z", profile: "manual" as const }));
    expect(new TextEncoder().encode(JSON.stringify({ id: "x".repeat(128), method: "cluster_classify", params: clusterBatch(qsos) })).length).toBeLessThan(32768);
    const state = { ...initialState, qsos, draft: { ...emptyDraft(), call: "W1AW" } };
    const after = reducer(state, { type: "log", id: "overflow", time: qsos[0].time });
    expect(after.qsos).toBe(qsos);
    expect(after.draft).toBe(state.draft);
    expect(after.error).toContain("128 QSOs");
  });
  it("sends logged frequency and mode rather than the fixture band", () => {
    const batch = clusterBatch([{ ...emptyDraft(), call: "W1AW", frequency: "7.100000", id: "q1", time: "2026-10-12T00:00:00Z", profile: "simulator" }]);
    expect(batch.contacts[0]).toMatchObject({ frequency_hz: 7_100_000, adif: 291 });
    expect(batch.spots).toHaveLength(9);
    expect(batch.history_scope).toBe("synthetic_session");
  });
  it("keeps unknown callsigns without guessed DXCC entities", () => {
    const batch = clusterBatch([{ ...emptyDraft(), call: "XX1ZZ", id: "q1", time: "2026-10-12T00:00:00Z", profile: "manual" }]);
    expect(batch.contacts[0].adif).toBeNull();
  });
  it("requires complete correlated native results", () => {
    expect(Object.keys(decodeClassifications(response()))).toHaveLength(9);
    expect(() => decodeClassifications({ ...response(), station_io: true })).toThrow();
    expect(() => decodeClassifications({ ...response(), spots: [] })).toThrow();
    const duplicated = response(); duplicated.spots[1] = duplicated.spots[0];
    expect(() => decodeClassifications(duplicated)).toThrow();
    const wrong = response(); wrong.spots[0].frequency_hz++;
    expect(() => decodeClassifications(wrong)).toThrow();
  });
  it("presents domain results without recomputing award rules", () => {
    const value = response().spots[0];
    expect(opportunityLabel(value)).toBe("ATNO");
    expect(opportunityLabel({ ...value, dxcc_status: "Worked" })).toBe("NC");
    expect(opportunityLabel({ ...value, dxcc_status: "Worked", call_status: "New Call" })).toBe("NC");
    expect(opportunityLabel({ ...value, dxcc_status: "Confirmed", call_status: "Confirmed" })).toBe("C");
    expect(opportunityLabel(undefined)).toBe("—");
    expect(classificationTone(value)).toBe("needed");
    expect(classificationTone({ ...value, call_status: "Worked", dxcc_status: "Worked" })).toBe("worked");
    expect(classificationTone(undefined)).toBe("secondary");
  });
});
