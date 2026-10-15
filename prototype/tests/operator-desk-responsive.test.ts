import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const desk = readFileSync("src/live/OperatorDesk.css", "utf8");
const equipment = readFileSync("src/live/StationEquipment.css", "utf8");
const geometry = readFileSync("tests/visual/desk-responsive-geometry.js", "utf8");
const logbook = readFileSync("src/live/logbook.css", "utf8");
const spotHistory = readFileSync("src/live/SpotHistoryPanel.css", "utf8");

it("reflows compact QSO fields before stacking an otherwise usable three-panel desk", () => {
  expect(desk).not.toContain("(max-width: 1840px)");
  expect(desk).toContain("@container active-qso (max-width: 840px)");
  expect(desk).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
  expect(desk).toContain(".desk-call { grid-column: span 3; }");
  expect(desk).toContain(".desk-date, .desk-frequency { grid-column: span 2; }");
});

it("preserves the established wide, narrow and equipment-free layout rules", () => {
  expect(desk).toContain("minmax(0, 1.8fr) minmax(0, 1.1fr) minmax(0, .85fr)");
  expect(desk).toContain("@container operator-desk (max-width: 1420px)");
  expect(desk).toContain("@container operator-desk (max-width: 560px)");
  expect(equipment).toContain(".operator-desk-top.without-equipment { grid-template-columns: minmax(0, 1.8fr) minmax(0, 1.1fr);");
  expect(equipment).toContain("@container operator-desk (max-width: 1420px)");
});

it("keeps the actual-component geometry matrix around the reported width and fractional layout boundaries", () => {
  for (const value of ["3840", "1730", "1650", "1420.5", "1420", "1419.5", "560.5", "559.5", "360"])
    expect(geometry).toContain(value);
  expect(geometry).toContain("reflow Active QSO fields first");
  expect(geometry).toContain("RST field no longer has a readable minimum width");
});

it("reflows resizable data tables into labelled records before a narrow window needs horizontal scrolling", () => {
  for (const css of [logbook, spotHistory]) {
    expect(css).toMatch(/@container \(max-width:\s*1200px\)/);
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("content:attr(data-label)");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toMatch(/@container \(max-width:\s*520px\)/);
  }
});
