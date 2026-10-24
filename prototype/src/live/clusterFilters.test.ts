import { describe, expect, it } from "vitest";
import { defaultClusterFilter, filterClusterSpots, normalizeClusterFilter } from "./clusterFilters";

describe("normalizeClusterFilter", () => {
  it("fills fields absent from legacy saved and detached projections", () => {
    const legacy = { query: "EA", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster"], worked: [], sort: "newest" };

    expect(normalizeClusterFilter(legacy)).toEqual(expect.objectContaining({
      query: "EA", sources: ["cluster"], spotterContinents: [], excludedSpecials: [],
    }));
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
});
