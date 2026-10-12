// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClusterPanel } from "./ClusterPanel";

afterEach(cleanup);

describe("passive docked DX Cluster presentation", () => {
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
