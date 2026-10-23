import { describe, expect, it } from "vitest";
import { contestModeForFrequency, decodeContestBandPlan, defaultContestBandPlan, encodeContestBandPlan,
  explicitContestMode, visibleContestBandRange } from "./contestBandPlan";

describe("contest band plan", () => {
  it("round-trips contest-specific per-band mode segments", () => {
    const plan = defaultContestBandPlan(["40m"]);
    plan[0].cw.high = 7100;
    expect(decodeContestBandPlan(encodeContestBandPlan(plan), ["40m"])[0].cw).toEqual({ low: 7000, high: 7100 });
  });

  it("falls back safely when a saved segment escapes its amateur band", () => {
    const invalid = [{ ...defaultContestBandPlan(["40m"])[0], phone: { low: 6900, high: 7300 } }];
    expect(decodeContestBandPlan(encodeContestBandPlan(invalid), ["40m"])[0].phone).toEqual({ low: 7100, high: 7300 });
  });

  it("uses digital then CW precedence and phone for the remaining spectrum", () => {
    const entry = defaultContestBandPlan(["40m"])[0];
    entry.cw.high = 7100;
    expect(contestModeForFrequency(entry, 7050)).toBe("data");
    entry.data.low = 7070;
    expect(contestModeForFrequency(entry, 7050)).toBe("cw");
    expect(contestModeForFrequency(entry, 7150)).toBe("phone");
  });

  it("constrains a phone-only contest map to the configured phone segment", () => {
    const entry = defaultContestBandPlan(["40m"])[0];
    expect(visibleContestBandRange(entry, ["phone"])).toMatchObject({ low: 7100, high: 7300 });
  });

  it("lets explicit spot comments override inferred mode", () => {
    expect(explicitContestMode("CQ RTTY TEST")).toBe("data");
    expect(explicitContestMode("UP 1 CW")).toBe("cw");
    expect(explicitContestMode("strong SSB signal")).toBe("phone");
    expect(explicitContestMode("CQ DX")).toBeNull();
  });
});
