// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedClusterSurface } from "./DetachedClusterSurface";
import { loadWindowSurface } from "../windowSurface";
const bridge = vi.hoisted(() => ({ call: vi.fn(), receive: null as null | ((value: any) => void), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: bridge.call }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => vi.fn() }));
vi.mock("./clusterResume", () => ({ initializeNativeClusterResume: async () => {} }));
vi.mock("./DetachedClusterBridge", () => ({
  onClusterProjection: async (callback: (value: any) => void) => { bridge.receive = callback; return bridge.stop; },
  newerClusterProjection: (before: any, next: any) => !before || next.revision > before.revision ? next : before,
  announceDetachedClusterReady: async () => {}, dockDetachedWorkspace: vi.fn(), requestViaSession: vi.fn(),
}));
vi.mock("./ClusterPanel", () => ({ ClusterPanel: ({ snapshot, onSelect }: any) => snapshot?.snapshot.spots.map((spot: any) => <button key={spot.id} onClick={() => onSelect(spot)}>Activate {spot.callsign}</button>) }));
const token = { sourceEpoch: "00000000-0000-4000-8000-000000000002", spotVersion: "00000000-0000-4000-8000-000000000003" };
const report = { id: "one", callsign: "TEST1", frequencyKHz: 14025, mode: "CW", activation: token };
const projection = (revision = 1, received_at_ms = Date.now()) => ({ revision, available: true, received_at_ms, selected: null, response: { snapshot: { spots: [report] } } });
beforeEach(() => {
  bridge.call.mockReset(); bridge.stop.mockReset(); bridge.receive = null;
  bridge.call.mockImplementation(async (command, params) => {
    if (command === "spot_activation_snapshot") return { phase: "idle", operationId: null, barrier: null };
    if (command === "activate_spot") return { operationId: params.operationId, phase: "confirmed", tuneConfirmed: true, rotor: "not_requested" };
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(cleanup);
it("opens the direct-menu cluster without a global activation banner", async () => {
  bridge.call.mockResolvedValue({ phase: "uncertain", operationId: crypto.randomUUID(), tuneConfirmed: false, rotor: "uncertain", barrier: null });
  const Surface = await loadWindowSurface("?view=dx-cluster");
  render(<Surface />); await waitFor(() => expect(bridge.receive).not.toBeNull());
  act(() => bridge.receive?.(projection()));
  expect(screen.getByRole("button", { name: "Activate TEST1" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Check activation/ })).toBeNull();
  expect(screen.queryByText(/Spot activation outcome uncertain/)).toBeNull();
  expect(bridge.call).toHaveBeenCalledWith("spot_activation_snapshot", {});
});
it("activates from a detached cluster without a Desk relay and never freshens stale reports on projection delivery", async () => {
  const view = render(<DetachedClusterSurface />); await waitFor(() => expect(bridge.receive).not.toBeNull());
  act(() => bridge.receive?.(projection())); fireEvent.click(screen.getByRole("button", { name: "Activate TEST1" }));
  await waitFor(() => expect(bridge.call.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1));
  expect(bridge.call.mock.calls.find(([method]) => method === "activate_spot")?.[1]).toEqual({ operationId: expect.any(String), sourceEpoch: token.sourceEpoch, spotId: "one", spotVersion: token.spotVersion });
  act(() => bridge.receive?.(projection(2, Date.now() - 10000))); fireEvent.click(screen.getByRole("button", { name: "Activate TEST1" }));
  expect(screen.getByRole("alert").textContent).toContain("Refresh cluster state"); expect(bridge.call.mock.calls.filter(([method]) => method === "activate_spot")).toHaveLength(1);
  expect(bridge.call.mock.calls.every(([command]) => ["spot_activation_snapshot", "activate_spot"].includes(command))).toBe(true);
  view.unmount(); expect(bridge.stop).toHaveBeenCalledOnce();
});
