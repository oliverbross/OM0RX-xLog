// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MonitorSurface } from "../src/live/DetachedMonitorSurface";
import { syntheticMonitorContext } from "../src/live/monitorContextFixtures";
import { syntheticMapContext } from "../src/live/mapContextFixtures";
import type { MonitorContext } from "../src/live/monitorContext";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), stops: [] as Array<ReturnType<typeof vi.fn>>,
  wakes: new Map<string, () => void>() }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(), invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", async original => ({ ...await original<typeof import("@tauri-apps/api/event")>(), listen: async (name: string, receive: () => void) => {
  bridge.wakes.set(name, receive); const stop = vi.fn(); bridge.stops.push(stop); return stop;
} }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: bridge.request }));
vi.mock("../src/Map", () => ({ default: (props: any) => <div data-testid="native-context-map">
  {props.data.length} spots · {props.home?.call} · {props.target?.call} · {props.selected} · {props.palette?.status?.Worked}
</div> }));

let context: MonitorContext;
const noTarget = () => ({ refresh: vi.fn(), dispose: vi.fn() });
const noMap = () => ({ refresh: vi.fn(), dispose: vi.fn() });
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const wake = async () => { act(() => bridge.wakes.get("xlog:rotor-telemetry")?.()); await settle(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  bridge.invoke.mockReset(); bridge.request.mockReset(); bridge.wakes.clear(); bridge.stops.length = 0;
  context = syntheticMonitorContext();
  bridge.invoke.mockImplementation(async command => {
    if (command === "monitor_context_snapshot") return context;
    throw new Error(`Unexpected native command: ${command}`);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("stops a pending turn through native current-owner admission and ignores older context revisions and motion replies", async () => {
  let generation = 2, resolveMove!: (value: any) => void;
  const stopGenerations: number[] = [];
  context.rotor.snapshot.generation = generation;
  const original = structuredClone(context);
  const rotor = (revision = generation, azimuth = 90) => ({ owner: "native_dcu1", generation: revision, state: "active",
    backend_available: true, backend: { connected: true, azimuth } });
  bridge.request.mockImplementation(async method => {
    if (method === "rotor_goto") { generation++; return new Promise(resolve => { resolveMove = result => resolve({ result }); }); }
    if (method === "rotor_snapshot") return { result: rotor(generation === 2 ? 2 : 3, 75) };
    throw new Error(`Unexpected worker command: ${method}`);
  });
  bridge.invoke.mockImplementation(async (command, params) => {
    if (command === "monitor_context_snapshot") return context;
    if (command !== "monitor_rotor_stop") throw new Error(`Unexpected native command: ${command}`);
    expect(params).toEqual({ owner: "native_dcu1" });
    // Native substitutes its current generation under the owner lock; the
    // renderer never supplies a stale generation. Rust tests prove admission.
    stopGenerations.push(generation); generation++;
    context = { ...structuredClone(original), revision: generation,
      rotor: { ...original.rotor, revision: generation, snapshot: rotor(generation, 120) } };
    return { ok: true, result: { accepted: true, confirmed: true } };
  });
  const view = render(<MonitorSurface connectMap={noMap} connectTarget={noTarget} renderMap={() => <div>Optional map</div>} />);
  await settle();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monitor rotor bearing" }), { target: { value: "75" } });
  fireEvent.click(screen.getByRole("button", { name: "Turn" })); await settle();
  expect(bridge.request).toHaveBeenCalledWith("rotor_goto", { owner: "native_dcu1", generation: 2, bearing: 75, label: "Monitor bearing" });
  expect(screen.getByRole("button", { name: "Turn" }).hasAttribute("disabled")).toBe(true);

  await wake();
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await settle();
  expect(stopGenerations).toEqual([3]); expect(screen.getByText("120°")).toBeTruthy();
  expect(screen.getByText("Observed confirmation received")).toBeTruthy();
  expect(bridge.request.mock.calls.map(([method]) => method)).toEqual(["rotor_snapshot", "rotor_goto"]);

  await act(async () => resolveMove({ ...rotor(3, 75), accepted: true, confirmed: false })); await settle();
  expect(bridge.request.mock.calls.map(([method]) => method)).toEqual(["rotor_snapshot", "rotor_goto", "rotor_snapshot"]);
  expect(screen.getByText("120°")).toBeTruthy();
  expect(screen.getByText("Observed confirmation received")).toBeTruthy();
  expect(screen.queryByText("Request accepted · watch observed state")).toBeNull();
  context = original; await wake();
  expect(screen.getByText("120°")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await settle();
  expect(stopGenerations).toEqual([3, 4]);
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "monitor_rotor_stop")).toHaveLength(2);
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_stop")).toBe(false);
  view.unmount(); bridge.stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
});

it("reads retained native context without main/device polling and keeps stale Stop independent of optional map metadata", async () => {
  const maps = syntheticMapContext(); maps.cluster.selected = "synthetic-report";
  maps.metadata.home!.call = "OM0RX";
  maps.cluster.response!.configuration.palette = { status: { Worked: "#123456" } };
  const connectMap = (accept: any) => { accept(maps); return { refresh: vi.fn(), dispose: vi.fn() }; };
  const connectTarget = (accept: any) => { accept({ generation: maps.metadata.generation, call: "EA7EU", lat: 37, lon: -6 }); return noTarget(); };
  context.radio.snapshot.station.kpa_operate = false;
  bridge.invoke.mockImplementation(async (command, params) => {
    if (command === "monitor_context_snapshot") return context;
    if (command === "monitor_station_action") {
      expect(params).toEqual({ provider: "direct_agent", expected: 2, selectionId: context.selection!.selection_id, action: "operate" });
      return { ok: true, result: { accepted: true } };
    }
    if (command === "monitor_rotor_stop") { expect(params).toEqual({ owner: "hamlib" }); return { ok: true, result: { accepted: true } }; }
    throw new Error(`Unexpected native command: ${command}`);
  });
  render(<MonitorSurface connectMap={connectMap} connectTarget={connectTarget} />); await settle();
  expect(screen.getByTestId("native-context-map").textContent).toBe("1 spots · OM0RX · EA7EU · synthetic-report · #123456");
  expect(screen.getByText("A: 14.074000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Operate" })); await settle();
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "monitor_station_action")).toHaveLength(1);

  context = { ...context, revision: 2, selection: { provider: "hamlib", generation: 3, selection_id: crypto.randomUUID() },
    radio: { available: false, snapshot: null }, rotor: { ...context.rotor, snapshot: { ...context.rotor.snapshot, owner: "hamlib", generation: 8 } } };
  await wake();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByText("OFFLINE")).toBeTruthy();
  expect(screen.getByText(/Rotor observation unavailable or stale/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Turn" }).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Operate" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await settle();
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "monitor_rotor_stop")).toHaveLength(1);
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "monitor_context_snapshot").length).toBeGreaterThan(2);
  expect(bridge.request).not.toHaveBeenCalled();
  expect(bridge.invoke.mock.calls.every(([method]) => ["monitor_context_snapshot", "monitor_station_action", "monitor_rotor_stop"].includes(method))).toBe(true);
});
