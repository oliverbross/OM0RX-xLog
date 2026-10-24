import { describe, expect, it } from "vitest";
import { contestModeForFrequency, contestModeForSpot, decodeContestBandPlan, defaultContestBandPlan, encodeContestBandPlan,
  explicitContestMode, contestSpotWithinModeRange, visibleContestBandRange } from "./contestBandPlan";

describe("contest band plan", () => {
  it("uses the CQ WW 40 m phone operating range and migrates the old generated guide", () => {
    expect(defaultContestBandPlan(["40m"])[0].phone).toEqual({ low:7050, high:7200 });
    const legacy = JSON.stringify({band:"40m",cw:{low:7000,high:7040},data:{low:7040,high:7100},phone:{low:7100,high:7300}});
    expect(decodeContestBandPlan([legacy],["40m"])[0].phone).toEqual({ low:7050, high:7200 });
  });

  it("round-trips contest-specific per-band mode segments", () => {
    const plan = defaultContestBandPlan(["40m"]);
    plan[0].cw.high = 7100;
    expect(decodeContestBandPlan(encodeContestBandPlan(plan), ["40m"])[0].cw).toEqual({ low: 7000, high: 7100 });
  });

  it("falls back safely when a saved segment escapes its amateur band", () => {
    const invalid = [{ ...defaultContestBandPlan(["40m"])[0], phone: { low: 6900, high: 7300 } }];
    expect(decodeContestBandPlan(encodeContestBandPlan(invalid), ["40m"])[0].phone).toEqual({ low: 7050, high: 7200 });
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
    expect(visibleContestBandRange(entry, ["phone"])).toMatchObject({ low: 7050, high: 7200 });
  });

  it("lets explicit spot comments override inferred mode", () => {
    expect(explicitContestMode("CQ RTTY TEST")).toBe("data");
    expect(explicitContestMode("UP 1 CW")).toBe("cw");
    expect(explicitContestMode("strong SSB signal")).toBe("phone");
    expect(explicitContestMode("CQ DX")).toBeNull();
  });

  it("admits an unannotated spot inside a customized single-mode contest segment", () => {
    const entry = defaultContestBandPlan(["40m"])[0];
    entry.phone = { low: 7050, high: 7200 };
    expect(contestModeForSpot(entry, 7060, ["phone"], "CQ TEST")).toBe("phone");
    expect(contestModeForSpot(entry, 7060, ["phone"], "CQ RTTY TEST")).toBe("data");
    expect(contestModeForSpot(entry, 7045, ["phone"], "CQ TEST")).toBe("data");
  });

  it("preserves cluster-inferred digital modes inside an overlapping phone contest segment",()=>{
    const entry=defaultContestBandPlan(["40m"])[0];
    expect(contestModeForSpot(entry,7074,["phone"],"Tnx for QSO","FT8")).toBe("data");
    expect(contestModeForSpot(entry,7052,["phone"],"CQ","FT2")).toBe("data");
    expect(contestModeForSpot(entry,7075,["phone"],"CQ","PSK31")).toBe("data");
    expect(contestModeForSpot(entry,7060,["phone"],"CQ TEST","SSB")).toBe("phone");
    expect(contestModeForSpot(entry,7074,["phone"],"CQ SSB","FT8")).toBe("phone");
    expect(contestModeForSpot(entry,7125,["phone"],"CW UP 1","SSB")).toBe("cw");
    expect(contestModeForSpot(entry,7125,["phone"],"FT-8 -10dB","SSB")).toBe("data");
  });

  it("does not treat explicit phone mode as permission to escape the configured contest segment",()=>{
    const entry=defaultContestBandPlan(["40m"])[0];
    expect(contestSpotWithinModeRange(entry,7045,"phone")).toBe(false);
    expect(contestSpotWithinModeRange(entry,7201,"phone")).toBe(false);
    expect(contestSpotWithinModeRange(entry,7050,"phone")).toBe(true);
    expect(contestSpotWithinModeRange(entry,7200,"phone")).toBe(true);
  });
});
