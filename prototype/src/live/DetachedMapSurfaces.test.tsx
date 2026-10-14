// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), listen: vi.fn(), events: new Map<string, () => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
vi.mock("../worker", () => ({ workerRequest: bridge.request }));
vi.mock("../Map", () => ({ default: (props: any) => <div data-testid="world-map">{props.home?.call} · {props.frequencyHz}
  {props.data.map((spot: any) => <button key={spot.id} onClick={() => props.onSpot(spot)}>Inspect {spot.call}</button>)}
</div> }));
vi.mock("./BandMaps", () => ({ BAND_ORDER: ["20m", "40m"], BAND_MAP_MODES: ["cw", "data", "phone"],
  default: (props: any) => <div data-testid="band-maps">{props.preferences?.bands.join(",")}
    <button onClick={() => props.onPreferencesChange({ ...props.preferences, bands: ["40m"] })}>Use 40m</button>
    {props.spots.map((spot: any) => <button key={spot.id} onClick={() => props.onSelect(spot)}>Inspect {spot.callsign}</button>)}
  </div> }));
import { syntheticMapContext } from "./mapContextFixtures";
import { DetachedWorldMapSurface } from "./DetachedWorldMapSurface";
import { DetachedBandMapsSurface } from "./DetachedBandMapsSurface";
let current = syntheticMapContext();
const token = { sourceEpoch: "00000000-0000-4000-8000-000000000010", spotVersion: "00000000-0000-4000-8000-000000000011" };
const idle = { phase: "idle", operationId: null, barrier: null };
const mapReads = () => bridge.invoke.mock.calls.filter(([method]) => method === "map_context_snapshot").length;
beforeEach(() => {
  current = syntheticMapContext(); bridge.invoke.mockReset(); bridge.request.mockReset(); bridge.listen.mockReset(); bridge.events.clear();
  current.cluster.response!.snapshot.spots[0].activation = token;
  bridge.invoke.mockImplementation(async (method, params) => {
    if (method === "map_context_snapshot") return structuredClone(current);
    if (method === "spot_activation_snapshot") return idle;
    if (method === "activate_spot") return { operationId: params.operationId, phase: "confirmed", tuneConfirmed: true, rotor: "not_requested", reservationActive: false };
    throw new Error(`Unexpected command ${method}`);
  });
  bridge.listen.mockImplementation(async (event, callback) => { bridge.events.set(event, callback); return vi.fn(); });
});
afterEach(cleanup);

it("World Map activates only the current native report identity without renderer draft or radio writes", async () => {
  render(<DetachedWorldMapSurface />);
  await screen.findByRole("button", { name: "Inspect TEST0/P" });
  expect(screen.getByTestId("world-map").textContent).toContain("TESTHOME · 14025000");
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  expect(screen.getByText(/Selected report: TEST0\/P/)).toBeTruthy();
  await waitFor(() => expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1));
  const sent = bridge.invoke.mock.calls.find(([method]) => method === "activate_spot")![1];
  expect(sent).toEqual({ operationId: expect.any(String), sourceEpoch: token.sourceEpoch, spotId: "synthetic-report", spotVersion: token.spotVersion });
  expect(screen.queryByText(/observed radio tune confirmed/)).toBeNull(); // No permanent global success row.
  expect(bridge.request).not.toHaveBeenCalled();
  expect(bridge.invoke.mock.calls.every(([method]) => ["map_context_snapshot", "spot_activation_snapshot", "activate_spot"].includes(method))).toBe(true);
});

it("Band Maps waits for explicit preference acknowledgement and retains the queued optimistic choice", async () => {
  let acknowledge: ((value: unknown) => void) | undefined;
  bridge.request.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  render(<DetachedBandMapsSurface />);
  await screen.findByRole("button", { name: "Use 40m" });
  fireEvent.click(screen.getByRole("button", { name: "Use 40m" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledOnce());
  expect(bridge.request.mock.calls[0]).toEqual(["workspace_band_map_apply", {
    generation: current.metadata.generation, scope: "detached", expected: { bands: ["20m", "40m"] }, patch: { bands: ["40m"] },
  }]);
  act(() => { current.revision++; bridge.events.get("xlog:map-context")?.(); });
  await waitFor(() => expect(mapReads()).toBe(2));
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^40m/);
  current.metadata = { ...current.metadata, revision: 1, preferences: { ...current.metadata.preferences, detachedBandMapBands: ["40m"] } }; current.revision++;
  await act(async () => { acknowledge?.({ result: { ...current.metadata, status: "applied" } }); });
  await waitFor(() => expect(mapReads()).toBe(3));
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^40m/);
});

it("preference conflict stays visible across successful context polls and never retries the operation", async () => {
  bridge.request.mockResolvedValue({ result: { ...current.metadata, status: "conflict" } });
  render(<DetachedBandMapsSurface />); await screen.findByRole("button", { name: "Use 40m" });
  fireEvent.click(screen.getByRole("button", { name: "Use 40m" }));
  await screen.findByRole("alert"); expect(screen.getByRole("alert").textContent).toContain("Another window");
  act(() => { current.revision++; bridge.events.get("xlog:map-context")?.(); });
  await waitFor(() => expect(mapReads()).toBeGreaterThanOrEqual(3));
  expect(screen.getByRole("alert").textContent).toContain("Another window");
  expect(bridge.request).toHaveBeenCalledOnce();
});

it("a failed Dock is single flight and leaves the map open with a persistent retry message", async () => {
  let rejectDock: ((error: Error) => void) | undefined;
  bridge.invoke.mockImplementation(async method => {
    if (method === "map_context_snapshot") return structuredClone(current);
    if (method === "spot_activation_snapshot") return idle;
    if (method === "dock_detached_window") return new Promise((_, reject) => { rejectDock = reject; });
    throw new Error(`Unexpected command ${method}`);
  });
  render(<DetachedWorldMapSurface />); await screen.findByRole("button", { name: "Inspect TEST0/P" });
  fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
  expect((screen.getByRole("button", { name: "Docking…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => rejectDock?.(new Error("fixture recovery failure")));
  expect(screen.getByRole("alert").textContent).toContain("remains open");
  const readsBeforeWake = mapReads();
  act(() => { current.revision++; bridge.events.get("xlog:map-context")?.(); });
  await waitFor(() => expect(mapReads()).toBeGreaterThan(readsBeforeWake));
  expect(screen.getByRole("alert").textContent).toContain("remains open");
  expect(screen.getByTestId("world-map")).toBeTruthy();
});

it("Band Maps activate the current report through the same native identity, while stale reports never dispatch", async () => {
  render(<DetachedBandMapsSurface />); await screen.findByRole("button", { name: "Inspect TEST0/P" });
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  await waitFor(() => expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1));
  current.revision++; current.cluster.received_at_ms -= 10000;
  act(() => bridge.events.get("xlog:map-context")?.()); await waitFor(() => expect(screen.getByText(/retained reports may be stale/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1); expect(bridge.request).not.toHaveBeenCalled();
});
