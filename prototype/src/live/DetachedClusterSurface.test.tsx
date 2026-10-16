// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClusterPanel } from "./ClusterPanel";
import { DetachedClusterSurface } from "./DetachedClusterSurface";
const bridge = vi.hoisted(() => ({ dock: vi.fn(async () => {}), ready: vi.fn(async () => {}), request: vi.fn(async () => ({})), handler: null as null | ((value: any) => void) }));
vi.mock("./DetachedClusterBridge", async original => ({ ...await original<typeof import("./DetachedClusterBridge")>(), dockDetachedWorkspace: bridge.dock,
  announceDetachedClusterReady: bridge.ready, requestViaSession: bridge.request, onClusterProjection: vi.fn(async handler => { bridge.handler = handler; return () => { bridge.handler = null; }; }) }));

afterEach(cleanup);

describe("passive docked DX Cluster presentation", () => {
  it("starts with cluster task controls while waiting for the native session", async () => {
    bridge.dock.mockClear(); bridge.ready.mockClear(); bridge.request.mockClear();
    const { container } = render(<DetachedClusterSurface />);
    await waitFor(() => expect(bridge.ready).toHaveBeenCalledOnce());
    expect(container.querySelector(".station-rail")).toBeNull();
    expect(container.querySelector(".detached-cluster-app > main > .live-cluster")).toBeTruthy();
    expect(screen.queryByText("OM0RX-xLog")).toBeNull();
    expect(screen.queryByText("Live data and actions owned by the main workspace")).toBeNull();
    expect(screen.queryByRole("heading", { name: "DX Cluster" })).toBeNull();
    expect(screen.getByText("Loading the shared cluster session…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Connect$/ })).toBeTruthy();
    expect(bridge.request).not.toHaveBeenCalled();
  });
  it("receives native projections and distinguishes service failure from disconnected clusters", async () => {
    render(<DetachedClusterSurface />);
    await waitFor(() => expect(bridge.handler).not.toBeNull());
    const response = { snapshot: { connectedClusters: 0, loadedSpots: 0, contactCount: 0,
      contactRevision: 0, logbookDataLoaded: true, countryDataLoaded: true, connections: [], spots: [], console: [] } };
    act(() => bridge.handler?.({ revision: 1, response, available: true, selected: null }));
    expect(screen.queryByText(/Loading the shared/)).toBeNull();
    expect(screen.queryByText(/updates paused/)).toBeNull();
    act(() => bridge.handler?.({ revision: 2, response, available: false, selected: null }));
    expect(screen.getByText(/Cluster service updates paused/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Refresh$/ }).hasAttribute("disabled")).toBe(false);
    act(() => bridge.handler?.({ revision: 1, response, available: true, selected: null }));
    expect(screen.getByText(/updates paused/)).toBeTruthy();
    act(() => bridge.handler?.({ revision: 3, response, available: true, selected: null }));
    expect(screen.queryByText(/updates paused/)).toBeNull();
  });
  it("uses main-pushed snapshots without starting its own worker poll, and exposes Undock", () => {
    const onRequest = vi.fn(async () => ({}));
    const onUndock = vi.fn();
    render(<ClusterPanel passive snapshot={{ snapshot: { connectedClusters: 0, loadedSpots: 0, contactCount: 0,
      contactRevision: 0, logbookDataLoaded: true, countryDataLoaded: true, connections: [], spots: [], console: [] } }}
      onRequest={onRequest} onSelect={vi.fn()} onUndock={onUndock} />);
    expect(onRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undock" }));
    expect(onUndock).toHaveBeenCalledOnce();
    expect(onRequest).not.toHaveBeenCalled();
  });
  it("applies a new authoritative filter projection without launching a local poll", () => {
    const onRequest = vi.fn(async () => ({}));
    const filter = { query: "EA", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" };
    const configuration = { servers: [], reconnect: false, requestSkimmer: false, showWorkedBandModeSpots: false, hideWSPRSpots: false,
      maximumSpots: 100, specialRules: [], palette: { status: {}, band: {}, mode: {} }, filter, commandPresets: [], forwardSpotsToFlex: false };
    const snapshot = { connectedClusters: 0, loadedSpots: 0, contactCount: 0, contactRevision: 0,
      logbookDataLoaded: true, countryDataLoaded: true, connections: [], spots: [], console: [] };
    const view = render(<ClusterPanel passive snapshot={{ snapshot, configuration }} onRequest={onRequest} onSelect={vi.fn()} passwordControlsEnabled={false} />);
    expect((screen.getByLabelText("Search spots") as HTMLInputElement).value).toBe("EA");
    view.rerender(<ClusterPanel passive snapshot={{ snapshot, configuration: { ...configuration, filter: { ...filter, query: "OM" } } }}
      onRequest={onRequest} onSelect={vi.fn()} passwordControlsEnabled={false} />);
    expect((screen.getByLabelText("Search spots") as HTMLInputElement).value).toBe("OM");
    expect(onRequest).not.toHaveBeenCalled();
  });
});
