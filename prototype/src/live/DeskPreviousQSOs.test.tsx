// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { compareBandsHighestFirst, DeskPreviousQSOs } from "./DeskPreviousQSOs";

const qsos = [
  { id: "a", call: "VK8NSB", start: "2026-07-25T14:35:00Z", band: "20m", mode: "FT8", country: "Australia", lotwReceived: "Y", qslReceived: "N" },
  { id: "b", call: "VK8NSB", start: "2026-04-11T12:11:00Z", band: "23cm", mode: "SSB", country: "Australia", lotwReceived: "N", qslReceived: "Y" },
  { id: "c", call: "VK8NSB", start: "2026-01-22T12:15:00Z", band: "160m", mode: "CW", country: "Australia", lotwSent: "Y", qslReceived: "N" },
  { id: "other", call: "K1ABC", start: "2026-08-01T00:00:00Z", band: "2m", mode: "FM", country: "United States" },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("orders known amateur bands from highest frequency down to 160m", () => {
  expect(["40m", "23cm", "160m", "2m", "20m"].sort(compareBandsHighestFirst)).toEqual(["23cm", "2m", "20m", "40m", "160m"]);
});

it("shows only the active callsign with the requested default columns and confirmation text", () => {
  render(<DeskPreviousQSOs call="vk8nsb" qsos={qsos} />);
  expect(screen.getByText("Worked before")).toBeTruthy();
  expect(screen.getByText("VK8NSB · 3 QSOs")).toBeTruthy();
  expect(screen.getAllByRole("columnheader").map(header => header.textContent?.replace(/[↕↑↓]/g, "").trim())).toEqual([
    "Date", "Band", "Mode", "Country", "LoTW", "QSL",
  ]);
  expect(screen.queryByText("K1ABC")).toBeNull();
  expect(screen.getAllByLabelText("LoTW: Confirmed")).toHaveLength(1);
  expect(screen.getAllByLabelText("QSL: Confirmed")).toHaveLength(1);
});

it("sorts by Band high-to-low on first click and reverses on the second", () => {
  render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  const band = screen.getByRole("button", { name: /Band/ });
  fireEvent.click(band);
  let rows = screen.getAllByRole("row").slice(1);
  expect(rows.map(row => within(row).getAllByRole("cell")[1].textContent)).toEqual(["23cm", "20m", "160m"]);
  expect(band.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  fireEvent.click(band); rows = screen.getAllByRole("row").slice(1);
  expect(rows.map(row => within(row).getAllByRole("cell")[1].textContent)).toEqual(["160m", "20m", "23cm"]);
  expect(band.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
});

it("persists independent previous-QSO column choices while Band stays available", () => {
  const first = render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  expect((screen.getByLabelText("Band") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Country"));
  fireEvent.click(screen.getByLabelText("Sent"));
  expect(screen.queryByRole("columnheader", { name: /^Country/ })).toBeNull();
  expect(screen.getByRole("columnheader", { name: /^Sent/ })).toBeTruthy();
  first.unmount();
  render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  expect(screen.queryByRole("columnheader", { name: /^Country/ })).toBeNull();
  expect(screen.getByRole("columnheader", { name: /^Sent/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Band/ })).toBeTruthy();
});

it("resizes previous-QSO columns by keyboard and restores their widths", () => {
  const first = render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  const date = screen.getByRole("separator", { name: "Resize Date column" });
  expect(date.getAttribute("aria-valuenow")).toBe("145");
  fireEvent.keyDown(date, { key: "ArrowRight" });
  expect(date.getAttribute("aria-valuenow")).toBe("155");
  first.unmount();
  render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  expect(screen.getByRole("separator", { name: "Resize Date column" }).getAttribute("aria-valuenow")).toBe("155");
});

it("keeps every visible column inside the panel without an internal scroll region", () => {
  const result = render(<DeskPreviousQSOs call="VK8NSB" qsos={qsos} />);
  const table = screen.getByRole("table");
  const widths = [...table.querySelectorAll<HTMLTableColElement>("col")].map(column => Number.parseFloat(column.style.width));
  expect(table.style.minWidth).toBe("");
  expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100);
});

it("renders nothing for a blank, changed or never-worked callsign", () => {
  const view = render(<DeskPreviousQSOs call="" qsos={qsos} />);
  expect(view.container.childElementCount).toBe(0);
  view.rerender(<DeskPreviousQSOs call="N0NEW" qsos={qsos} />);
  expect(view.container.childElementCount).toBe(0);
});
