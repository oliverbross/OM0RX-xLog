import { expect, it } from "vitest";
import { expeditionLabelOffset } from "./MapMarkerLayout";

it("keeps coincident expedition labels separate and inside the map, retaining their true anchor", () => {
  const anchor = { x: 400, y: 300 }, placed: { x: number; y: number }[] = [];
  const offsets = Array.from({ length: 8 }, () => expeditionLabelOffset(anchor, placed, 900, 600));
  expect(new Set(offsets.map(value => value.join(","))).size).toBe(8);
  for (let index = 0; index < placed.length; index++) {
    expect(placed[index].x).toBeGreaterThanOrEqual(72);
    expect(placed[index].x).toBeLessThanOrEqual(828);
    for (const other of placed.slice(index + 1)) expect(Math.abs(other.x - placed[index].x) >= 142 || Math.abs(other.y - placed[index].y) >= 48).toBe(true);
  }
  expect(anchor).toEqual({ x: 400, y: 300 });
});
