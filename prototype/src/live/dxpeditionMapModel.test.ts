import { describe, expect, it } from "vitest";
import {
  buildDXpeditionOperations,
  clusterReportedAt,
  dxpeditionMapSpots,
  dxpeditionStatus,
  filterDXpeditionOperations,
  type DXpeditionCatalogueItem,
} from "./dxpeditionMapModel";

const now = new Date("2026-10-24T00:00:00.000Z");
const catalogue: DXpeditionCatalogueItem[] = [{
  id: "adxo:vk9x", kind: "dxpedition", callsign: "VK9X1",
  aliases: ["VK9X2"], name: "Christmas Island", comment: "Two announced calls",
  source: "NG3K ADXO", source_url: "https://www.ng3k.com/Misc/adxoplain.html",
  starts_at: "2026-10-20T00:00:00.000Z", ends_at: "2026-10-30T23:59:59.999Z",
  latitude: -10.49, longitude: 105.63, activation: { sourceEpoch: "feed", spotVersion: "row" },
}];

describe("DXpedition catalogue and configured-cluster join", () => {
  it("converts Foundation timestamps, preserves fractional kHz and matches exact announced aliases only", () => {
    const foundationSeconds = now.getTime() / 1000 - 978_307_200 - 60;
    expect(clusterReportedAt(foundationSeconds)?.toISOString()).toBe("2026-10-23T23:59:00.000Z");
    const operations = buildDXpeditionOperations(catalogue, [
      { id: "s1", callsign: "vk9x2", frequencyKHz: 14_074.5, band: "20m", mode: "FT8", receivedAt: foundationSeconds,
        spotter: "W1AAA", activation: { sourceEpoch: "cluster", spotVersion: "s1" } },
      { id: "s2", callsign: "VK9X20", frequencyKHz: 7_025, band: "40m", mode: "CW", receivedAt: foundationSeconds },
    ], now);
    expect(operations).toHaveLength(1);
    expect(operations[0].observations.map(value => value.id)).toEqual(["s1"]);
    expect(operations[0].observations[0].frequencyHz).toBe(14_074_500);
    expect(operations[0].status).toBe("live");
    expect(operations[0].bands.get("20m")).toEqual(new Set(["FT8"]));
  });

  it("keeps cumulative status, band and alias filters independent", () => {
    const operations = buildDXpeditionOperations(catalogue, [{
      id: "s1", callsign: "VK9X2", frequencyKHz: 14_025, band: "20m", mode: "CW",
      receivedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    }], now);
    expect(operations[0].status).toBe("active");
    expect(filterDXpeditionOperations(operations, "active", "20m", "vk9x2")).toHaveLength(1);
    expect(filterDXpeditionOperations(operations, "live", "20m", "vk9x2")).toHaveLength(0);
    expect(filterDXpeditionOperations(operations, "active", "40m", "vk9x2")).toHaveLength(0);
  });

  it("does not inherit an exact callsign observation from another dated occurrence", () => {
    const future = { ...catalogue[0], id: "adxo:future", starts_at: "2026-10-27T00:00:00.000Z", ends_at: "2026-10-30T23:59:59.999Z" };
    const operations = buildDXpeditionOperations([catalogue[0], future], [{
      id: "s1", callsign: "VK9X1", frequencyKHz: 14_025, band: "20m", mode: "CW",
      receivedAt: "2026-10-24T00:00:00.000Z",
    }], now);
    expect(operations.find(value => value.id === catalogue[0].id)?.observations).toHaveLength(1);
    expect(operations.find(value => value.id === future.id)?.observations).toHaveLength(0);
    expect(operations.find(value => value.id === future.id)?.status).toBe("upcoming");
  });

  it("uses exact 45-minute, 6-hour and 48-hour recency boundaries", () => {
    const operation = (age: number) => ({ startsAt: null, endsAt: null,
      observations: [{ reportedAt: new Date(now.getTime() - age) }] }) as never;
    expect(dxpeditionStatus(operation(45 * 60_000 - 1), now)).toBe("live");
    expect(dxpeditionStatus(operation(45 * 60_000), now)).toBe("active");
    expect(dxpeditionStatus(operation(6 * 3_600_000), now)).toBe("recent");
    expect(dxpeditionStatus(operation(48 * 3_600_000), now)).toBe("idle");
  });

  it("retains the exact observed mode in both operation and map presentation", () => {
    const operations = buildDXpeditionOperations(catalogue, [{
      id: "s1", callsign: "VK9X1", frequencyKHz: 18_100, band: "17m", mode: "RTTY", receivedAt: now.toISOString(),
    }], now);
    expect(operations[0].observations[0].mode).toBe("RTTY");
    expect(dxpeditionMapSpots(operations)[0]).toMatchObject({ mode: "RTTY", callStatus: "live", statusHex: "#3ee58d" });
  });

  it("retains recently ended logged activity and ages it out without fabricating a frequency", () => {
    const ended = { ...catalogue[0], ends_at: "2026-10-23T23:00:00Z", last_qso_at: "2026-10-23T22:00:00Z", qso_total: 45535 };
    const operations = buildDXpeditionOperations([ended], [], now);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "active", qsoTotal: 45535 });
    expect(dxpeditionMapSpots(operations)[0]).toMatchObject({ locationOnly: true, mhz: 0 });
    expect(buildDXpeditionOperations([ended], [], new Date("2026-10-26T00:00:00Z"))).toHaveLength(0);
  });

  it("preserves historical band evidence but prefers native authority for a duplicated live observation", () => {
    const spot = { id: "history:one", callsign: "VK9X1", frequencyKHz: 14074.5, band: "20m", mode: "FT8", receivedAt: now.toISOString() };
    const operations = buildDXpeditionOperations(catalogue, [spot, { ...spot, id: "native:one", activation: { sourceEpoch: "native", spotVersion: "one" } }], now);
    expect(operations[0].observations).toHaveLength(1);
    expect(operations[0].observations[0].id).toBe("native:one");
  });
});
