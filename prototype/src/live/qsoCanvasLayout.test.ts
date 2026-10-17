import { describe, expect, it } from "vitest";
import { defaultQSOCanvasLayout, moveQSOCanvasPanel, qsoCanvasHeight, qsoCanvasWidth, readQSOCanvasLayout, resizeQSOCanvasPanel } from "./qsoCanvasLayout";

describe("QSO canvas geometry", () => {
  it("restores the five movable panels and rejects damaged layouts", () => {
    expect(defaultQSOCanvasLayout().panels).toHaveLength(5);
    expect(readQSOCanvasLayout("damaged")).toEqual(defaultQSOCanvasLayout());
    expect(readQSOCanvasLayout(JSON.stringify({ version: 99, panels: [] }))).toEqual(defaultQSOCanvasLayout());
    expect(readQSOCanvasLayout("x".repeat(8193))).toEqual(defaultQSOCanvasLayout());
  });

  it("clamps movement and every resize to the canvas", () => {
    const panel = defaultQSOCanvasLayout().panels.find(item => item.id === "previous-qsos")!;
    const moved = moveQSOCanvasPanel(panel, 100000, 100000);
    expect(moved.rect.x + moved.rect.width).toBe(qsoCanvasWidth);
    expect(moved.rect.y + moved.rect.height).toBe(qsoCanvasHeight);
    const resized = resizeQSOCanvasPanel(panel, "nw", 100000, 100000);
    expect(resized.rect.width).toBeGreaterThanOrEqual(300);
    expect(resized.rect.height).toBeGreaterThanOrEqual(200);
    expect(moveQSOCanvasPanel(panel, Number.NaN, 1)).toBe(panel);
    expect(resizeQSOCanvasPanel(panel, "se", 1, Number.POSITIVE_INFINITY)).toBe(panel);
  });

  it("keeps defaults for missing panels while retaining valid saved geometry", () => {
    const saved = readQSOCanvasLayout(JSON.stringify({ version: 1, panels: [{ id: "active-contact", rect: { x: 40, y: 48, width: 800, height: 240 }, z: 9 }] }));
    expect(saved.panels.find(item => item.id === "active-contact")).toMatchObject({ rect: { x: 40, y: 48, width: 800, height: 240 }, z: 9 });
    expect(saved.panels.find(item => item.id === "qso-details")).toEqual(defaultQSOCanvasLayout().panels.find(item => item.id === "qso-details"));
  });

  it("clamps finite but unsafe saved geometry and ignores unknown panels", () => {
    const saved = readQSOCanvasLayout(JSON.stringify({ version: 1, panels: [
      { id: "previous-qsos", rect: { x: -900, y: 9000, width: 99999, height: -4 }, z: 99999 },
      { id: "unknown", rect: { x: 1, y: 1, width: 1, height: 1 }, z: 1 },
    ] }));
    expect(saved.panels).toHaveLength(5);
    expect(saved.panels.find(item => item.id === "previous-qsos")).toEqual({ id: "previous-qsos",
      rect: { x: 0, y: 920, width: qsoCanvasWidth, height: 200 }, z: 10000 });
  });
});
