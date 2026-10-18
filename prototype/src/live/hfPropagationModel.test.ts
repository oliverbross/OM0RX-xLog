import { describe, expect, it } from "vitest";
import { callsignContinent, defaultPropagationSettings, matrixCounts, mergeSpots, ownGrid, parseDXHeat, parseOwnRBN, parseOwnWSPR, parsePSKReporter, parseWSPR, readPropagationSettings } from "./hfPropagationModel";

describe("HF propagation model", () => {
  it("normalizes live source payloads without accepting arbitrary settings", () => {
    const wspr = parseWSPR({ data: [["2026-10-18 00:02:00", 14, "OM0RX", "VK8NSB", 13400]] });
    expect(wspr[0]).toMatchObject({ band: "20m", mode: "WSPR", source: "wspr", txContinent: "EU", rxContinent: "OC", count: 1 });
    const own = parseOwnWSPR({ data: [["2026-10-18 00:02:00", 14, "OM0RX", "VK8NSB", -13]] }, "OM0RX");
    expect(own[0]).toMatchObject({ kind: "tx", continent: "OC", snr: -13 });
    const pskr = parsePSKReporter('<receptionReport flowStartSeconds="1792281720" senderCallsign="JA1ABC" receiverCallsign="W1AW" frequency="14074000" mode="FT8"/>');
    expect(pskr[0]).toMatchObject({ band: "20m", mode: "FT8", txContinent: "AS", rxContinent: "NA" });
    const dx = parseDXHeat([{ Frequency: "14025", DXCall: "G3ABC", Spotter: "K1ABC", Date: "18/10/26", Time: "00:10", Mode: "CW", Continent_dx: "EU", Continent_spotter: "NA" }]);
    expect(dx.cluster).toHaveLength(1); expect(dx.rbn).toHaveLength(1);
    const rbn = parseOwnRBN({ spots: { "42": ["MM9PSY", "3555.7", "OM0RX", 21, 18, "0229z", 0, 7, 1, 1, 1792290553] },
      call_info: { MM9PSY: ["GM", "Scotland", "EU", "scotland", "27", "14", "56", "-3", "IO86HA", "skimmer"] } }, "OM0RX");
    expect(rbn[0]).toMatchObject({ spotter: "MM9PSY", band: "80m", frequencyKHz: 3555.7, mode: "CW", snr: 21, speed: 18, country: "Scotland", continent: "EU", grid: "IO86HA" });
    expect(callsignContinent("EA8/OM0RX")).toBe("AF");
    const unsafe = JSON.stringify({ version: 1, mode: "DX", ownCall: "x';drop", locator: "JN88<script>", bands: ["20m", "bad"], enabledSources: ["wspr", "evil"], matrixModes: ["CW", "SQL"], chartModes: ["SSB"] });
    expect(readPropagationSettings(unsafe)).toMatchObject({ ownCall: "XDROP", locator: "JN88SC", bands: ["20m"], enabledSources: ["wspr"], matrixModes: ["CW"], chartModes: ["SSB"] });
  });

  it("uses the last completed ten-minute window and keeps independent mode filters", () => {
    const now = Date.UTC(2026, 9, 18, 0, 25), settings = { ...defaultPropagationSettings(), bands: ["20m"], matrixModes: ["CW" as const] };
    const base = { tx: "OM0RX", rx: "W1AW", band: "20m", source: "cluster" as const, txContinent: "EU" as const, rxContinent: "NA" as const, distance: 0 };
    const matrix = matrixCounts([
      { ...base, time: Date.UTC(2026, 9, 18, 0, 15), mode: "CW" },
      { ...base, time: Date.UTC(2026, 9, 18, 0, 16), mode: "SSB" },
      { ...base, time: Date.UTC(2026, 9, 18, 0, 22), mode: "CW" },
    ], settings, now);
    expect(matrix["20m"].EU).toBe(1); expect(matrix["20m"].NA).toBe(1);
  });

  it("retains exact WSPR totals after compacting paths by time, band and continent", () => {
    const spots = parseWSPR({ data: [
      ["2026-10-18 00:12:00", 14, "OM0RX", "W1AW", 7000],
      ["2026-10-18 00:12:00", 14, "OK1ABC", "K1ABC", 7100],
    ] });
    expect(spots).toHaveLength(1); expect(spots[0].count).toBe(2);
    const settings = { ...defaultPropagationSettings(), bands: ["20m"], matrixModes: ["WSPR" as const] };
    const matrix = matrixCounts(spots, settings, Date.UTC(2026, 9, 18, 0, 25));
    expect(matrix["20m"].EU).toBe(2); expect(matrix["20m"].NA).toBe(2);
  });

  it("replaces legacy WSPR cache rows and retains distinct aggregated continent paths", () => {
    const now = Date.UTC(2026, 9, 18, 0, 25), time = Date.UTC(2026, 9, 18, 0, 12);
    const legacy = { time, tx: "OM0RX", rx: "W1AW", band: "20m", mode: "WSPR" as const,
      source: "wspr" as const, txContinent: "EU" as const, rxContinent: "NA" as const, distance: 7000 };
    const aggregates = [
      { ...legacy, tx: "", rx: "", count: 42 },
      { ...legacy, tx: "", rx: "", txContinent: "EU" as const, rxContinent: "OC" as const, count: 17 },
    ];
    const merged = mergeSpots([legacy], aggregates, now);
    expect(merged).toHaveLength(2);
    expect(merged.map(spot => spot.count)).toEqual([42, 17]);
  });

  it("builds own-call band and continent cells with average SNR", () => {
    const now = Date.UTC(2026, 9, 18, 0, 20), grid = ownGrid([
      { time: now - 60_000, band: "20m", kind: "tx", other: "W1AW", continent: "NA", snr: -10 },
      { time: now - 120_000, band: "20m", kind: "tx", other: "K1ABC", continent: "NA", snr: -14 },
    ], "tx", ["20m"], now);
    expect(grid["20m"].NA).toEqual({ count: 2, average: -12 });
  });
});
