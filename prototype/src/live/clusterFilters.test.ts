import { describe, expect, it } from "vitest";
import { normalizeClusterFilter } from "./clusterFilters";

describe("normalizeClusterFilter", () => {
  it("fills fields absent from legacy saved and detached projections", () => {
    const legacy = { query: "EA", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster"], worked: [], sort: "newest" };

    expect(normalizeClusterFilter(legacy)).toEqual(expect.objectContaining({
      query: "EA", sources: ["cluster"], spotterContinents: [], excludedSpecials: [],
    }));
  });
});
