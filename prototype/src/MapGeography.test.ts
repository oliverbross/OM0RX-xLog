import { describe, expect, it } from "vitest";
import { bearingAndDistance, grayline, greatCircle, solarPosition } from "./MapGeography";

describe("radio map geography", () => {
  it("places the Sun near the equator and Greenwich at the March equinox noon", () => {
    const [longitude, latitude] = solarPosition(new Date("2026-03-20T12:00:00Z"));
    expect(Math.abs(longitude)).toBeLessThan(5);
    expect(Math.abs(latitude)).toBeLessThan(2);
    expect(grayline(new Date("2026-03-20T12:00:00Z")).length).toBeGreaterThan(0);
  });

  it("draws a great-circle route without a dateline jump", () => {
    const from: [number, number] = [-74, 41], to: [number, number] = [18, 49];
    const route = greatCircle(from, to);
    expect(route[0][0]).toEqual(from);
    expect(route.at(-1)?.at(-1)?.[0]).toBeCloseTo(to[0]);
    expect(route.flat().every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)).toBe(true);
    const metric = bearingAndDistance(from, to);
    expect(metric.distanceKm).toBeGreaterThan(6000);
    expect(metric.distanceKm).toBeLessThan(8000);
    expect((metric.shortBearing + 180) % 360).toBeCloseTo(metric.longBearing);
    const dateline = greatCircle([170, 10], [-170, 10]);
    expect(dateline.length).toBeGreaterThan(1);
    expect(dateline.every(segment => segment.every((point, index) =>
      index === 0 || Math.abs(point[0] - segment[index - 1][0]) <= 180))).toBe(true);
  });
});
