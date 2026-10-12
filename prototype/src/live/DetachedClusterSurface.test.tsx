// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClusterPanel } from "./ClusterPanel";
import { DetachedClusterSurface } from "./DetachedClusterSurface";
const bridge = vi.hoisted(() => ({ dock: vi.fn(async () => {}), ready: vi.fn(async () => {}), request: vi.fn(async () => ({})) }));
vi.mock("./DetachedClusterBridge", async original => ({ ...await original<typeof import("./DetachedClusterBridge")>(), dockDetachedWorkspace: bridge.dock,
  announceDetachedClusterReady: bridge.ready, requestViaMain: bridge.request, onClusterProjection: vi.fn(async () => () => {}) }));

afterEach(cleanup);

describe("passive docked DX Cluster presentation", () => {
  it("removes the duplicate detached rail and retains toolbar docking while waiting for main state", async () => {
    bridge.dock.mockClear(); bridge.ready.mockClear(); bridge.request.mockClear();
    const { container } = render(<DetachedClusterSurface />);
    await waitFor(() => expect(bridge.ready).toHaveBeenCalledOnce());
    expect(container.querySelector(".station-rail")).toBeNull();
    expect(screen.queryByText("OM0RX-xLog")).toBeNull();
    expect(screen.queryByText("Live data and actions owned by the main workspace")).toBeNull();
    expect(screen.getAllByRole("heading", { name: "DX Cluster" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Dock back" }).closest(".live-cluster-actions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
    await waitFor(() => expect(bridge.dock).toHaveBeenCalledOnce());
    expect(bridge.request).not.toHaveBeenCalled();
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
    const configuration = { servers: [], reconnect: false, requestSkimmer: false, showWorkedBandModeSpots: false,
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
