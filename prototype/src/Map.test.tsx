// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MapSpot } from "./MapSpots";

const harness = vi.hoisted(() => ({ maps: [] as any[] }));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    element: HTMLElement;
    handlers = new Map<string, Function[]>();
    sources = new Map<string, any>();
    constructor(options: any) {
      this.element = options.container;
      Object.defineProperties(this.element, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
      for (const key of Object.keys(options.style.sources)) this.sources.set(key, { setData: vi.fn() });
      harness.maps.push(this);
    }
    on(name: string, layerOrHandler: string | Function, handler?: Function) {
      const key = typeof layerOrHandler === "string" ? `${name}:${layerOrHandler}` : name;
      this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler ?? layerOrHandler as Function]);
      return this;
    }
    once() { return this; }
    off() { return this; }
    fire(name: string, event: any) { this.handlers.get(name)?.forEach(handler => handler(event)); }
    getContainer() { return this.element; }
    getCanvas() { return this.element; }
    getZoom() { return 2; }
    project() { return { x: 400, y: 200 }; }
    getLayer() { return true; }
    getSource(id: string) { return this.sources.get(id); }
    isStyleLoaded() { return true; }
    isSourceLoaded() { return true; }
    addControl() {}
    fitBounds() {}
    jumpTo() {}
    easeTo() {}
    resize() {}
    triggerRepaint() {}
    setLayoutProperty() {}
    setPaintProperty() {}
    setFeatureState() {}
    remove() {}
  }
  class Marker {
    element: HTMLElement;
    constructor(options: any) { this.element = options.element; }
    setLngLat() { return this; }
    addTo(map: FakeMap) { map.element.append(this.element); return this; }
    getElement() { return this.element; }
    remove() { this.element.remove(); }
  }
  class Popup {
    element: HTMLElement | null = null;
    setLngLat() { return this; }
    setDOMContent(element: HTMLElement) { this.element?.remove(); this.element = element; return this; }
    addTo(map: FakeMap) { if (this.element) map.element.append(this.element); return this; }
    remove() { this.element?.remove(); return this; }
  }
  return { Map: FakeMap, Marker, Popup, setWorkerUrl: vi.fn(), NavigationControl: class {}, AttributionControl: class {}, ScaleControl: class {} };
});
import WorldMap from "./Map";

const spot = (changes: Partial<MapSpot> = {}): MapSpot => ({
  id: "feed-1", call: "K1ABC", mhz: 14.074, mode: "FT8", band: "20m", country: "United States",
  grid: "", lon: -72, lat: 41, reporter: "OM0RX", note: "<script>not HTML</script>", state: "needed", receivedAt: 1, ...changes,
});
beforeEach(() => {
  harness.maps.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("map spot inspection", () => {
  it("provides hover and keyboard-focus details at world zoom without tuning or fetching", () => {
    const tune = vi.fn();
    render(<WorldMap data={[spot()]} selected={null} fixture onSpot={tune} />);
    const marker = screen.getByRole("button", { name: /K1ABC.*Activate to tune/ });
    fireEvent.mouseEnter(marker);
    expect(screen.getByRole("tooltip").textContent).toContain("Reported by OM0RX");
    expect(screen.getByRole("tooltip").textContent).toContain("<script>not HTML</script>");
    expect(screen.getByRole("tooltip").querySelector("script")).toBeNull();
    fireEvent.mouseLeave(marker);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(marker);
    expect(screen.getByRole("tooltip").textContent).toContain("14.074000 MHz");
    expect(tune).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(marker, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps marker identity on refresh and activates only the newest feed spot", () => {
    const tune = vi.fn();
    const { rerender } = render(<WorldMap data={[spot()]} selected="feed-1" fixture onSpot={tune} />);
    const original = screen.getByRole("button", { name: /K1ABC.*Activate to tune/ });
    const latest = spot({ id: "feed-2", receivedAt: 2, mhz: 7.074, band: "40m" });
    rerender(<WorldMap data={[spot(), latest]} selected="feed-1" fixture onSpot={tune} />);
    const refreshed = screen.getByRole("button", { name: /K1ABC.*7.074000/ });
    expect(refreshed).toBe(original);
    expect(screen.getByText("1 mapped")).toBeTruthy();
    expect(refreshed.getAttribute("aria-current")).toBe("true");
    expect(tune).not.toHaveBeenCalled();
    fireEvent.click(refreshed);
    expect(tune).toHaveBeenCalledExactlyOnceWith(latest);
  });

  it("keeps compact monitor inspection read-only and omits the full toolbar", () => {
    render(<WorldMap data={[spot()]} selected={null} fixture compact />);
    const marker = screen.getByRole("button", { name: /Inspect spot/ });
    expect(screen.queryByLabelText("Map preset")).toBeNull();
    fireEvent.focus(marker);
    expect(screen.getByRole("tooltip").textContent).toContain("K1ABC");
    fireEvent.click(marker);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows bounded source diagnostics and only falls back for identified imagery failures", () => {
    render(<WorldMap data={[]} selected={null} compact />);
    const map = harness.maps[0];
    fireEvent(map.element, new Event("noop"));
    // act through an actual DOM event to flush React's external renderer callback.
    map.element.addEventListener("renderer-error", () => map.fire("error", { sourceId: "route", error: { message: "Invalid GeoJSON" } }));
    fireEvent(map.element, new Event("renderer-error"));
    expect(screen.getByRole("alert").textContent).toContain("Map error (route): Invalid GeoJSON");
    map.element.addEventListener("raster-error", () => map.fire("error", { error: { message: "Failed to fetch", url: "https://gibs.earthdata.nasa.gov/wmts/tile.jpeg" } }));
    fireEvent(map.element, new Event("raster-error"));
    expect(screen.getByRole("status").textContent).toContain("Imagery unavailable");
    expect(screen.getByRole("alert").textContent).toContain("Map error (route): Invalid GeoJSON");
  });
});
