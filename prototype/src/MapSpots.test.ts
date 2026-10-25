import { describe, expect, it } from "vitest";
import { dxccPrefixLabel, mapSpotBounds, mapSpotDetails, normalizeMapSpots, type MapSpot } from "./MapSpots";

const spot = (values: Partial<MapSpot> = {}): MapSpot => ({
  id: "old-feed", call: "K1ABC", mhz: 14.074, mode: "FT8", band: "20m", country: "United States",
  grid: "FN31", lon: -72, lat: 41, reporter: "OM0RX", note: "CQ", state: "needed", receivedAt: 1, ...values,
});

describe("map spot identity", () => {
  it("allows explicitly location-only operations without inventing a frequency", () => {
    const operation = spot({ mhz: 0, locationOnly: true });
    expect(normalizeMapSpots([operation])).toEqual([operation]);
    expect(normalizeMapSpots([spot({ mhz: 0 })])).toEqual([]);
    expect(mapSpotDetails(operation)[0]).toBe("Scheduled operation · frequency not supplied");
    expect(normalizeMapSpots([spot({ mhz: -1, locationOnly: true })])).toEqual([]);
  });
  it("fits the short span across the date line", () => {
    expect(mapSpotBounds([])).toBeNull();
    expect(mapSpotBounds([spot({ lon: 179, lat: -10 }), spot({ lon: -179, lat: 12 })])).toEqual([[179, -10], [181, 12]]);
    expect(mapSpotBounds([spot()])).toEqual([[-72, 41], [-72, 41]]);
    expect(mapSpotBounds([spot({ lon: 18 }), spot({ lon: -72 })])).toEqual([[-72, 41], [18, 41]]);
  });
  it("chooses the newest valid spot for a normalized call and retains its original feed ID", () => {
    const old = spot({ call: " k1abc " });
    const newest = spot({ id: "new-feed", call: "k1abc", mhz: 7.074, band: "40m", receivedAt: 3 });
    const invalidNewer = spot({ id: "bad-feed", receivedAt: 4, lat: NaN });
    const result = normalizeMapSpots([old, newest, invalidNewer, spot({ id: "middle", receivedAt: 2 })]);
    expect(result).toEqual([{ ...newest, call: "K1ABC" }]);
    expect(old.call).toBe(" k1abc ");
  });

  it("does not depend on snapshot sorting when timestamps are present", () => {
    const data = [spot({ id: "new", receivedAt: 4 }), spot({ id: "old", receivedAt: 1 })];
    expect(normalizeMapSpots(data)[0].id).toBe("new");
    expect(normalizeMapSpots([...data].reverse())[0].id).toBe("new");
  });

  it("keeps input order for fixture ties and ignores missing timestamps beside known newer data", () => {
    expect(normalizeMapSpots([spot({ id: "fixture-a", receivedAt: undefined }), spot({ id: "fixture-b", receivedAt: undefined })])[0].id).toBe("fixture-a");
    expect(normalizeMapSpots([spot({ receivedAt: undefined }), spot({ id: "known", receivedAt: 0 })])[0].id).toBe("known");
  });

  it("rejects invalid identity, coordinates and frequencies but accepts map edges", () => {
    expect(normalizeMapSpots([
      spot({ id: "" }), spot({ call: " " }), spot({ call: "None" }), spot({ lat: 91 }),
      spot({ lon: -181 }), spot({ mhz: Infinity }), spot({ mhz: 0 }),
      spot({ id: "edge", lat: 90, lon: 180 }),
    ]).map(value => value.id)).toEqual(["edge"]);
  });

  it("omits missing-value DXCC labels without losing useful prefix forms", () => {
    for (const value of [null, undefined, "None", " null ", "undefined", "N/A", "None,X"]) expect(dxccPrefixLabel(value)).toBe("");
    expect(dxccPrefixLabel("EA8,EA9")).toBe("EA8");
    expect(dxccPrefixLabel("KH6_KH7")).toBe("KH6/KH7");
  });

  it("shows frequency, classification, source and note as plain detail text", () => {
    expect(mapSpotDetails(spot())).toEqual(["14.074.0 MHz · 20m · FT8", "United States · needed", "Reported by OM0RX", "CQ"]);
  });
});
