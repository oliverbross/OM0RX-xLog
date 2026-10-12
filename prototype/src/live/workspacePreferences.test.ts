import { describe, expect, it } from "vitest";
import { bandMapView, migrateLegacyBandMaps, validBandMapView, withBandMapView } from "./workspacePreferences";
import type { WorkspacePreferences } from "./workspacePreferences";

const native: WorkspacePreferences = {
  deskBandMapBands: ["20m"], detachedBandMapBands: ["160m", "80m"],
  deskBandMapFollowsRadio: true, detachedBandMapFollowsRadio: false,
  detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
  intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false,
};

describe("isolated workspace band-map preferences", () => {
  it("maps desk and detached choices without dropping unrelated native preferences", () => {
    const next = withBandMapView(native, false, { bands: ["17m"], followRadio: true, layout: "row", fontScale: 1.4 });
    expect(next.detachedBandMapLayout).toBe("Single row");
    expect(next.deskBandMapBands).toEqual(["20m"]);
    expect(next.intelligenceBands).toEqual(["20m"]);
    expect(bandMapView(next, false)).toEqual({ bands: ["17m"], followRadio: true, layout: "row", fontScale: 1.4 });
    expect(validBandMapView({ bands: ["20m", "20m"], followRadio: false, layout: "grid", fontScale: 1 })).toBe(false);
  });

  it("migrates valid older browser choices once and ignores malformed values", () => {
    const items: Record<string, string> = {
      "xlog.integration.bandMaps.desk.bands": '["40m","20m"]',
      "xlog.integration.bandMaps.desk.followRadio": "false",
      "xlog.integration.bandMaps.workspace.bands": '["17m","bogus"]',
      "xlog.integration.bandMaps.workspace.layout": "row",
      "xlog.integration.bandMaps.workspace.fontScale": "1.5",
    };
    const storage = { getItem: (key: string) => items[key] ?? null };
    expect(migrateLegacyBandMaps(native, storage)).toMatchObject({
      deskBandMapBands: ["40m", "20m"], detachedBandMapBands: ["17m"],
      deskBandMapFollowsRadio: false, detachedBandMapLayout: "Single row", bandMapFontScale: 1.5,
    });
    expect(migrateLegacyBandMaps(native, { getItem: () => null })).toBeNull();
  });
});
