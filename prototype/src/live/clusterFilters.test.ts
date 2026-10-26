import { describe, expect, it } from "vitest";
import { defaultClusterFilter, filterClusterSpots, normalizeClusterFilter, setSpecialShown } from "./clusterFilters";

describe("normalizeClusterFilter", () => {
  it("fills fields absent from legacy saved and detached projections", () => {
    const legacy = { query: "EA", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster"], worked: [], sort: "newest" };

    expect(normalizeClusterFilter(legacy)).toEqual(expect.objectContaining({
      query: "EA", sources: ["cluster"], spotterContinents: [], excludedSpecials: [],
    }));
  });
  it("retires saved Show only restrictions while preserving hidden types and other filters", () => {
    const migrated = normalizeClusterFilter({ specials: ["RBN"], excludedSpecials: ["CONTEST"], bands: ["20m"] });
    expect(migrated.specials).toEqual([]);
    expect(migrated.excludedSpecials).toEqual(["CONTEST"]);
    expect(migrated.bands).toEqual(["20m"]);
  });
});

describe("filterClusterSpots", () => {
  const spots = [
    { callsign:"DL1ABC", country:"Germany", comment:"CQ", band:"20m", mode:"CW", continent:"EU", spotterContinent:"EU",
      callStatus:"New Call", dxccStatus:"ATNO", specialTags:["CONTEST"], source:"cluster", workedBefore:null,
      receivedAt:20, score:50, frequencyKHz:14_025 },
    { callsign:"VK8OLD", country:"Australia", comment:"POTA", band:"40m", mode:"SSB", continent:"OC", spotterContinent:"NA",
      callStatus:"Worked", dxccStatus:"Worked", specialTags:["POTA"], source:"rbl", workedBefore:10,
      receivedAt:10, score:80, frequencyKHz:7_150 },
  ];

  it("uses the desktop filter semantics without mutating the shared projection", () => {
    const filter = { ...defaultClusterFilter(), query:"germ", bands:["20m"], modes:["CW"], continents:["EU"],
      spotterContinents:["EU"], callStatuses:["New Call"], dxccStatuses:["ATNO"], specials:["CONTEST"],
      sources:["cluster"], worked:["Not worked"], sort:"score" };
    expect(filterClusterSpots(spots, filter).map(spot => spot.callsign)).toEqual(["DL1ABC"]);
    expect(spots.map(spot => spot.callsign)).toEqual(["DL1ABC", "VK8OLD"]);
  });

  it("honours excluded specials and all desktop sort modes", () => {
    expect(filterClusterSpots(spots, { ...defaultClusterFilter(), excludedSpecials:["POTA"] }).map(spot => spot.callsign)).toEqual(["DL1ABC"]);
    expect(filterClusterSpots(spots, { ...defaultClusterFilter(), sort:"score" }).map(spot => spot.callsign)).toEqual(["VK8OLD", "DL1ABC"]);
    expect(filterClusterSpots(spots, { ...defaultClusterFilter(), sort:"frequency" }).map(spot => spot.callsign)).toEqual(["VK8OLD", "DL1ABC"]);
    expect(filterClusterSpots(spots, { ...defaultClusterFilter(), sort:"callsign" }).map(spot => spot.callsign)).toEqual(["DL1ABC", "VK8OLD"]);
  });
  it("Yes leaves unrelated and untagged spots visible; No hides only matching types", () => {
    const mixed = [...spots, { ...spots[0], callsign: "K1PLAIN", specialTags: [] },
      { ...spots[0], callsign: "K1BOTH", specialTags: ["POTA", "CONTEST"] }];
    const shown = setSpecialShown({ ...defaultClusterFilter(), specials: ["RBN"] }, "RBN", true);
    expect(filterClusterSpots(mixed, shown)).toHaveLength(4);
    // Even an old detached snapshot cannot reintroduce the whitelist.
    expect(filterClusterSpots(mixed, { ...shown, specials: ["RBN"] })).toHaveLength(4);
    const hidden = setSpecialShown(shown, "RBN", false);
    expect(filterClusterSpots(mixed, hidden).map(spot => spot.callsign)).toEqual(["DL1ABC", "K1PLAIN", "K1BOTH"]);
    const noContest = setSpecialShown(hidden, "CONTEST", false);
    expect(filterClusterSpots(mixed, noContest).map(spot => spot.callsign)).toEqual(["K1PLAIN"]);
    expect(setSpecialShown(noContest, "RBN", true).excludedSpecials).toEqual(["CONTEST"]);
  });
  it("keeps Local CW separate from network and RBN sources", () => {
    const local = { ...spots[0], source: "local_cw", callsign: "K1LOCAL" };
    expect(filterClusterSpots([...spots, local], { ...defaultClusterFilter(), sources: ["local_cw"] }).map(spot => spot.callsign)).toEqual(["K1LOCAL"]);
    expect(filterClusterSpots([local], { ...defaultClusterFilter(), sources: ["cluster", "rbl"] })).toEqual([]);
    expect(normalizeClusterFilter({ sources: [] }).sources).toEqual([]);
    expect(normalizeClusterFilter().sources).toContain("local_cw");
  });
});
