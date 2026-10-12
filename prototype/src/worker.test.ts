import { describe, expect, it } from "vitest";
import { findDetachedSpot, validMonitorProjection } from "./worker";

describe("detached monitor provider projection", () => {
  it("accepts direct FLEX state only when source matches provider", () => {
    expect(validMonitorProjection({ spots: [], provider: "direct_flex_lan", controlsEnabled: true,
      station: { source: "direct_flex_lan", radio: { connected: true } } })).toBe(true);
    expect(validMonitorProjection({ spots: [], provider: "direct_flex_lan", controlsEnabled: true,
      station: { source: "direct_agent" } })).toBe(false);
  });
});

describe("detached cluster spot selection", () => {
  it("resolves only a current real spot ID from the main projection", () => {
    const spots = [{ id: "live-1", callsign: "EA7EU" }];
    expect(findDetachedSpot({ kind: "dx-cluster", spotId: "live-1" }, spots)).toBe(spots[0]);
    expect(findDetachedSpot({ kind: "dx-cluster", spotId: "expired" }, spots)).toBeNull();
    expect(findDetachedSpot({ kind: "unknown", spotId: "live-1" }, spots)).toBeNull();
  });
});
