import { describe, expect, it } from "vitest";
import {
  defaultHFPropagationCanvasLayout,
  hfPropagationCanvasHeight,
  hfPropagationCanvasWidth,
  moveHFPropagationPanel,
  readHFPropagationCanvasLayout,
  resizeHFPropagationPanel,
} from "./hfPropagationCanvasLayout";

describe("HF propagation canvas geometry", () => {
  it("restores all dashboard cards and migrates the legacy density", () => {
    expect(defaultHFPropagationCanvasLayout().panels).toHaveLength(9);
    expect(readHFPropagationCanvasLayout("damaged")).toEqual(defaultHFPropagationCanvasLayout());
    expect(readHFPropagationCanvasLayout(null, JSON.stringify({ version: 1, density: "compact", leftPercent: 55 })).density).toBe("compact");
    expect(readHFPropagationCanvasLayout("x".repeat(16_385))).toEqual(defaultHFPropagationCanvasLayout());
  });

  it("clamps movement and resizing to the dashboard canvas", () => {
    const panel = defaultHFPropagationCanvasLayout().panels.find(item => item.id === "noaa-outlook")!;
    const moved = moveHFPropagationPanel(panel, 100_000, 100_000);
    expect(moved.rect.x + moved.rect.width).toBe(hfPropagationCanvasWidth);
    expect(moved.rect.y + moved.rect.height).toBe(hfPropagationCanvasHeight);
    const resized = resizeHFPropagationPanel(panel, "nw", 100_000, 100_000);
    expect(resized.rect.width).toBeGreaterThanOrEqual(360);
    expect(resized.rect.height).toBeGreaterThanOrEqual(260);
    expect(moveHFPropagationPanel(panel, Number.NaN, 1)).toBe(panel);
    expect(resizeHFPropagationPanel(panel, "se", 1, Number.POSITIVE_INFINITY)).toBe(panel);
  });

  it("keeps missing cards at their defaults while retaining valid saved geometry", () => {
    const saved = readHFPropagationCanvasLayout(JSON.stringify({ version: 1, density: "large", panels: [
      { id: "band-continent", rect: { x: 32, y: 48, width: 800, height: 420 }, z: 14 },
    ] }));
    expect(saved.density).toBe("large");
    expect(saved.panels.find(item => item.id === "band-continent")).toMatchObject({ rect: { x: 32, y: 48, width: 800, height: 420 }, z: 14 });
    expect(saved.panels.find(item => item.id === "rbn-pickups")).toEqual(defaultHFPropagationCanvasLayout().panels.find(item => item.id === "rbn-pickups"));
  });

  it("clamps unsafe geometry and ignores unknown cards", () => {
    const saved = readHFPropagationCanvasLayout(JSON.stringify({ version: 1, density: "invalid", panels: [
      { id: "rbn-pickups", rect: { x: -800, y: 9000, width: 99_999, height: -4 }, z: 99_999 },
      { id: "unknown", rect: { x: 1, y: 1, width: 1, height: 1 }, z: 1 },
    ] }));
    expect(saved.panels).toHaveLength(9);
    expect(saved.panels.find(item => item.id === "rbn-pickups")).toEqual({ id: "rbn-pickups",
      rect: { x: 0, y: hfPropagationCanvasHeight - 180, width: hfPropagationCanvasWidth, height: 180 }, z: 10_000 });
  });
});
