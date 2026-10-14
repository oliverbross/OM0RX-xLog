// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpotHistoryPanel } from "./SpotHistoryPanel";
import { defaultSpotHistoryColumns, readSpotHistoryColumns, spotHistoryColumnsKey } from "./spotHistoryColumnPreferences";

const request = vi.fn(async (method: string) => method === "spot_history_query"
  ? { page: { rows: [], nextCursor: null, watermark: 1, revision: 1 } }
  : method === "spot_history_status" ? { status: null, recording: { state: "unavailable", queued: 0, unrecorded: 0, connections: [] } }
  : { stats: { total: 0, distinctCalls: 0, distinctSpotters: 0, bands: [], modes: [], countries: [], sources: [], spotters: [], hourly: [], watermark: 1 } });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("selects columns, retains callsign, resizes by keyboard and restores presentation on remount", async () => {
  const panel = render(<SpotHistoryPanel request={request} />);
  await screen.findByText("History is unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Country column" }));
  expect(screen.queryByRole("columnheader", { name: "Country" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Show Callsign column" }).hasAttribute("disabled")).toBe(true);
  const resize = screen.getByRole("separator", { name: "Resize Callsign column" });
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(resize.getAttribute("aria-valuenow")).toBe("120");
  expect(JSON.parse(localStorage.getItem(spotHistoryColumnsKey)!).widths.call).toBe(120);
  panel.unmount();
  render(<SpotHistoryPanel request={request} />);
  expect(screen.queryByRole("columnheader", { name: "Country" })).toBeNull();
  expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("120");
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
  expect(screen.getByRole("columnheader", { name: "Country" })).toBeTruthy();
});

it("commits bounded numeric widths and recovers invalid input", () => {
  render(<SpotHistoryPanel request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  const input = screen.getByRole("spinbutton", { name: "Callsign column width" });
  fireEvent.change(input, { target: { value: "9999" } }); fireEvent.blur(input);
  expect((input as HTMLInputElement).value).toBe("480");
  fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
  expect((input as HTMLInputElement).value).toBe("480");
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Callsign column" }), { key: "Home" });
  expect((input as HTMLInputElement).value).toBe("96");
});

it("handles pointer resizing and ends the drag on cancellation", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  render(<SpotHistoryPanel request={request} />);
  const resize = screen.getByRole("separator", { name: "Resize Callsign column" });
  Object.defineProperty(resize, "setPointerCapture", { value: vi.fn() });
  fireEvent.pointerDown(resize, { button: 0, clientX: 100 });
  fireEvent.pointerMove(resize, { clientX: 150 });
  expect(resize.getAttribute("aria-valuenow")).toBe("160");
  fireEvent.pointerCancel(resize); fireEvent.pointerMove(resize, { clientX: 250 });
  expect(resize.getAttribute("aria-valuenow")).toBe("160");
  vi.unstubAllGlobals();
});

it("recovers malformed, oversized, future and unknown preferences", () => {
  for (const raw of ["{", "x".repeat(4097), '{"version":2}', '{"version":1,"columns":["unknown"]}'])
    expect(readSpotHistoryColumns(raw)).toEqual(defaultSpotHistoryColumns());
  expect(readSpotHistoryColumns('{"version":1,"columns":["country","country"],"widths":{"call":1,"country":999}}'))
    .toMatchObject({ columns: ["call", "country"], widths: { call: 96, country: 480 } });
});

it("remains usable if preference storage is denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  render(<SpotHistoryPanel request={request} />);
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Callsign column" }), { key: "End" });
  expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("480");
});
