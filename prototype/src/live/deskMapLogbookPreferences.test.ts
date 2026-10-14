import { expect, it } from "vitest";
import { boundDeskLogbookPercent, defaultDeskMapLogbookPreferences, deskMapLogbookBounds,
  readDeskMapLogbookPreferences } from "./deskMapLogbookPreferences";

it("defaults to Map and retains only bounded local presentation fields", () => {
  expect(readDeskMapLogbookPreferences(null)).toEqual(defaultDeskMapLogbookPreferences());
  expect(readDeskMapLogbookPreferences(JSON.stringify({ version: 1, view: "logbook-above", logbookPercent: 999,
    token: "never retained", draft: { call: "never retained" } }))).toEqual({ version: 1, view: "logbook-above", logbookPercent: 80 });
  expect(readDeskMapLogbookPreferences(JSON.stringify({ version: 1, view: "logbook-below", logbookPercent: -5 })).logbookPercent).toBe(20);
  for (const raw of ["bad", "null", "[]", "x".repeat(1025), JSON.stringify({ version: 2, view: "logbook" })])
    expect(readDeskMapLogbookPreferences(raw)).toEqual(defaultDeskMapLogbookPreferences());
  expect(readDeskMapLogbookPreferences('{"version":1,"view":"unknown","logbookPercent":"75"}')).toEqual(defaultDeskMapLogbookPreferences());
  expect(boundDeskLogbookPercent(NaN)).toBe(50); expect(boundDeskLogbookPercent(Infinity)).toBe(50);
});

it("bounds every split to usable minimum heights and scrolls rather than crushing short panes", () => {
  for (const height of [0, 1, 180, 409.5, 410, 411, 600, 800, 2160]) {
    const bounds = deskMapLogbookBounds(height);
    expect(bounds.min).toBeLessThanOrEqual(bounds.max);
    expect(bounds.usable * bounds.min / 100).toBeGreaterThanOrEqual(220 - 0.0001);
    expect(bounds.usable * (100 - bounds.max) / 100).toBeGreaterThanOrEqual(180 - 0.0001);
    expect(bounds.scrolling).toBe(height < 410);
  }
  expect(deskMapLogbookBounds(200)).toMatchObject({ min: 55, max: 55, contentHeight: 410 });
  expect(deskMapLogbookBounds(2160)).toMatchObject({ min: 20, max: 80, scrolling: false });
});
