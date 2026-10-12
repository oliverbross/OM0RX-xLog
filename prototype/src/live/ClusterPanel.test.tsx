// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClusterPanel } from "./ClusterPanel";

afterEach(cleanup);
const palette = ["bands", "modes", "continents", "callStatuses", "dxccStatuses", "specials", "sources", "worked", "sort"];
const response = () => ({ snapshot: { connectedClusters: 1, loadedSpots: 0, contactCount: 42, contactRevision: 1, logbookDataLoaded: true, countryDataLoaded: true,
  connections: [{ serverID: "server", serverName: "ShackCQ", phase: "connected", error: null }], spots: [], console: [] },
  configuration: { servers: [{ id: "server", name: "ShackCQ", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX", enabled: true }], reconnect: false, requestSkimmer: false, showWorkedBandModeSpots: false, maximumSpots: 100, specialRules: [], palette: { status: {}, band: {}, mode: {} }, filter: { query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [], specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" }, commandPresets: [], forwardSpotsToFlex: false } });
const luminance = (hex: string) => {
  const values = hex.match(/\w\w/g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};

describe("DX Cluster filter colours", () => {
  it("assigns a stable category colour without changing filter labels or actions", async () => {
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({}));
    render(<ClusterPanel snapshot={null} onRequest={request} onSelect={vi.fn()} />);
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_snapshot", {}));
    const rail = screen.getByLabelText("Spot filters");
    expect(Array.from(rail.querySelectorAll("[data-filter]")).map(node => node.getAttribute("data-filter"))).toEqual(palette);
    const bands = within(rail).getByRole("button", { name: "Bands" });
    fireEvent.click(bands);
    expect(bands.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(screen.getByRole("group", { name: "Bands" })).getByRole("checkbox", { name: "20m" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: ["20m"] }) });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort spots" }), { target: { value: "frequency" } });
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: ["20m"], sort: "frequency" }) });
    fireEvent.click(within(rail).getByRole("button", { name: "Clear filters" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: [], sort: "newest" }) });
    expect(request.mock.calls.some(([method]) => /connect|select|tune/.test(method))).toBe(false);
  });

  it("keeps every category label above AA contrast on its own tinted surface", () => {
    const css = readFileSync("src/live/ClusterPanel.css", "utf8");
    for (const category of palette) {
      const match = css.match(new RegExp(`\\[data-filter="${category}"\\] \\{ --filter-ink: #([0-9a-f]{6}); --filter-surface: #([0-9a-f]{6});`));
      expect(match, category).not.toBeNull();
      const foreground = luminance(match![1]);
      const background = luminance(match![2]);
      expect((foreground + 0.05) / (background + 0.05), category).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("cluster toolbar panels", () => {
  it("disables unsupported secure-storage and forwarding controls without blocking callsign-only Connect", () => {
    const request = vi.fn(async () => ({}));
    const data = { ...response(), password_storage_available: false, flex_forwarding_available: false };
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Password · none").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save password" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Remove password" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText(/Forward incoming spots/).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Callsign-only clusters can still connect/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("learns secure-store capability from the worker response and keeps detached password controls disabled", async () => {
    const request = vi.fn(async () => ({ ...response(), password_storage_available: false }));
    const { rerender } = render(<ClusterPanel snapshot={null} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByText(/Callsign-only clusters can still connect/)).toBeTruthy());
    rerender(<ClusterPanel passive passwordControlsEnabled={false} snapshot={{ ...response(), password_storage_available: true }} onRequest={request} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Password · none").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Dock back to the main workspace to manage passwords.")).toBeTruthy();
  });
  it("lets a transferred unavailable forwarding preference be turned off before saving", () => {
    const data = response(); data.configuration.forwardSpotsToFlex = true;
    render(<ClusterPanel passive snapshot={{ ...data, flex_forwarding_available: false }} onRequest={vi.fn(async () => ({}))} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const checkbox = screen.getByLabelText(/Forward incoming spots/);
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(checkbox.hasAttribute("disabled")).toBe(true);
  });
  it("allows cancellation while a cluster is connecting with no received spots", async () => {
    const data = response(); data.snapshot.connectedClusters = 0; data.snapshot.connections[0].phase = "connecting";
    const request = vi.fn(async () => data);
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    const disconnect = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnect.hasAttribute("disabled")).toBe(false);
    fireEvent.click(disconnect);
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_disconnect", {}));
  });
  it("puts controlled Console/Settings panels before the spot table and preserves their drafts while hidden", () => {
    const onRequest = vi.fn(async () => ({}));
    const { container } = render(<ClusterPanel passive snapshot={response()} onRequest={onRequest} onSelect={vi.fn()} />);
    const consoleButton = screen.getByRole("button", { name: "Console" }), settingsButton = screen.getByRole("button", { name: "Settings" });
    expect(consoleButton.closest(".live-cluster-actions")).toBeTruthy();
    expect(settingsButton.closest(".live-cluster-actions")).toBeTruthy();
    expect(consoleButton.getAttribute("aria-expanded")).toBe("false");
    const consolePanel = document.getElementById(consoleButton.getAttribute("aria-controls")!)!;
    const settingsPanel = document.getElementById(settingsButton.getAttribute("aria-controls")!)!;
    expect(consolePanel.hidden).toBe(true); expect(settingsPanel.hidden).toBe(true);
    const table = container.querySelector(".live-cluster-table")!;
    expect(consolePanel.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settingsPanel.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(consoleButton);
    fireEvent.change(screen.getByLabelText("Cluster command"), { target: { value: "show/dx 15" } });
    fireEvent.click(consoleButton); fireEvent.click(consoleButton);
    expect((screen.getByLabelText("Cluster command") as HTMLInputElement).value).toBe("show/dx 15");
    fireEvent.click(settingsButton);
    fireEvent.change(screen.getByLabelText("ShackCQ host"), { target: { value: "unsaved.example.invalid" } });
    const password = settingsPanel.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.change(password, { target: { value: "typed-test-only" } });
    fireEvent.click(settingsButton); fireEvent.click(settingsButton);
    expect((screen.getByLabelText("ShackCQ host") as HTMLInputElement).value).toBe("unsaved.example.invalid");
    expect(password.value).toBe("typed-test-only");
    fireEvent.click(screen.getByRole("button", { name: "Bands" }));
    expect(screen.getByRole("group", { name: "Bands" }).closest(".live-cluster-filter-container")).toBeTruthy();
    expect(onRequest).not.toHaveBeenCalled();
  });
  it("shows named connection status once in the toolbar, preserving all failed/disconnected names and errors", () => {
    const data = response();
    data.snapshot.connections.push({ serverID: "failed", serverName: "Backup DX", phase: "failed", error: "Connection refused" as any }, { serverID: "idle", serverName: "Other node", phase: "disconnected", error: null });
    const { container } = render(<ClusterPanel passive snapshot={data} onRequest={vi.fn(async () => ({}))} onSelect={vi.fn()} />);
    const status = screen.getByRole("status", { name: "Cluster connections" });
    expect(status.closest(".live-cluster-actions")).toBeTruthy();
    expect(status.textContent).toContain("ShackCQ · Connected");
    expect(status.textContent).toContain("Backup DX · Failed");
    expect(status.textContent).toContain("Connection refused");
    expect(status.textContent).toContain("Other node · Disconnected");
    expect(container.querySelector(".live-cluster-connections")).toBeNull();
    expect(screen.getAllByText("ShackCQ · Connected")).toHaveLength(1);
  });
  it("places Dock back last in the same toolbar and dispatches its callback once", () => {
    const dock = vi.fn(), onRequest = vi.fn(async () => ({}));
    render(<ClusterPanel passive snapshot={response()} onRequest={onRequest} onSelect={vi.fn()} onDock={dock} />);
    const toolbar = screen.getByRole("button", { name: "Refresh" }).closest(".live-cluster-actions")!;
    expect(Array.from(toolbar.querySelectorAll("button")).map(button => button.textContent)).toEqual(["Connect", "Disconnect", "Refresh", "Console", "Settings", "Dock back"]);
    fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
    expect(dock).toHaveBeenCalledOnce(); expect(onRequest).not.toHaveBeenCalled();
  });
});
