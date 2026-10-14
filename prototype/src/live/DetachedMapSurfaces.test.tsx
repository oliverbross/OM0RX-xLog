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
    <button onClick={() => props.onPreferencesChange({ ...props.preferences, modes: ["cw"] })}>CW only</button>
    {props.spots.map((spot: any) => <button key={spot.id} onClick={() => props.onSelect(spot)}>Inspect {spot.callsign}</button>)}
  </div> }));
import { syntheticMapContext } from "./mapContextFixtures";
import { DetachedWorldMapSurface } from "./DetachedWorldMapSurface";
import { DetachedBandMapsSurface } from "./DetachedBandMapsSurface";
import { loadWindowSurface } from "../windowSurface";
let current = syntheticMapContext();
const token = { sourceEpoch: "00000000-0000-4000-8000-000000000010", spotVersion: "00000000-0000-4000-8000-000000000011" };
const idle = { phase: "idle", operationId: null, barrier: null };
const mapReads = () => bridge.invoke.mock.calls.filter(([method]) => method === "map_context_snapshot").length;
beforeEach(() => {
  current = syntheticMapContext(); bridge.invoke.mockReset(); bridge.request.mockReset(); bridge.listen.mockReset(); bridge.events.clear();
  localStorage.clear(); window.history.replaceState({}, "", "/");
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
  const Surface = await loadWindowSurface("?view=world-map");
  render(<Surface />);
  await screen.findByRole("button", { name: "Inspect TEST0/P" });
  expect(screen.getByTestId("world-map").textContent).toContain("TESTHOME · 14025000");
  expect(document.querySelector(".station-rail")).toBeNull();
  expect(screen.queryByRole("button", { name: /Refresh|Dock back|Check activation/ })).toBeNull();
  expect(screen.queryByText(/Select a report to load|retained live reports/)).toBeNull();
  expect(screen.getByRole("main").firstElementChild?.classList.contains("live-map")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  expect(screen.getByText(/Selected report: TEST0\/P/)).toBeTruthy();
  await waitFor(() => expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1));
  const sent = bridge.invoke.mock.calls.find(([method]) => method === "activate_spot")![1];
  expect(sent).toEqual({ operationId: expect.any(String), sourceEpoch: token.sourceEpoch, spotId: "synthetic-report", spotVersion: token.spotVersion });
  expect(screen.queryByText(/observed radio tune confirmed/)).toBeNull(); // No permanent global success row.
  expect(bridge.request).not.toHaveBeenCalled();
  expect(bridge.invoke.mock.calls.every(([method]) => ["map_context_snapshot", "spot_activation_snapshot", "activate_spot"].includes(method))).toBe(true);
});

it("direct Band Maps menu route opens one default pinned map without global chrome", async () => {
  render(<DetachedBandMapsSurface />);
  await screen.findByRole("button", { name: "Inspect TEST0/P" });
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^20m/);
  expect(screen.queryByText("Band Maps")).toBeNull();
  expect(screen.queryByRole("button", { name: /Refresh|Dock back|Check activation/ })).toBeNull();
  expect(screen.queryByText(/Select a marker|shared native band maps/)).toBeNull();
  act(() => { current.revision++; bridge.events.get("xlog:map-context")?.(); });
  await waitFor(() => expect(mapReads()).toBe(2));
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^20m/);
  expect(bridge.request).not.toHaveBeenCalled();
});

it("band-specific windows retain independent mode choices and never alter shared layout preferences", async () => {
  window.history.replaceState({}, "", "/?view=band-maps&band=40m");
  const first = render(<DetachedBandMapsSurface />);
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^40m/);
  fireEvent.click(screen.getByRole("button", { name: "CW only" }));
  expect(JSON.parse(localStorage.getItem("xlog.detached.band-map.40m.modes")!)).toEqual(["cw"]);
  first.unmount(); window.history.replaceState({}, "", "/?view=band-maps&band=20m");
  render(<DetachedBandMapsSurface />);
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^20m/);
  expect(localStorage.getItem("xlog.detached.band-map.20m.modes")).toBeNull();
  expect(bridge.request).not.toHaveBeenCalled();
});

it("invalid band query falls back to the safe default", () => {
  window.history.replaceState({}, "", "/?view=band-maps&band=unknown");
  render(<DetachedBandMapsSurface />);
  expect(screen.getByTestId("band-maps").textContent).toMatch(/^20m/);
});

it("Band Maps activate the current report through the same native identity, while stale reports never dispatch", async () => {
  render(<DetachedBandMapsSurface />); await screen.findByRole("button", { name: "Inspect TEST0/P" });
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  await waitFor(() => expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1));
  current.revision++; current.cluster.received_at_ms -= 10000;
  const reads = mapReads();
  act(() => bridge.events.get("xlog:map-context")?.()); await waitFor(() => expect(mapReads()).toBeGreaterThan(reads));
  fireEvent.click(screen.getByRole("button", { name: "Inspect TEST0/P" }));
  expect(screen.getByRole("alert").textContent).toContain("Refresh shared cluster state");
  expect(bridge.invoke.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1); expect(bridge.request).not.toHaveBeenCalled();
});
