import { describe, expect, it } from "vitest";
import { maidenheadGrid, maidenheadLocator } from "./MapGrid";

describe("Maidenhead map grid", () => {
  it("uses standard Maidenhead field, square, and subsquare calculations", () => {
    expect(maidenheadLocator(17, 48, 1)).toBe("JN");
    expect(maidenheadLocator(17, 48, 2)).toBe("JN88");
    expect(maidenheadLocator(17, 48, 3)).toBe("JN88MA");
    expect(maidenheadLocator(-181, 0, 1)).toBe(maidenheadLocator(179, 0, 1));
  });

  it("matches Wavelog's zoom-dependent cell sizes and visible-bound snapping", () => {
    const fieldGrid = maidenheadGrid({ west: 10, east: 30, south: 40, north: 50 }, 2);
    expect(fieldGrid.precision).toBe(1);
    expect(fieldGrid.lines[0]).toEqual([[0, 40], [20, 40], [20, 50], [0, 50], [0, 40]]);
    expect(fieldGrid.labels.map(label => label.locator)).toEqual(["JN", "KN"]);

    const squareGrid = maidenheadGrid({ west: 16.1, east: 18.1, south: 47.2, north: 48.2 }, 6);
    expect(squareGrid.precision).toBe(2);
    expect(squareGrid.lines[0]).toEqual([[16, 47], [18, 47], [18, 48], [16, 48], [16, 47]]);
    expect(squareGrid.labels[0].locator).toHaveLength(4);
  });

  it("caps polar drawing at the same 85 degree limit as Wavelog", () => {
    const grid = maidenheadGrid({ west: 0, east: 20, south: 84, north: 90 }, 6);
    expect(Math.max(...grid.lines.flat().map(([, latitude]) => latitude))).toBe(85);
  });
});
