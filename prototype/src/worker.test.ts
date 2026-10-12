import { describe, expect, it } from "vitest";
import { validMonitorProjection } from "./worker";

describe("detached monitor provider projection", () => {
  it("accepts direct FLEX state only when source matches provider", () => {
    expect(validMonitorProjection({ spots: [], provider: "direct_flex_lan", controlsEnabled: true,
      station: { source: "direct_flex_lan", radio: { connected: true } } })).toBe(true);
    expect(validMonitorProjection({ spots: [], provider: "direct_flex_lan", controlsEnabled: true,
      station: { source: "direct_agent" } })).toBe(false);
  });
});
