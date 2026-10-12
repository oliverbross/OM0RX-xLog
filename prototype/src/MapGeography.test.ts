import { describe, expect, it } from "vitest";
import { bearingAndDistance, grayline, greatCircle, nightHemisphere, solarPosition, type Coordinate } from "./MapGeography";

function inside(point: Coordinate, ring: Coordinate[]): boolean {
  let contained = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index], [priorX, priorY] = ring[previous];
    if ((y > point[1]) !== (priorY > point[1]) &&
      point[0] < (priorX - x) * (point[1] - y) / (priorY - y) + x) contained = !contained;
  }
  return contained;
}

function signedArea(ring: Coordinate[]): number {
  return ring.slice(1).reduce((area, point, index) =>
    area + ring[index][0] * point[1] - point[0] * ring[index][1], 0);
}

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

  it("fills the night hemisphere across equinox, solstices, the date line and polar caps", () => {
    const equinox = nightHemisphere([0, 0])[0];
    expect(equinox[0]).toEqual(equinox.at(-1));
    expect(inside([0, 0], equinox)).toBe(false);
    expect(inside([179, 0], equinox)).toBe(true);
    expect(inside([-179, 0], equinox)).toBe(true);
    const summer = nightHemisphere([0, 23.44])[0];
    expect(signedArea(summer)).toBeGreaterThan(0);
    expect(inside([0, 80], summer)).toBe(false);
    expect(inside([179, 80], summer)).toBe(false);
    expect(inside([0, -80], summer)).toBe(true);
    expect(inside([-179, -80], summer)).toBe(true);
    const winter = nightHemisphere([0, -23.44])[0];
    expect(signedArea(winter)).toBeGreaterThan(0);
    expect(inside([0, 80], winter)).toBe(true);
    expect(inside([179, 80], winter)).toBe(true);
    expect(inside([0, -80], winter)).toBe(false);
    expect(inside([-179, -80], winter)).toBe(false);
    const dateLineSun = nightHemisphere([179, 0])[0];
    expect(inside([179, 0], dateLineSun)).toBe(false);
    expect(inside([-1, 0], dateLineSun)).toBe(true);
  });
});
