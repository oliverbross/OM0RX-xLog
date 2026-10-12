// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BAND_RANGES, BandMaps, bandForRadio, opportunityCode, placeSpots } from "./BandMaps";
import type { BandMapViewPreferences } from "./BandMaps";

const spot = (id: string, frequencyKHz: number, band = "20m", callStatus = "New Call", dxccStatus = "Worked") => ({
  id, callsign: id, frequencyKHz, band, mode: "CW", callStatus, dxccStatus,
  comment: "live cluster spot", country: "Slovakia", source: "cluster", statusHex: "#FF6B35",
});

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("native band-map parity", () => {
  it.each([true, false])("fits marker placement to resized chart height (compact=%s)", compact => {
    let resize: () => void = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    render(<BandMaps compact={compact} spots={[spot("OM0RX", 14001)]} onSelect={vi.fn()} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
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
