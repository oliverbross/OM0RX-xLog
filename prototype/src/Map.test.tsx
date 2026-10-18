// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MapSpot } from "./MapSpots";
import { DeskMapLogbook } from "./live/DeskMapLogbook";

const harness = vi.hoisted(() => ({ maps: [] as any[], startReady: true, nativeResize: false,
  initialSize: { width: 1000, height: 500 } }));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    element: HTMLElement;
    canvas = document.createElement("canvas");
    canvasSize = { width: 1000, height: 500 };
    nativeObserver?: ResizeObserver;
    handlers = new Map<string, Function[]>();
    sources = new Map<string, any>();
    ready = harness.startReady;
    styleBusy = false;
    zoom = 2;
    center = { lng: -15, lat: 38 };
    bearing = 0;
    pitch = 0;
    layers: any[];
    layoutCalls: any[][] = [];
    featureStateCalls: any[] = [];
    fitCalls: { bounds: [[number, number], [number, number]]; options: any; viewport: { width: number; height: number } }[] = [];
    options: any;
    easeCalls: any[] = [];
    missingSourceQueries = 0;
    constructor(options: any) {
      this.options = options;
      this.element = options.container;
      this.layers = options.style.layers;
      this.center = { lng: options.center[0], lat: options.center[1] };
      this.zoom = options.zoom;
      this.bearing = options.bearing ?? 0;
      this.pitch = options.pitch ?? 0;
      Object.defineProperties(this.element, {
        clientWidth: { get: () => harness.initialSize.width, configurable: true },
        clientHeight: { get: () => harness.initialSize.height, configurable: true },
      });
      Object.defineProperties(this.canvas, { clientWidth: { get: () => this.canvasSize.width }, clientHeight: { get: () => this.canvasSize.height } });
      if (harness.nativeResize && options.trackResize !== false) {
        // MapLibre 6's built-in observer has no hidden-size guard: resize uses
        // a 400x300 viewport when client dimensions are zero.
        this.nativeObserver = new ResizeObserver(() => this.resize());
        this.nativeObserver.observe(this.element);
      }
      for (const key of Object.keys(options.style.sources)) this.sources.set(key, { setData: vi.fn() });
      harness.maps.push(this);
    }
    on(name: string, layerOrHandler: string | Function, handler?: Function) {
      const key = typeof layerOrHandler === "string" ? `${name}:${layerOrHandler}` : name;
      this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler ?? layerOrHandler as Function]);
      return this;
    }
    once(name: string, handler: Function) {
      const oneTime = (event: any) => { this.off(name, oneTime); handler(event); };
      // Match Evented.off's ability to remove the original once callback.
      (oneTime as any).original = handler;
      return this.on(name, oneTime);
    }
    off(name: string, handler: Function) {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter(value => value !== handler && (value as any).original !== handler));
      return this;
    }
    fire(name: string, event: any) {
      if (name === "load") this.ready = true;
      [...(this.handlers.get(name) ?? [])].forEach(handler => handler(event));
    }
    getContainer() { return this.element; }
    getCanvas() { return this.canvas; }
    getCenter() { return this.center; }
    getZoom() { return this.zoom; }
    getBearing() { return this.bearing; }
    getPitch() { return this.pitch; }
    getBounds() { return { getWest: () => -180, getEast: () => 180, getSouth: () => -85, getNorth: () => 85 }; }
    project() { return { x: 400, y: 200 }; }
    getLayer() { return true; }
    getSource(id: string) { return this.ready ? this.sources.get(id) : undefined; }
    isStyleLoaded() { return this.ready && !this.styleBusy; }
    isSourceLoaded(id: string) {
      if (!this.getSource(id)) {
        this.missingSourceQueries++;
        this.fire("error", { error: { message: `There is no tile manager with ID '${id}'` } });
        return false;
      }
      return true;
    }
    addControl() {}
    fitBounds(bounds: [[number, number], [number, number]], options: any) {
      this.fitCalls.push({ bounds, options, viewport: { width: this.element.clientWidth, height: this.element.clientHeight } });
    }
    jumpTo(options: any) { if (options.center) this.center = { lng: options.center[0], lat: options.center[1] }; if (options.zoom != null) this.zoom = options.zoom; }
    easeTo(options: any) { this.easeCalls.push(options); if (options.center) this.center = { lng: options.center[0], lat: options.center[1] }; }
    resize = vi.fn(() => { this.canvasSize = { width: this.element.clientWidth || 400, height: this.element.clientHeight || 300 }; });
    triggerRepaint = vi.fn();
    setLayoutProperty(...args: any[]) { this.layoutCalls.push(args); }
    setPaintProperty() {}
    setFeatureState(...args: any[]) { this.featureStateCalls.push(args); }
    remove = vi.fn();
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
import WorldMap, { routeBounds, routeFitPadding, routeFrequencyLabel, routeLabelPosition } from "./Map";

const spot = (changes: Partial<MapSpot> = {}): MapSpot => ({
  id: "feed-1", call: "K1ABC", mhz: 14.074, mode: "FT8", band: "20m", country: "United States",
  grid: "", lon: -72, lat: 41, reporter: "OM0RX", note: "<script>not HTML</script>", state: "needed", receivedAt: 1, ...changes,
});
beforeEach(() => {
  localStorage.clear();
  harness.maps.length = 0;
  harness.startReady = true;
  harness.nativeResize = false;
  harness.initialSize = { width: 1000, height: 500 };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function resizeHarness() {
  const observers = new Map<Element, Set<() => void>>(), frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("ResizeObserver", class {
    elements: Element[] = [];
    constructor(private callback: () => void) {}
    observe(element: Element) { this.elements.push(element); const callbacks = observers.get(element) ?? new Set(); callbacks.add(this.callback); observers.set(element, callbacks); }
    disconnect() { this.elements.forEach(element => { const callbacks = observers.get(element); callbacks?.delete(this.callback); if (!callbacks?.size) observers.delete(element); }); }
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  return {
    notify: (element: Element) => act(() => observers.get(element)?.forEach(callback => callback())),
    flush: () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }),
    frames, observers,
  };
}

describe("map container resizing", () => {
  it("refits the returning Desk camera at its settled size and never renders wrapped worlds", () => {
    harness.initialSize = { width: 400, height: 300 };
    const resize = resizeHarness();
    render(<WorldMap data={[spot()]} selected={null}
      home={{ call: "OM0RX", lon: 17, lat: 48 }} target={{ call: "E7POTA", lon: 18, lat: 44 }} />);
    const map = harness.maps[0];
    expect(map.options.renderWorldCopies).toBe(false);
    expect(map.fitCalls.at(-1).viewport).toEqual({ width: 400, height: 300 });

    harness.initialSize = { width: 1440, height: 260 };
    resize.notify(map.element); resize.flush();

    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.fitCalls.at(-1).viewport).toEqual({ width: 1440, height: 260 });
    expect(map.fitCalls.at(-1).bounds).toEqual([[17, 44], [18, 48]]);
  });

  it("keeps both route endpoints clear of variable-height overlays after the Desk settles", () => {
    const resize = resizeHarness();
    render(<WorldMap data={[spot()]} selected="feed-1"
      home={{ call: "OM0RX", lon: 17, lat: 48 }} target={{ call: "SV4RTG", lon: 23, lat: 39 }} />);
    const map = harness.maps[0];
    resize.flush();
    const toolbar = screen.getByLabelText("World map controls");
    const legend = map.element.parentElement!.querySelector(".map-legend") as HTMLElement;
    vi.spyOn(map.element, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 520, height: 420 } as DOMRect);
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({ top: 112, bottom: 224, height: 112 } as DOMRect);
    vi.spyOn(legend, "getBoundingClientRect").mockReturnValue({ top: 396, bottom: 490, height: 94 } as DOMRect);

    harness.initialSize = { width: 1000, height: 420 };
    resize.notify(map.element); resize.flush();

    expect(map.fitCalls).toHaveLength(2);
    expect(map.fitCalls.at(-1).viewport).toEqual({ width: 1000, height: 420 });
    expect(map.fitCalls.at(-1).options.padding).toEqual({ top: 148, right: 54, bottom: 148, left: 54 });

    map.fire("movestart", { originalEvent: new Event("pointerdown") });
    harness.initialSize = { width: 1000, height: 360 };
    resize.notify(map.element); resize.flush();
    expect(map.fitCalls).toHaveLength(2);
  });

  it("resizes once after mount and coalesces observer deliveries using final visible dimensions", () => {
    const resize = resizeHarness();
    render(<WorldMap data={[spot()]} selected="feed-1" />);
    const map = harness.maps[0];
    let width = 1000, height = 500;
    Object.defineProperties(map.element, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    expect(resize.frames.size).toBe(1); resize.flush(); expect(map.resize).toHaveBeenCalledTimes(1);
    map.resize.mockClear(); map.triggerRepaint.mockClear();
    height = 250; resize.notify(map.element); height = 220; resize.notify(map.element); width = 800; resize.notify(map.element);
    expect(map.resize).not.toHaveBeenCalled(); expect(resize.frames.size).toBe(1);
    resize.flush(); expect(map.resize).toHaveBeenCalledTimes(1);
    width = 0; height = 0; resize.notify(map.element); resize.flush(); expect(map.resize).toHaveBeenCalledTimes(1);
    width = 800; height = 220; resize.notify(map.element); resize.flush(); expect(map.resize).toHaveBeenCalledTimes(2);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
    expect(harness.maps).toHaveLength(1);
  });

  it("cancels pending resize work and disconnects the observer when unmounted", () => {
    const resize = resizeHarness();
    const result = render(<WorldMap selected={null} />), map = harness.maps[0];
    Object.defineProperty(map.element, "clientHeight", { value: 250 });
    resize.notify(map.element); expect(resize.frames.size).toBe(1);
    result.unmount(); expect(resize.observers.size).toBe(0); expect(resize.frames.size).toBe(0);
    resize.flush(); expect(map.resize).not.toHaveBeenCalled(); expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps one visible-size owner through hide/reveal and repairs a stale same-size canvas", () => {
    harness.nativeResize = true;
    const resize = resizeHarness();
    render(<WorldMap data={[spot()]} selected={null} />);
    const map = harness.maps[0];
    let width = 1000, height = 500;
    Object.defineProperties(map.element, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    resize.flush(); map.resize.mockClear(); map.triggerRepaint.mockClear();
    const fits = map.fitCalls.length;
    width = 0; height = 0; resize.notify(map.element);
    fireEvent.focus(window); resize.flush();
    expect(map.resize).not.toHaveBeenCalled();
    expect(map.nativeObserver).toBeUndefined();
    width = 1000; height = 500; resize.notify(map.element); resize.flush();
    expect(map.canvasSize).toEqual({ width, height });
    expect(map.resize).toHaveBeenCalledTimes(1);
    // Same CSS size does not prove that the retained render viewport agrees.
    map.canvasSize = { width: 400, height: 300 };
    resize.notify(map.element); resize.flush();
    expect(map.canvasSize).toEqual({ width, height });
    expect(map.resize).toHaveBeenCalledTimes(2);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
    expect(map.fitCalls).toHaveLength(fits);
    expect(harness.maps).toHaveLength(1);
  });

  it("repairs a route-remounted map at its returned dimensions without retaining old observers or losing its view", () => {
    const resize = resizeHarness();
    const route = (show: boolean) => show ? <WorldMap data={[spot()]} selected="feed-1" persistenceKey="desk-test" /> : <div>Logbook route</div>;
    const view = render(route(true)), first = harness.maps[0];
    resize.flush();
    fireEvent.change(screen.getByLabelText("Map overlay"), { target: { value: "Spots" } });
    fireEvent.change(screen.getByLabelText("Map appearance"), { target: { value: "Standard" } });
    first.center = { lng: 42, lat: -19 }; first.zoom = 4.25; first.bearing = 12; first.pitch = 8;
    first.fire("moveend", {});
    view.rerender(route(false));
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(resize.observers.size).toBe(0);

    view.rerender(route(true));
    const returned = harness.maps[1];
    let width = 1440, height = 260;
    Object.defineProperties(returned.element, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    returned.canvasSize = { width: 400, height: 300 };
    expect(resize.frames.size).toBe(1);
    resize.flush();
    expect(returned.resize).toHaveBeenCalledTimes(1);
    expect(returned.canvasSize).toEqual({ width, height });
    expect(returned.triggerRepaint).toHaveBeenCalledTimes(1);
    expect(resize.observers.size).toBe(1);
    expect(returned.options.center).toEqual([42, -19]);
    expect(returned.options.zoom).toBe(4.25);
    expect(returned.options.bearing).toBe(12);
    expect(returned.options.pitch).toBe(8);
    expect(screen.getByLabelText<HTMLSelectElement>("Map overlay").value).toBe("Spots");
    expect(screen.getByLabelText<HTMLSelectElement>("Map appearance").value).toBe("Standard");
    returned.resize.mockClear();
    fireEvent(document, new Event("visibilitychange"));
    expect(returned.resize).toHaveBeenCalledTimes(1);
    view.unmount(); returned.resize.mockClear();
    fireEvent(document, new Event("visibilitychange"));
    expect(returned.resize).not.toHaveBeenCalled();
  });

  it("preserves an unselected camera when a Desk-sized viewport becomes very wide and shallow", () => {
    const resize = resizeHarness();
    render(<WorldMap data={[spot()]} selected={null} />);
    const map = harness.maps[0], fits = map.fitCalls.length, eases = map.easeCalls.length;
    Object.defineProperties(map.element, { clientWidth: { value: 1800 }, clientHeight: { value: 180 } });
    resize.notify(map.element); resize.flush();
    expect(map.canvasSize).toEqual({ width: 1800, height: 180 });
    expect(map.fitCalls).toHaveLength(fits);
    expect(map.easeCalls).toHaveLength(eases);
    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(harness.maps).toHaveLength(1);
  });

  it("resizes the retained Desk map after split drags, keyboard changes and all view transitions", () => {
    localStorage.clear();
    const resize = resizeHarness();
    const result = render(<DeskMapLogbook map={<WorldMap data={[spot()]} selected="feed-1" />} logbook={<div>Logbook</div>} />);
    const map = harness.maps[0], panes = result.container.querySelector<HTMLElement>(".desk-map-logbook-panes")!;
    const mapPane = result.container.querySelector<HTMLElement>(".desk-map-logbook-map")!;
    Object.defineProperty(panes, "getBoundingClientRect", { value: () => ({ height: 610 }) });
    Object.defineProperty(map.element, "clientHeight", { get: () => mapPane.hidden ? 0
      : panes.classList.contains("is-stacked") ? Number.parseFloat(panes.style.gridTemplateRows.split(" ")[Number(mapPane.style.gridRow) - 1]) : 610 });
    Object.defineProperty(map.element, "clientWidth", { get: () => mapPane.hidden ? 0 : 1000 });
    resize.notify(panes); resize.notify(map.element); resize.flush(); map.resize.mockClear();
    const selected = map.element.querySelector('[aria-current="true"]');
    const fits = map.fitCalls.length, eases = map.easeCalls.length;
    fireEvent.change(screen.getByLabelText("Map overlay"), { target: { value: "Spots" } });
    const changeView = (value: string) => {
      fireEvent.change(screen.getByLabelText("Desk map and logbook view"), { target: { value } });
      resize.notify(map.element); resize.flush();
    };
    changeView("logbook-below"); expect(map.resize).toHaveBeenCalledTimes(1);
    const divider = screen.getByRole("separator", { name: "Map and Logbook height" });
    fireEvent.keyDown(divider, { key: "ArrowUp" }); resize.notify(map.element); resize.flush();
    expect(map.resize).toHaveBeenCalledTimes(2);
    const pointer = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId: 7, clientY: y }); fireEvent(divider, event);
    };
    pointer("pointerdown", 300); pointer("pointermove", 330); resize.notify(map.element);
    pointer("pointermove", 360); resize.notify(map.element); pointer("pointerup", 360);
    expect(map.resize).toHaveBeenCalledTimes(2); resize.flush(); expect(map.resize).toHaveBeenCalledTimes(3);
    changeView("logbook-above"); expect(map.resize).toHaveBeenCalledTimes(4); // same dimensions, newly exposed row
    changeView("logbook"); expect(map.resize).toHaveBeenCalledTimes(4);
    changeView("logbook-below"); expect(map.resize).toHaveBeenCalledTimes(5);
    changeView("map"); expect(map.resize).toHaveBeenCalledTimes(6);
    expect(harness.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
    expect(map.element.querySelector('[aria-current="true"]')).toBe(selected);
    expect(screen.getByLabelText<HTMLSelectElement>("Map overlay").value).toBe("Spots");
    expect(map.fitCalls).toHaveLength(fits); expect(map.easeCalls).toHaveLength(eases);
    localStorage.clear();
  });
});

describe("map spot inspection", () => {
  it("fits programme data once per filter and preserves the camera during background refresh", () => {
    const props = { selected: null, home: { call: "OM0RX", lat: 48, lon: 18 }, onSpot: vi.fn() };
    const data = [spot({ lon: 179, lat: -10 }), spot({ id: "two", call: "K2ABC", lon: -179, lat: 12 })];
    const view = render(<WorldMap {...props} data={data} fitToDataKey="iota" />);
    const map = harness.maps[0];
    expect(map.fitCalls.at(-1).bounds).toEqual([[179, -10], [181, 12]]);
    const count = map.fitCalls.length;
    view.rerender(<WorldMap {...props} data={[...data]} fitToDataKey="iota" />);
    expect(map.fitCalls).toHaveLength(count);
    view.rerender(<WorldMap {...props} data={[spot()]} fitToDataKey="pota" />);
    expect(map.fitCalls).toHaveLength(count + 1);
    expect(map.fitCalls.at(-1).bounds).toEqual([[-72, 41], [-72, 41]]);
    expect(props.onSpot).not.toHaveBeenCalled();
  });
  it("waits for map load before fitting programme locations", () => {
    harness.startReady = false;
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<WorldMap data={[spot()]} selected={null} onSpot={vi.fn()} fitToDataKey="iota" />);
    const map = harness.maps[0];
    act(() => map.fire("load", {}));
    expect(map.fitCalls.at(-1).bounds).toEqual([[-72, 41], [-72, 41]]);
    expect(map.fitCalls.at(-1).options.maxZoom).toBe(5);
  });
  it("labels both known route endpoints and the selected path with distance above observed frequency", () => {
    const onSpot = vi.fn();
    const home = { call: "OM0RX", lon: 20, lat: 48 }, target = { call: "K1ABC", lon: -72, lat: 41 };
    const { rerender } = render(<WorldMap data={[spot()]} selected={null} home={home} target={target}
      frequencyHz={14_250_010} onSpot={onSpot} />);
    const map = harness.maps[0];
    expect(screen.getByLabelText("Home station OM0RX").textContent).toBe("OM0RX");
    expect(screen.getByLabelText("Target K1ABC").textContent).toBe("K1ABC");
    const annotation = screen.getByRole("note", { name: /Short path.*14\.250\.010 MHz/ });
    expect(annotation.querySelector(".map-route-distance")?.textContent).toMatch(/^SP · [\d,]+ km$/);
    expect(annotation.querySelector(".map-route-frequency")?.textContent).toBe("14.250.010 MHz");
    expect(annotation.querySelector(".map-route-distance")?.nextElementSibling?.className).toBe("map-route-label-gap");
    fireEvent.click(screen.getByRole("button", { name: "Short path" }));
    expect(screen.getByRole("note", { name: /Long path/ }).querySelector(".map-route-distance")?.textContent).toMatch(/^LP · [\d,]+ km$/);
    rerender(<WorldMap data={[spot()]} selected={null} home={home} target={target} onSpot={onSpot} />);
    expect(screen.getByRole("note", { name: /Long path/ }).querySelector(".map-route-frequency")).toBeNull();
    expect(onSpot).not.toHaveBeenCalled();
    expect(map.fitCalls).toHaveLength(2);
  });

  it("reserves the measured toolbar and legend intrusion when fitting a route", () => {
    expect(routeFitPadding(false, 124.2, 124.1)).toEqual({ top: 149, right: 54, bottom: 149, left: 54 });
    expect(routeFitPadding(false, 20, 20)).toEqual({ top: 74, right: 54, bottom: 100, left: 54 });
    expect(routeFitPadding(true, 200, 200)).toEqual({ top: 28, right: 34, bottom: 34, left: 34 });
  });

  it("omits unknown endpoint callsigns and unobserved frequencies without inventing labels", () => {
    render(<WorldMap data={[]} selected={null} home={{ lon: 20, lat: 48 }} target={{ lon: -72, lat: 41 }}
      frequencyHz={Number.NaN} />);
    expect(screen.queryByLabelText(/^Home station /)).toBeNull();
    expect(screen.queryByLabelText(/^Target /)).toBeNull();
    expect(screen.getByRole("note", { name: /Short path/ }).querySelector(".map-route-frequency")).toBeNull();
    expect(routeFrequencyLabel(undefined)).toBeNull();
    expect(routeFrequencyLabel(14_250_000.5)).toBeNull();
    expect(routeFrequencyLabel(14_250_000)).toBe("14.250.000 MHz");
  });

  it("places a route annotation near its arc midpoint without crossing a date-line seam", () => {
    const sections: [number, number][][] = [
      [[170, 10], [175, 11], [180, 12]],
      [[-180, 12], [-175, 13], [-170, 14], [-165, 15]],
    ];
    const position = routeLabelPosition(sections);
    expect(position).not.toBeNull();
    expect(position!.point[0]).toBeLessThan(0);
    expect(Math.abs(position!.after[0] - position!.before[0])).toBeLessThan(180);
    expect(routeLabelPosition([])).toBeNull();
  });

  it("shows callsign labels at regional zoom level three", () => {
    render(<WorldMap data={[spot()]} selected={null} />);
    const map = harness.maps[0];
    expect(map.element.querySelector(".map-spot-label")).toBeNull();
    map.zoom = 3;
    act(() => { map.fire("moveend", {}); map.fire("zoomend", {}); });
    expect(map.element.querySelector(".map-spot-label")?.textContent).toBe("K1ABC");
  });
  it("fits the complete home-to-target path once and leaves a manually panned camera alone during spot refreshes", () => {
    const home = { call: "OM0RX", lon: 20, lat: 48 };
    const target = { call: "K1ABC", lon: -72, lat: 41 };
    const { rerender } = render(<WorldMap data={[spot()]} selected="feed-1" home={home} target={target} />);
    const map = harness.maps[0];
    expect(map.fitCalls).toHaveLength(1);
    const [[west, south], [east, north]] = map.fitCalls[0].bounds;
    expect(west).toBeLessThanOrEqual(-72);
    expect(east).toBeGreaterThanOrEqual(20);
    expect(south).toBeLessThanOrEqual(41);
    expect(north).toBeGreaterThanOrEqual(48);
    expect(map.easeCalls).toHaveLength(0);
    map.fire("movestart", { originalEvent: new Event("pointerdown") });
    rerender(<WorldMap data={[spot({ id: "feed-2", receivedAt: 2, lon: -71.5 })]} selected="feed-1"
      home={{ ...home }} target={{ ...target }} />);
    expect(map.fitCalls).toHaveLength(1);
    expect(map.easeCalls).toHaveLength(0);
    rerender(<WorldMap data={[spot()]} selected="feed-1" home={home} target={{ ...target, lon: -70 }} />);
    expect(map.fitCalls).toHaveLength(2);
    rerender(<WorldMap data={[spot()]} selected="feed-1" home={{ ...home, lat: 49 }} target={{ ...target, lon: -70 }} />);
    expect(map.fitCalls).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Short path" }));
    expect(map.fitCalls).toHaveLength(4);
    expect(map.fitCalls[3].options.padding.bottom).toBe(100);
    rerender(<WorldMap data={[spot()]} selected="feed-1" home={{ ...home, lat: 49 }} target={{ ...target, call: "W1XYZ", lon: -70 }} />);
    expect(map.fitCalls).toHaveLength(5); // a new call can share the same approximate DXCC point
  });

  it("uses antimeridian-aware bounds and closes both short- and long-path seams", () => {
    const from: [number, number] = [179, 10], to: [number, number] = [-179, 12];
    const short = routeBounds(from, to, false)!;
    const long = routeBounds(from, to, true)!;
    expect(short[1][0] - short[0][0]).toBeLessThan(10);
    expect(short[0][0]).toBeLessThanOrEqual(179);
    expect(short[1][0]).toBeGreaterThanOrEqual(181);
    expect(long[1][0] - long[0][0]).toBeGreaterThan(300);
    const { rerender } = render(<WorldMap data={[]} selected={null} fixture home={{ lon: 179, lat: 10 }} target={{ lon: -179, lat: 12 }} />);
    const map = harness.maps[0];
    const source = map.sources.get("route").setData;
    const coordinates = () => source.mock.lastCall[0].features.flatMap((feature: any) => feature.geometry.coordinates);
    expect(coordinates()).toContainEqual([179, 10]);
    expect(coordinates()).toContainEqual([-179, 12]);
    expect(coordinates().some((point: number[]) => Math.abs(point[0]) === 180)).toBe(true);
    expect(map.fitCalls.at(-1).bounds).toEqual(short);
    fireEvent.click(screen.getByRole("button", { name: "Short path" }));
    expect(map.fitCalls.at(-1).bounds).toEqual(long);
    expect(coordinates()).toContainEqual([179, 10]);
    expect(coordinates()).toContainEqual([-179, 12]);
    rerender(<WorldMap data={[]} selected={null} fixture home={{ lon: 179, lat: 10 }} target={{ lon: -179, lat: 12 }} />);
    expect(map.fitCalls).toHaveLength(3); // fixture fit, initial route, explicit LP fit
  });

  it("shades the night hemisphere below route and spots, follows Greyline, and updates without moving the camera", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T12:00:00Z"));
    try {
      render(<WorldMap data={[spot()]} selected={null} home={{ lon: 20, lat: 48 }} target={{ lon: -72, lat: 41 }} />);
      const map = harness.maps[0];
      const layerIDs = map.layers.map((layer: any) => layer.id);
      expect(layerIDs.indexOf("night-fill")).toBeLessThan(layerIDs.indexOf("grayline-band"));
      expect(layerIDs.indexOf("night-fill")).toBeLessThan(layerIDs.indexOf("route-line"));
      expect(layerIDs.indexOf("night-fill")).toBeLessThan(layerIDs.indexOf("spots"));
      const night = map.sources.get("night").setData;
      expect(night.mock.lastCall[0].features[0].geometry.type).toBe("Polygon");
      const original = night.mock.lastCall[0].features[0].geometry.coordinates;
      const fitted = map.fitCalls.length;
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(night.mock.lastCall[0].features[0].geometry.coordinates).not.toEqual(original);
      expect(map.fitCalls).toHaveLength(fitted);
      fireEvent.click(screen.getByRole("button", { name: "Greyline" }));
      expect(night.mock.lastCall[0].features).toEqual([]);
      expect(map.layoutCalls.at(-3)).toEqual(["night-fill", "visibility", "none"]);
      expect(map.fitCalls).toHaveLength(fitted);
    } finally { vi.useRealTimers(); }
  });

  it("applies DXCC changes while an existing source has transient tile work", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ type: "FeatureCollection", features: [{
      properties: { dxcc_entity_code: 291, dxcc_name: "United States", dxcc_prefix: "K" },
      geometry: { type: "Polygon", coordinates: [[[-73, 40], [-72, 40], [-72, 41], [-73, 40]]] },
    }] }) } as Response);
    const { rerender } = render(<WorldMap data={[]} selected={null} fixture dxccStatuses={{ 291: "worked" }} />);
    const map = harness.maps[0];
    await act(async () => { map.fire("load", {}); });
    map.styleBusy = true;
    rerender(<WorldMap data={[]} selected={null} fixture dxccStatuses={{ 291: "confirmed" }} />);
    expect(map.featureStateCalls.at(-1)).toEqual([{ source: "land", id: 291 }, { status: "confirmed" }]);
    expect(map.missingSourceQueries).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([false, true])("waits for source registration before desk/compact updates (compact=%s)", async compact => {
    harness.startReady = false;
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) } as Response);
    const tune = vi.fn();
    const { rerender } = render(<WorldMap data={[]} selected={null} fixture compact={compact} onSpot={tune} dxccStatuses={{ 291: "worked" }} />);
    const map = harness.maps[0];
    expect(map.missingSourceQueries).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
    const home = { call: "OM0RX", lon: 20, lat: -30 };
    const target = { call: "K1ABC", lon: -72, lat: 41 };
    const latest = spot({ id: "latest", receivedAt: 3 });
    // Station/cluster data can arrive before the initial style and its tile managers.
    rerender(<WorldMap data={[latest]} selected={null} fixture compact={compact} onSpot={tune} home={home} target={target} dxccStatuses={{ 291: "confirmed" }} />);
    expect(map.missingSourceQueries).toBe(0);
    for (const source of map.sources.values()) expect(source.setData).not.toHaveBeenCalled();
    await act(async () => { map.fire("load", {}); });
    expect(map.missingSourceQueries).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(map.sources.get("spots").setData.mock.lastCall[0].features[0].properties.id).toBe("latest");
    const landmarks = map.sources.get("landmarks").setData.mock.lastCall[0].features;
    expect(landmarks.find((value: any) => value.properties.kind === "home").geometry.coordinates).toEqual([20, -30]);
    expect(landmarks.find((value: any) => value.properties.kind === "target").geometry.coordinates).toEqual([-72, 41]);
    expect(tune).not.toHaveBeenCalled();
  });

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

  it("toggles and remembers the Wavelog-compatible Maidenhead grid", () => {
    const first = render(<WorldMap data={[]} selected={null} />);
    const map = harness.maps[0];
    const button = screen.getByRole("button", { name: "Grid" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("xlog.worldMap.maidenheadGrid")).toBe("true");
    expect(map.sources.get("maidenhead-grid").setData.mock.lastCall[0].features.length).toBeGreaterThan(0);
    expect(map.element.querySelectorAll(".map-grid-label").length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(map.sources.get("maidenhead-grid").setData.mock.lastCall[0].features).toEqual([]);
    expect(map.element.querySelector(".map-grid-label")).toBeNull();
    fireEvent.click(button);
    first.unmount();
    render(<WorldMap data={[]} selected={null} />);
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
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
