// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OperatorWorkspace } from "./OperatorWorkspace";
import { BandMaps } from "./BandMaps";
import { type LiveClusterSpot } from "./ClusterPanel";
import { defaultWorkspacePreferences, operatorWorkspaceKey, readWorkspacePreferences, splitBounds } from "./operatorWorkspacePreferences";

let paneWidth = 1100, paneHeight = 290;
let resize: (() => void) | undefined;
const spot = (index = 0): LiveClusterSpot => ({ id: `feed-${index}`, receivedAt: 812000000, clusterName: "ShackCQ", spotter: "OM0RX", frequencyKHz: 14025 + index,
  frequencyText: "14.025", callsign: `VK8NSB${index || ""}`, comment: "Actual received comment", band: "20m", mode: "CW", country: "Australia", adif: 150, continent: "OC", cqZone: 29,
  callStatus: "New Call", dxccStatus: "ATNO", specialTags: ["POTA"], score: 90, scoreReasons: [], aggregateCount: 1, aggregateSpotters: ["OM0RX"], source: "cluster", statusHex: "", bandHex: "", modeHex: "" });
const projection = (count = 12) => ({ snapshot: { connectedClusters: 1, spots: Array.from({ length: count }, (_, index) => spot(index)),
  connections: [{ serverName: "ShackCQ", phase: "connected" }, { serverName: "Backup", phase: "failed", error: "Connection refused" }] }, configuration: { palette: { status: {}, band: { "20m": "#123456" }, mode: {} } } });
beforeEach(() => {
  window.localStorage.clear(); paneWidth = 1100; paneHeight = 290;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains("operator-workspace") ? paneWidth : 450, height: paneHeight, left: 10, top: 0, right: 1110, bottom: paneHeight, x: 10, y: 0, toJSON: () => ({}) };
  });
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resize = undefined; });
function mount(cluster: unknown = projection(), onSelect = vi.fn()) {
  return { ...render(<OperatorWorkspace map={<div>Existing map</div>} bandMaps={<div>Existing band maps</div>} cluster={cluster} onSelect={onSelect} />), onSelect };
}
const clusterTab = () => fireEvent.click(screen.getByRole("tab", { name: "Cluster" }));

describe("operator workspace preferences", () => {
  it("bounds and whitelists stored preferences, never retaining arbitrary payload", () => {
    const result = readWorkspacePreferences(JSON.stringify({ version: 1, mapPercent: 999, activeTab: "cluster", columns: ["callsign", "callsign", "password"], widths: { callsign: 999, mode: -1, time: "100" }, token: "not-persisted", spots: [spot()] }));
    expect(result.mapPercent).toBe(80); expect(result.columns).toEqual(["callsign"]); expect(result.widths.callsign).toBe(480); expect(result.widths.mode).toBe(48);
    expect(JSON.stringify(result)).not.toContain("not-persisted"); expect(JSON.stringify(result)).not.toContain("feed-");
    for (const raw of ["{bad", "[]", JSON.stringify({ version: 2 }), " ".repeat(4097), JSON.stringify({ version: 1, columns: [] })]) expect(readWorkspacePreferences(raw)).toEqual(defaultWorkspacePreferences());
  });
  it("protects usable pane widths at the supported desk sizes", () => {
    const bounds = splitBounds(1100); expect(bounds.min * 1090 / 100).toBeGreaterThanOrEqual(420); expect((100 - bounds.max) * 1090 / 100).toBeGreaterThanOrEqual(280);
    expect(splitBounds(600)).toEqual({ min: 20, max: 80 });
  });
});
describe("operator workspace", () => {
  it("retains map and band-map local state across tab switches, with accessible keyboard tabs", () => {
    const mounted = vi.fn(), unmounted = vi.fn();
    function Persistent() { const [count, setCount] = useState(0); useEffect(() => { mounted(); return unmounted; }, []); return <button onClick={() => setCount(count + 1)}>Pan state {count}</button>; }
    render(<OperatorWorkspace map={<div>Existing map</div>} bandMaps={<Persistent />} cluster={projection()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pan state 0" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Band maps" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Cluster" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Cluster" }), { key: "Home" });
    expect(screen.getByRole("button", { name: "Pan state 1" })).toBeTruthy(); expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
  });
  it("resizes through keyboard and pointer, persists only preferences, and adapts to narrow containers", () => {
    const { container } = mount(); const divider = screen.getByRole("separator", { name: "Map and tools width" });
    fireEvent.keyDown(divider, { key: "ArrowRight" }); expect(divider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.keyDown(divider, { key: "End" }); expect(Number(divider.getAttribute("aria-valuenow"))).toBe(74);
    // jsdom does not provide PointerEvent fields; use an explicit pointer-like event.
    const down = new Event("pointerdown", { bubbles: true }); Object.assign(down, { button: 0, pointerId: 1, clientX: 500 }); fireEvent(divider, down);
    expect(Number(divider.getAttribute("aria-valuenow"))).toBe(45);
    fireEvent.pointerUp(divider);
    const saved = JSON.parse(window.localStorage.getItem(operatorWorkspaceKey)!); expect(saved.mapPercent).toBeCloseTo(490 / 1090 * 100); expect(saved.spots).toBeUndefined();
    paneWidth = 600; act(() => resize?.());
    clusterTab(); expect(container.firstElementChild?.classList.contains("is-stacked")).toBe(true);
  });
  it("selects only real spots by explicit activation, never hover/focus, and keeps palette/status evidence", () => {
    const { onSelect } = mount(); clusterTab();
    const row = screen.getByRole("row", { name: "Select VK8NSB at 14.025000 MHz" });
    const rowMarkup = row.innerHTML;
    fireEvent.mouseEnter(row); expect(row.innerHTML).toBe(rowMarkup); fireEvent.focus(row); expect(onSelect).not.toHaveBeenCalled();
    expect((within(row).getByText("20m") as HTMLElement).style.color).toBe("rgb(18, 52, 86)"); expect((row as HTMLElement).style.backgroundColor).toBe("rgba(255, 140, 0, 0.15)");
    fireEvent.keyDown(row, { key: "Enter" }); expect(onSelect).toHaveBeenCalledExactlyOnceWith(spot());
    const status = screen.getByRole("status", { name: "Compact cluster connections" }); expect(status.textContent).toContain("ShackCQ · Connected"); expect(status.textContent).toContain("Backup · Failed · Connection refused");
  });
  it("paginates available-height rows without table scrolling, and updates live data while hidden", () => {
    const { rerender } = mount(); clusterTab(); expect(screen.getByText("1–7 of 12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next spots page" })); expect(screen.getByText("8–12 of 12")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Band maps" }));
    rerender(<OperatorWorkspace map={<div>Existing map</div>} bandMaps={<div>Existing band maps</div>} cluster={projection(1)} onSelect={vi.fn()} />);
    clusterTab(); expect(screen.getByText("1–1 of 1")).toBeTruthy(); expect(screen.getByRole("button", { name: "Next spots page" }).hasAttribute("disabled")).toBe(true);
  });
  it("uses scoped column settings, numeric/keyboard resize bounds and reset, fitting every selected column", () => {
    const { container } = mount(); clusterTab(); fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Country column" }));
    const numeric = screen.getByRole("spinbutton", { name: "Country preferred width" }); fireEvent.change(numeric, { target: { value: "250" } }); fireEvent.blur(numeric);
    expect(JSON.parse(window.localStorage.getItem(operatorWorkspaceKey)!).widths.country).toBe(250);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const handle = screen.getByRole("separator", { name: "Resize Country column" }); fireEvent.keyDown(handle, { key: "End" }); expect(handle.getAttribute("aria-valuenow")).toBe("480");
    const widths = Array.from(container.querySelectorAll("col")).map(col => parseFloat(col.style.width)); expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);
    fireEvent.click(screen.getByRole("button", { name: "Columns" })); fireEvent.click(screen.getByRole("button", { name: "Reset columns and widths" }));
    expect(JSON.parse(window.localStorage.getItem(operatorWorkspaceKey)!).columns).toEqual(defaultWorkspacePreferences().columns);
  });
  it("keeps at least one visible column and allows restricted local storage", () => {
    window.localStorage.setItem(operatorWorkspaceKey, JSON.stringify({ version: 1, columns: ["callsign"], activeTab: "cluster" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    mount(null); fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("checkbox", { name: "Show Callsign column" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Columns" })); expect(screen.getByText("Awaiting live cluster state.")).toBeTruthy();
  });
  it("drags a column edge while retaining a fitted table and stops resizing on pointer release", () => {
    const { container } = mount(); clusterTab();
    const handle = screen.getByRole("separator", { name: "Resize Callsign column" });
    const pointer = (type: string, clientX: number) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId: 1, clientX }); fireEvent(handle, event); };
    pointer("pointerdown", 150); pointer("pointermove", 180); const changed = Number(handle.getAttribute("aria-valuenow")); expect(changed).toBeGreaterThan(96);
    pointer("pointerup", 180); pointer("pointermove", 220); expect(Number(handle.getAttribute("aria-valuenow"))).toBe(changed);
    expect(Array.from(container.querySelectorAll("col")).reduce((sum, col) => sum + parseFloat(col.style.width), 0)).toBeCloseTo(100);
  });
  it("paginates column controls in a short pane instead of clipping settings or adding a scrollbar", () => {
    paneHeight = 160; mount(); clusterTab(); fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4); expect(screen.queryByRole("checkbox", { name: "Show Comment column" })).toBeNull();
    for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: "Next column settings page" }));
    expect(screen.getByRole("checkbox", { name: "Show Comment column" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Next column settings page" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Reset columns and widths" })).toBeTruthy();
  });
  it("has no request/provider surface and uses bounded no-scroll layout", () => {
    const source = readFileSync("src/live/OperatorWorkspace.tsx", "utf8"), css = readFileSync("src/live/OperatorWorkspace.css", "utf8");
    expect(source).not.toMatch(/workerRequest|setInterval|fetch\(|onRequest|cluster_connect|cluster_snapshot/);
    expect(css).not.toMatch(/overflow[^;]*:\s*(auto|scroll)/); expect(css).toContain("table-layout: fixed"); expect(css).toContain("min-width: 0; min-height: 0; overflow: hidden");
    expect(css).toContain("tbody tr { height: 28px; max-height: 28px");
    expect(css).toContain("tbody tr:hover { box-shadow: inset 0 0 0 1px");
  });
  it("places compact band-map controls in the tabs toolbar without duplicate heading or lost zoom/state", () => {
    const onSelect = vi.fn(), { container } = render(<OperatorWorkspace map={<div>Existing map</div>} cluster={projection()} onSelect={onSelect}
      bandMaps={<BandMaps compact spots={[]} onSelect={onSelect} />} />);
    expect(screen.queryByRole("heading", { name: "Band maps" })).toBeNull();
    const toolbar = container.querySelector(".operator-tool-toolbar")!;
    for (const element of [screen.getByRole("tab", { name: "Band maps" }), screen.getByRole("tab", { name: "Cluster" }), screen.getByLabelText("Follow radio"),
      screen.getByRole("button", { name: "Decrease band map text size" }), screen.getByRole("button", { name: "Increase band map text size" }), screen.getByLabelText("Add band map")]) expect(toolbar.contains(element)).toBe(true);
    expect(container.querySelector(".operator-tool-content .band-maps-head")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Operator tools" }).querySelectorAll("input,select")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" })); const zoomed = screen.getByLabelText(/20m spectrum/).getAttribute("aria-label");
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow radio" })); fireEvent.click(screen.getByRole("button", { name: "Increase band map text size" }));
    clusterTab(); expect(screen.queryByRole("checkbox", { name: "Follow radio" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Band maps" })); expect((screen.getByRole("checkbox", { name: "Follow radio" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/20m spectrum/).getAttribute("aria-label")).toBe(zoomed); expect(within(toolbar as HTMLElement).getByText("110%")).toBeTruthy(); expect(onSelect).not.toHaveBeenCalled();
  });
  it("puts every cluster status and Columns in that same toolbar with explicit connected/disconnected/connecting colors", () => {
    const data = projection(); data.snapshot.connections.push({ serverName: "Connecting DX", phase: "connecting" } as any, { serverName: "Offline DX", phase: "disconnected" } as any);
    const { container } = mount(data); clusterTab();
    const status = screen.getByRole("status", { name: "Compact cluster connections" }), toolbar = container.querySelector(".operator-tool-toolbar")!;
    expect(toolbar.contains(status)).toBe(true); expect(toolbar.contains(screen.getByRole("button", { name: "Columns" }))).toBe(true);
    expect(container.querySelector(".operator-compact-cluster header")).toBeNull(); expect(screen.getAllByText("ShackCQ · Connected")).toHaveLength(1);
    expect(within(status).getByText("ShackCQ · Connected").classList.contains("is-connected")).toBe(true);
    expect(within(status).getByText("Connecting DX · Connecting").classList.contains("is-connecting")).toBe(true);
    expect(within(status).getByText("Offline DX · Disconnected").classList.contains("is-disconnected")).toBe(true);
    expect(status.textContent).toContain("Connection refused");
    const css = readFileSync("src/live/OperatorWorkspace.css", "utf8"); expect(css).toContain(".is-connected { color:#12d6a0; }"); expect(css).toContain(".is-disconnected { color:#ff6b5e; }"); expect(css).toContain(".is-connecting { color:#f3b23c; }");
    expect(css).toContain("grid-template-rows: auto minmax(0, 1fr)");
  });
});
