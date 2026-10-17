import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const desk = readFileSync("src/live/OperatorDesk.css", "utf8");
const equipment = readFileSync("src/live/StationEquipment.css", "utf8");
const geometry = readFileSync("tests/visual/desk-responsive-geometry.js", "utf8");
const logbook = readFileSync("src/live/logbook.css", "utf8");
const deskMapLogbook = readFileSync("src/live/DeskMapLogbook.css", "utf8");
const spotHistory = readFileSync("src/live/SpotHistoryPanel.css", "utf8");

it("fits the compact QSO fields on one line before reflowing at the readable minimum", () => {
  expect(desk).not.toContain("(max-width: 1840px)");
  expect(desk).toContain("@container active-qso (max-width: 694px)");
  expect(desk).toContain("minmax(150px, 1.09fr) 106px 78px minmax(94px, 1fr) 58px 68px 44px 44px");
  expect(desk).toContain("minimums total 691px including gaps");
  expect(desk).toContain(".desk-active { container: active-qso / inline-size; overflow-x: hidden; }");
  expect(desk).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
  expect(desk).toContain(".desk-call { grid-column: span 3; }");
  expect(desk).toContain(".desk-date, .desk-frequency { grid-column: span 2; }");
});

it("preserves the established wide, narrow and equipment-free layout rules", () => {
  expect(desk).toContain("minmax(0, 1.8fr) minmax(0, 1.1fr) minmax(0, .85fr)");
  expect(desk).toContain("@container operator-desk (max-width: 1420px)");
  expect(desk).toContain("@container operator-desk (max-width: 561px)");
  expect(equipment).toContain(".operator-desk-top.without-equipment { grid-template-columns: minmax(0, 1.8fr) minmax(0, 1.1fr);");
  expect(equipment).toContain("@container operator-desk (max-width: 1420px)");
});

it("keeps the actual-component geometry matrix around the reported width and fractional layout boundaries", () => {
  for (const value of ["3840", "1730", "1650", "1420.5", "1420", "1419.5", "560.5", "559.5", "360"])
    expect(geometry).toContain(value);
  expect(geometry).toContain("reflow Active QSO fields first");
  expect(geometry).toContain("RST field no longer has a readable minimum width");
});

it("checks that Rotor path controls occupy opposite card corners without crossing the dial", () => {
  expect(geometry).toContain("SP control overlaps the circular dial");
  expect(geometry).toContain("LP control overlaps the circular dial");
  expect(geometry).toContain("SP control left the Rotor card bottom-left corner");
  expect(geometry).toContain("LP control left the Rotor card bottom-right corner");
});

it("reflows standalone data tables into labelled records while allowing the Desk logbook to retain columns", () => {
  expect(logbook).toMatch(/@container logbook-responsive \(max-width:\s*1200px\)/);
  expect(logbook).toMatch(/@container logbook-responsive \(max-width:\s*520px\)/);
  expect(spotHistory).toMatch(/@container \(max-width:\s*1200px\)/);
  expect(spotHistory).toMatch(/@container \(max-width:\s*520px\)/);
  expect(deskMapLogbook).toMatch(/\.desk-map-logbook-logbook \.live-logbook\s*\{\s*container-name:\s*desk-logbook;/);
  for (const css of [logbook, spotHistory]) {
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("content:attr(data-label)");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  }
});
