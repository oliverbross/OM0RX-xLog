import { describe, expect, it } from "vitest";
import { validHistoryFixture } from "../src/spotHistoryAcceptance";

describe("packaged retained history evidence", () => {
  const rows = Array.from({ length: 137 }, (_, id) => ({ id: String(id), clusterHost: "fixture.invalid", source: "fixture" }));
  const first = { rows: rows.slice(0, 100), watermark: 137 };
  const second = { rows: rows.slice(100), watermark: 137 };
  const stats = { total: 137, distinctCalls: 2, distinctSpotters: 1 };
  it("requires all rows and full-snapshot counts", () => {
    expect(validHistoryFixture(first, second, stats)).toBe(true);
    expect(validHistoryFixture(first, { ...second, rows: second.rows.slice(1) }, stats)).toBe(false);
    expect(validHistoryFixture(first, second, { ...stats, total: 100 })).toBe(false);
    expect(validHistoryFixture(first, second, { ...stats, distinctCalls: 1 })).toBe(false);
  });
  it("rejects overlapping pages, drifting snapshots and nonfixture sources", () => {
    expect(validHistoryFixture(first, { ...second, rows: [first.rows[0], ...second.rows.slice(1)] }, stats)).toBe(false);
    expect(validHistoryFixture(first, { ...second, watermark: 138 }, stats)).toBe(false);
    expect(validHistoryFixture({ ...first, rows: [{ ...first.rows[0], clusterHost: "live.example" }, ...first.rows.slice(1)] }, second, stats)).toBe(false);
  });
});
