// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BAND_RANGES, BandMaps, BandMapsToolbarContext, bandForRadio, opportunityCode, placeSpots, panBandRange, bandMapCapacity } from "./BandMaps";
import type { BandMapViewPreferences } from "./BandMaps";

const spot = (id: string, frequencyKHz: number, band = "20m", callStatus = "New Call", dxccStatus = "Worked") => ({
  id, callsign: id, frequencyKHz, band, mode: "CW", callStatus, dxccStatus,
  comment: "live cluster spot", country: "Slovakia", source: "cluster", statusHex: "#FF6B35",
});

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("native band-map parity", () => {
  it("puts optional Undock immediately beside Add band map, preserves Dock back and removes redundant subtitle", () => {
    const undock = vi.fn(), dock = vi.fn(), select = vi.fn();
    render(<BandMaps spots={[]} onSelect={select} onUndock={undock} onDock={dock} />);
    const button = screen.getByRole("button", { name: "Undock" }), dockButton = screen.getByRole("button", { name: "Dock back" });
    expect(button.previousElementSibling?.contains(screen.getByLabelText("Add band map"))).toBe(true); expect(dockButton.previousElementSibling).toBe(button);
    expect(screen.queryByText("Click a spot to load it into the logger and request station tuning.")).toBeNull();
    fireEvent.click(button); fireEvent.click(dockButton); expect(undock).toHaveBeenCalledOnce(); expect(dock).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
  });
  it("uses an explicit compact toolbar slot while keeping standalone/full headers and page controls intact", () => {
    const target = document.createElement("div"); document.body.append(target);
    const preferences: BandMapViewPreferences = { bands: ["20m", "30m", "17m", "15m", "40m"], followRadio: false, layout: "row", fontScale: 1 };
    const { rerender, unmount } = render(<BandMapsToolbarContext.Provider value={target}><BandMaps compact spots={[]} onSelect={vi.fn()} preferences={preferences} /></BandMapsToolbarContext.Provider>);
    expect(screen.queryByRole("heading", { name: "Band maps" })).toBeNull();
    expect(target.contains(screen.getByRole("button", { name: "Next band maps" }))).toBe(true);
    expect(target.contains(screen.getByLabelText("Add band map"))).toBe(true); expect(target.contains(screen.getByRole("checkbox", { name: "Follow radio" }))).toBe(true);
    rerender(<BandMapsToolbarContext.Provider value={target}><BandMaps spots={[]} onSelect={vi.fn()} preferences={preferences} /></BandMapsToolbarContext.Provider>);
    expect(screen.getByRole("heading", { name: "Band maps" })).toBeTruthy(); expect(target.children).toHaveLength(0);
    unmount(); target.remove();
  });
  it("fills the available width and bounds pages to the available height", () => {
    expect(bandMapCapacity(1010, 700, true, 2)).toEqual({ columns: 2, capacity: 2 });
    expect(bandMapCapacity(600, 500, true, 8)).toEqual({ columns: 2, capacity: 2 });
    expect(bandMapCapacity(600, 500, false, 8)).toEqual({ columns: 2, capacity: 4 });
    expect(bandMapCapacity(260, 220, false, 8)).toEqual({ columns: 1, capacity: 1 });
  });

  it("pages excess bands without discarding zoom or tuning a spot", () => {
    const onSelect = vi.fn();
    const preferences: BandMapViewPreferences = { bands: ["20m", "30m", "17m", "15m", "40m"], followRadio: false, layout: "row", fontScale: 1 };
    render(<BandMaps spots={[]} onSelect={onSelect} preferences={preferences} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = screen.getByLabelText(/20m spectrum/).getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "Next band maps" }));
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous band maps" }));
    expect(screen.getByLabelText(/20m spectrum/).getAttribute("aria-label")).toBe(zoomed);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reveals an added band on its page and retains prior zoom", () => {
    localStorage.setItem("xlog.integration.bandMaps.workspace.bands", JSON.stringify(["20m", "30m", "17m", "15m"]));
    localStorage.setItem("xlog.integration.bandMaps.workspace.layout", "row");
    render(<BandMaps spots={[]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = screen.getByLabelText(/20m spectrum/).getAttribute("aria-label");
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous band maps" }));
    expect(screen.getByLabelText(/20m spectrum/).getAttribute("aria-label")).toBe(zoomed);
  });

  it("does not let a second pointer clear drag click suppression", () => {
    class Pointer extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; } }
    vi.stubGlobal("PointerEvent", Pointer);
    const onSelect = vi.fn();
    render(<BandMaps spots={[spot("DRAG2", 14170)]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    chart.setPointerCapture = vi.fn(); chart.hasPointerCapture = () => true; chart.releasePointerCapture = vi.fn();
    const marker = screen.getByRole("button", { name: /DRAG2.*MHz/ });
    fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(chart, { pointerId: 1, clientY: 130 });
    fireEvent.pointerDown(marker, { pointerId: 2, button: 0, clientY: 150 });
    fireEvent.pointerCancel(chart, { pointerId: 2 });
    fireEvent.pointerUp(chart, { pointerId: 1, clientY: 130 });
    fireEvent.click(marker, { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("combines mode choices, persists them, and clears to all without selecting a spot", () => {
    const onSelect = vi.fn();
    const spots = [spot("CW1", 14020), { ...spot("FT1", 14074), mode: "FT8" }, { ...spot("SSB1", 14200), mode: "SSB" }];
    const first = render(<BandMaps spots={spots} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Modes · All"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Data" }));
    expect(screen.getByText("2 of 3 spots")).toBeTruthy();
    expect(screen.getByText("Modes · CW + Phone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /FT1.*MHz/ })).toBeNull();
    first.unmount();
    render(<BandMaps spots={spots} onSelect={onSelect} />);
    expect(screen.getByText("Modes · CW + Phone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 of 3 spots")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("pans a zoomed spectrum with wheel and clamps to its band boundaries", () => {
    const onSelect = vi.fn();
    render(<BandMaps spots={[]} onSelect={onSelect} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    const initial = chart.getAttribute("aria-label");
    fireEvent.wheel(chart, { deltaY: 120 });
    expect(chart.getAttribute("aria-label")).toBe(initial);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = chart.getAttribute("aria-label");
    fireEvent.wheel(chart, { deltaY: 120 });
    expect(chart.getAttribute("aria-label")).not.toBe(zoomed);
    expect(panBandRange({ low: 14100, high: 14200 }, BAND_RANGES["20m"], -1000)).toEqual({ low: 14000, high: 14100 });
    expect(panBandRange({ low: 14100, high: 14200 }, BAND_RANGES["20m"], 1000)).toEqual({ low: 14250, high: 14350 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("drags the zoomed spectrum without accidentally tuning a spot", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const onSelect = vi.fn();
    render(<BandMaps spots={[spot("DRAG1", 14170)]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    chart.setPointerCapture = vi.fn(); chart.hasPointerCapture = () => true; chart.releasePointerCapture = vi.fn();
    const marker = screen.getByRole("button", { name: /DRAG1.*MHz/ });
    const initial = chart.getAttribute("aria-label");
    fireEvent.pointerDown(marker, { button: 0, clientY: 100 });
    fireEvent.pointerMove(chart, { clientY: 140 });
    fireEvent.pointerUp(chart, { clientY: 140 });
    fireEvent.click(marker, { detail: 1 });
    expect(chart.getAttribute("aria-label")).not.toBe(initial);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(marker, { button: 0, clientY: 100 });
    fireEvent.pointerUp(marker, { clientY: 100 });
    fireEvent.click(marker, { detail: 1 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("fits marker placement to resized chart height (compact=%s)", compact => {
    const resizes = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(target: Element) { resizes.set(target, this.callback); }
      disconnect() {}
    });
    render(<BandMaps compact={compact} spots={[spot("OM0RX", 14001)]} onSelect={vi.fn()} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    const resize = () => resizes.get(chart)?.();
    expect(chart.style.height).toBe("");
    Object.defineProperties(chart, { clientHeight: { value: 120, configurable: true }, clientWidth: { value: 310 } });
    act(() => resize());
    const marker = within(chart).getByRole("button", { name: /OM0RX/ });
    expect(parseFloat(marker.style.top)).toBeLessThan(120);
    Object.defineProperty(chart, "clientHeight", { value: 1000, configurable: true });
    act(() => resize());
    expect(parseFloat(marker.style.top)).toBeGreaterThan(900);
    Object.defineProperty(chart, "clientHeight", { value: 220 });
    act(() => resize());
    expect(parseFloat(marker.style.top)).toBeLessThan(220);
    expect(chart.style.height).toBe("");
  });

  it("uses native opportunity precedence and band boundaries", () => {
    expect(opportunityCode(spot("A", 14070, "20m", "New Call", "ATNO"))).toBe("ATNO");
    expect(opportunityCode(spot("B", 14070, "20m", "New Band+Mode"))).toBe("NB+NM");
    expect(opportunityCode(spot("C", 14070, "20m", "New Band"))).toBe("NB");
    expect(opportunityCode(spot("D", 14070, "20m", "New Mode"))).toBe("NM");
    expect(opportunityCode(spot("E", 14070, "20m", "Confirmed", "Worked"))).toBe("C");
    expect(bandForRadio(14_070_000)).toBe("20m");
    expect(bandForRadio(1)).toBeNull();
    expect(BAND_RANGES["30m"].allocations.map((part) => part.name)).toEqual(["CW", "Data"]);
  });

  it("opens multiple real-data bands, preserves choices and protects the final panel", () => {
    const onSelect = vi.fn();
    const first = render(<BandMaps spots={[spot("OM0RX", 14070), spot("OH9W", 7186, "40m")]} onSelect={onSelect} />);
    expect(screen.getByRole("region", { name: "20m band map" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("xlog.integration.bandMaps.workspace.bands") || "[]")).toEqual(["20m", "40m"]);
    fireEvent.click(screen.getByRole("button", { name: "Close 20m band map" }));
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect((screen.getByRole("button", { name: "Close 40m band map" }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();
    render(<BandMaps spots={[]} onSelect={onSelect} />);
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
  });

  it("follows an observed radio band and never tunes on its own", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BandMaps compact spots={[spot("OH9W", 7186, "40m")]} onSelect={onSelect} radioFrequencyHz={14_100_000} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow radio" }));
    rerender(<BandMaps compact spots={[spot("OH9W", 7186, "40m")]} onSelect={onSelect} radioFrequencyHz={7_186_000} />);
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("uses workspace-owned preferences without writing browser storage and accepts restored values", () => {
    const onPreferencesChange = vi.fn();
    const base: BandMapViewPreferences = { bands: ["20m"], followRadio: true, layout: "grid", fontScale: 1 };
    const { rerender } = render(<BandMaps spots={[]} onSelect={vi.fn()} preferences={base} onPreferencesChange={onPreferencesChange} />);
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...base, bands: ["20m", "40m"], followRadio: false });
    expect(localStorage.length).toBe(0);
    const restored: BandMapViewPreferences = { bands: ["17m"], followRadio: false, layout: "row", fontScale: 1.5 };
    rerender(<BandMaps spots={[]} onSelect={vi.fn()} preferences={restored} onPreferencesChange={onPreferencesChange} />);
    expect(screen.getByRole("region", { name: "17m band map" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect(screen.getByRole("button", { name: "Single row" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("150%")).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it("places an optional Dock back action beside Add band map only in a detached view", () => {
    const onDock = vi.fn();
    const { rerender } = render(<BandMaps spots={[]} onSelect={vi.fn()} onDock={onDock} />);
    const add = screen.getByLabelText("Add band map");
    const dock = screen.getByRole("button", { name: "Dock back" });
    expect(add.closest("label")?.nextElementSibling).toBe(dock);
    fireEvent.click(dock);
    expect(onDock).toHaveBeenCalledOnce();
    rerender(<BandMaps spots={[]} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  });

  it("selects the original spot and keeps per-spot frequency in accessible detail only", () => {
    const onSelect = vi.fn();
    const realSpot = spot("OM0RX", 14070);
    render(<BandMaps spots={[realSpot]} onSelect={onSelect} />);
    const panel = screen.getByRole("region", { name: "20m band map" });
    const marker = within(panel).getByRole("button", { name: /OM0RX.*14\.070000 MHz/ });
    expect(marker.textContent).toBe("OM0RXNC");
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith(realSpot);
    expect(within(panel).getByLabelText(/20m spectrum/)).toBeTruthy();
  });

  it("zooms, pans and restores allocation views without losing spots", () => {
    render(<BandMaps spots={[spot("OM0RX", 14070)]} onSelect={vi.fn()} />);
    const panel = screen.getByRole("region", { name: "20m band map" });
    fireEvent.change(within(panel).getByLabelText("20m allocation"), { target: { value: "CW portion" } });
    expect(within(panel).getByText("14.000–14.070 MHz")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Zoom 20m in" }));
    expect(within(panel).queryByText("14.000–14.070 MHz")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Pan 20m up" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Reset 20m range" }));
    expect(within(panel).getByText("14.000–14.350 MHz")).toBeTruthy();
  });

  it("places crowded labels in unique lanes and reports overflow", () => {
    const crowded = Array.from({ length: 30 }, (_, index) => spot(`K${index}`, 14070));
    const result = placeSpots(crowded, { low: 14000, high: 14350 }, 240, 100);
    expect(result.placed.length + result.hidden).toBe(30);
    const positions = result.placed.map(({ top, lane }) => `${lane}:${top}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(result.hidden).toBeGreaterThan(0);
  });
});
