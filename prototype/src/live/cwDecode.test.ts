import { describe, expect, it } from "vitest";
import { parseCWDecodeSnapshot } from "./cwDecode";
import { cwDecodeFixture, cwDecodeTrackFixture } from "./cwDecode.fixtures";

describe("native CW Decode projection", () => {
  it("accepts passive and active native-shaped snapshots", () => {
    expect(parseCWDecodeSnapshot(cwDecodeFixture()).state).toBe("stopped");
    expect(parseCWDecodeSnapshot(cwDecodeTrackFixture()).tracks).toHaveLength(1);
  });
  it("rejects lossy capture identity, unqualified RF and unbounded arrays", () => {
    const numericEpoch = cwDecodeTrackFixture(); (numericEpoch.tracks[0].descriptor as any).epoch = 12;
    expect(() => parseCWDecodeSnapshot(numericEpoch)).toThrow();
    const frequency = cwDecodeTrackFixture(); frequency.tracks[0].frequencyHz = 14031200;
    expect(() => parseCWDecodeSnapshot(frequency)).toThrow();
    const count = cwDecodeTrackFixture(); count.tracks = Array.from({ length: 33 }, () => count.tracks[0]);
    expect(() => parseCWDecodeSnapshot(count)).toThrow();
    const local = cwDecodeFixture(); local.listener.address = "0.0.0.0";
    expect(() => parseCWDecodeSnapshot(local)).toThrow();
  });
  it("bounds observed FLEX resource metadata and rejects duplicate capabilities", () => {
    const fixture = cwDecodeFixture(); fixture.capabilities = [{ radioID: "radio1", provider: "flex_dax_iq", ready: true, receivers: [], requestableSampleRates: [96000],
      inventoryRevision: "9", stationHandle: 0x1234, panadapters: [{ id: "40000000", channel: 1, clientHandle: 0x1234, centreHz: 14025000 }], handoffPanadapters: [] }];
    expect(parseCWDecodeSnapshot(fixture).capabilities[0].panadapters?.[0].id).toBe("40000000");
    fixture.capabilities[0].panadapters![0].id = "not-a-pan";
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    fixture.capabilities[0].panadapters![0].id = "40000000";
    fixture.capabilities.push(structuredClone(fixture.capabilities[0]));
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
});
