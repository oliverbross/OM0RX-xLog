import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./BandMaps.css", import.meta.url), "utf8");

describe("contest Band Map presentation", () => {
  it("keeps the instrument narrow while allowing it to shrink with its window", () => {
    expect(css).toContain("width: min(100%, 440px); max-width: 440px; min-height: 0;");
    expect(css).toContain("overflow: hidden; background: #07111f;");
    expect(css).toContain("@container band-map-contest (max-width: 340px)");
  });

  it("wraps compact view controls instead of creating a horizontal scrollbar", () => {
    expect(css).toContain(".band-maps-contest .band-maps-quick-controls { flex-wrap: wrap;");
    expect(css).toContain("overflow: visible;");
    expect(css).toContain(".band-maps-contest .band-maps-quick-controls select { min-width: 0; width: 100%; }");
  });
});
