import { describe, expect, it } from "vitest";
import { logbookCapacity } from "./logbookCapacity";
describe("available logbook row capacity", () => {
  it("fits actual row and header heights with a rounding guard", () => {
    expect(logbookCapacity(320, 35, 28)).toBe(10);
    expect(logbookCapacity(322, 35, 28)).toBe(10);
    expect(logbookCapacity(680, 35, 28)).toBe(22);
    expect(logbookCapacity(680, 48, 40)).toBe(15);
  });
  it("bounds data requests and retains a non-layout fallback", () => {
    expect(logbookCapacity(30, 35, 28)).toBe(1);
    expect(logbookCapacity(50000, 35, 28)).toBe(100);
    expect(logbookCapacity(0, 0, 0)).toBe(100);
    expect(logbookCapacity(500, 35, NaN)).toBe(100);
  });
  it("fills the same layout at 125%, 150% and 200% UI zoom", () => {
    for (const zoom of [1.25, 1.5, 2]) {
      expect(logbookCapacity(680, 35 * zoom, 28 * zoom, zoom)).toBe(22);
      expect(logbookCapacity(320, 35 * zoom, 28 * zoom, zoom)).toBe(10);
    }
    expect(logbookCapacity(680, 35, 28, 0)).toBe(100);
  });
});
