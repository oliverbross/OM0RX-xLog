import { describe, expect, it } from "vitest";
import { clearConnectedHandoverMessage, ownAutomaticRotorMotion, rotorCommandParams, rotorIntentCurrent, rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
const native: RotorSnapshot = { owner: "native_dcu1", generation: 2, state: "active", backend: { connected: true, azimuth: 53, name: "Antenna", observed_at: 1 } };
describe("independent rotor contracts", () => {
  it("recognizes only the current armed auto intent at its exact next generation", () => {
    const intent = { owner: "native_dcu1" as const, generation: 2, epoch: 4, id: "unique-auto" };
    const own = { ...native, generation: 3, intent_id: intent.id };
    expect(ownAutomaticRotorMotion(intent, own, 4, true)).toBe(true);
    for (const next of [{ ...own, generation: 4 }, { ...own, intent_id: null }, { ...own, owner: "hamlib" as const }, { ...own, state: "uncertain" as const }, { ...own, backend_available: false }]) expect(ownAutomaticRotorMotion(intent, next, 4, true)).toBe(false);
    expect(ownAutomaticRotorMotion(intent, own, 5, true)).toBe(false);
    expect(ownAutomaticRotorMotion(intent, own, 4, false)).toBe(false);
  });
  it("projects DCU-1 and Hamlib observations independently of radio provider", () => {
    expect(rotorProjection(native)).toMatchObject({ owner: "native_dcu1", connected: true, azimuth: 53 });
    expect(rotorProjection({ owner: "hamlib", generation: 3, state: "active", backend: { fields: { position: { Azimuth: "184", Elevation: "12" } }, observed_at_ms: 1000 } })).toMatchObject({ connected: true, azimuth: 184, elevation: 12, observed_at: 1 });
  });
  it("never converts absent observations or unavailable backend to connected telemetry", () => {
    expect(rotorProjection(null).connected).toBe(false);
    expect(rotorProjection({ ...native, state: "uncertain" }).connected).toBe(false);
    expect(rotorProjection({ ...native, backend_available: false }).connected).toBe(false);
    expect(rotorProjection({ ...native, backend: {} }).azimuth).toBeUndefined();
  });
  it("fences old motion intents after stop, reconnect, owner change and connection loss", () => {
    const intent = { owner: "native_dcu1" as const, generation: 2 };
    expect(rotorIntentCurrent(intent, native)).toBe(true);
    for (const state of [{ ...native, generation: 3 }, { ...native, owner: "hamlib" as const }, { ...native, backend_available: false }, null]) expect(rotorIntentCurrent(intent, state)).toBe(false);
    expect(rotorCommandParams(native, { bearing: 90, owner: "hamlib", generation: 99 })).toEqual({ bearing: 90, owner: "native_dcu1", generation: 2 });
    expect(() => rotorCommandParams(null)).toThrow("connect a rotor");
  });
  it("rejects malformed rotor fencing metadata", () => {
    expect(validRotorSnapshot(native)).toBe(true);
    for (const generation of [-1, NaN, Infinity, 1.5, "2"]) expect(validRotorSnapshot({ ...native, generation })).toBe(false);
    expect(validRotorSnapshot({ ...native, owner: "direct_flex_lan" })).toBe(false);
  });
  it("clears only stale handover guidance after observed connection", () => {
    const handover = "Previous radio disconnected. Connect the selected radio explicitly.";
    expect(clearConnectedHandoverMessage(handover, false)).toBe(handover);
    expect(clearConnectedHandoverMessage(handover, true)).toBe("");
    expect(clearConnectedHandoverMessage("K1ABC · radio frequency and mode confirmed", true)).toContain("confirmed");
  });
});
