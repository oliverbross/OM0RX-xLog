// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClusterPanel, fullClusterColumnsKey } from "./ClusterPanel";

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });
const palette = ["bands", "modes", "continents", "spotterContinents", "callStatuses", "dxccStatuses", "specials", "sources", "worked", "sort"];
const response = () => ({ snapshot: { connectedClusters: 1, loadedSpots: 0, contactCount: 42, contactRevision: 1, logbookDataLoaded: true, countryDataLoaded: true,
  connections: [{ serverID: "server", serverName: "ShackCQ", phase: "connected", error: null }], spots: [], console: [] },
  configuration: { servers: [{ id: "server", name: "ShackCQ", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX", enabled: true }], connectOnStartup: true, requestRecentSpotsOnConnect: true, reconnect: false, requestSkimmer: false, showWorkedBandModeSpots: false, hideWSPRSpots: false, maximumSpots: 100, specialRules: [{ id: "contest", name: "CONTEST", keywords: ["CQ TEST"], referenceFormat: "none", advancedPattern: "", enabled: true }], palette: { status: {}, band: {}, mode: {} }, filter: { query: "", bands: [], modes: [], continents: [], spotterContinents: [], callStatuses: [], dxccStatuses: [], specials: [], excludedSpecials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" }, commandPresets: [], forwardSpotsToFlex: false } });
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

  it("filters independently by the reporting station continent", () => {
    const data = response();
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({ ...data, configuration: { ...data.configuration, filter: params?.filter } }));
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(within(screen.getByLabelText("Spot filters")).getByRole("button", { name: "Spotter continent" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Spotter continent" })).getByRole("checkbox", { name: "EU" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ continents: [], spotterContinents: ["EU"] }) });
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

  it("supports independent include and exclude choices for Special stations", () => {
    const data = response();
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({ ...data, configuration: { ...data.configuration, filter: params?.filter } }));
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(within(screen.getByLabelText("Spot filters")).getByRole("button", { name: "Special" }));
    const picker = screen.getByRole("group", { name: "Special" });
    expect(within(picker).getByRole("checkbox", { name: "Show only RBN" })).toBeTruthy();
    expect(within(picker).getByRole("checkbox", { name: "Hide RBN" })).toBeTruthy();
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Hide CONTEST" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ specials: [], excludedSpecials: ["CONTEST"] }) });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Show only CONTEST" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ specials: ["CONTEST"], excludedSpecials: [] }) });
  });
});

describe("DX Cluster spot age strip", () => {
  it("keeps the current For label while applying age colour through hover and selection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((812_000_000 + 978_307_200) * 1000));
    const data = response();
    (data.snapshot.spots as any[]).push({ id: "age-spot", receivedAt: 812_000_000 - 15 * 60,
      clusterName: "ShackCQ", spotter: "OM0RX", frequencyKHz: 14025, frequencyText: "14.025", callsign: "VK8NSB", comment: "",
      band: "20m", mode: "CW", country: "Australia", continent: "OC", cqZone: 29, callStatus: "New Call", dxccStatus: "ATNO",
      specialTags: [], score: 90, scoreReasons: [], aggregateCount: 1, aggregateSpotters: ["OM0RX"], source: "cluster", statusHex: "", bandHex: "", modeHex: "" });
    const { rerender } = render(<ClusterPanel passive snapshot={data} onRequest={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /^For/ })).toBeTruthy();
    const age = screen.getByText("15 min");
    expect(age.classList.contains("live-cluster-age-strip")).toBe(true);
    expect((age as HTMLElement).style.backgroundColor).toBe("rgb(133, 77, 14)");
    fireEvent.mouseEnter(age.closest("tr")!);
    expect((age as HTMLElement).style.backgroundColor).toBe("rgb(133, 77, 14)");
    rerender(<ClusterPanel passive snapshot={data} selectedSpotId="age-spot" onRequest={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText("15 min").closest("tr")?.classList.contains("is-selected")).toBe(true);
    expect((screen.getByText("15 min") as HTMLElement).style.backgroundColor).toBe("rgb(133, 77, 14)");
  });

  it("marks skimmer rows as RBN in the visible table", () => {
    const data = response();
    (data.snapshot.spots as any[]).push({ id: "rbn-spot", receivedAt: 812_000_000,
      clusterName: "ShackCQ", spotter: "KM3T5", frequencyKHz: 10116.1, frequencyText: "10.1161", callsign: "OM0RX", comment: "23 dB 28 WPM",
      band: "30m", mode: "CW", country: "Slovak Republic", continent: "EU", cqZone: 15, callStatus: "Worked", dxccStatus: "Confirmed",
      specialTags: ["RBN"], score: 18, scoreReasons: ["RBN source"], aggregateCount: 1, aggregateSpotters: ["KM3T5"], source: "RBL", statusHex: "", bandHex: "", modeHex: "" });
    render(<ClusterPanel passive snapshot={data} onRequest={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getAllByText("RBN")).toHaveLength(1);
    expect(screen.getByText("RBN").closest("td")?.classList.contains("live-cluster-special")).toBe(true);
  });

  it("keeps RBN reception independent from the RBN source visibility filter", async () => {
    const data = response(); data.configuration.filter.sources = ["cluster"];
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => data);
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Request RBN / Skimmer" }));
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_configure", {
      configuration: expect.objectContaining({ requestSkimmer: true, filter: expect.objectContaining({ sources: ["cluster"] }) }),
      base_configuration: data.configuration,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Source · 1" }));
    expect(screen.getByRole("note").textContent).toContain("band and mode filters");
  });
});

describe("cluster toolbar panels", () => {
  it("reuses the complete revision-checked Cluster editor in Settings without the live workspace", async () => {
    const data = response();
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => data);
    render(<ClusterPanel settingsOnly snapshot={null} onRequest={request} onSelect={vi.fn()} />);

    await screen.findByLabelText("ShackCQ host");
    expect(request).toHaveBeenCalledWith("cluster_snapshot", {});
    expect(screen.getByLabelText("DX Cluster settings")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Live cluster spots" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect((screen.getByLabelText("Password · none") as HTMLInputElement).type).toBe("password");

    fireEvent.change(screen.getByLabelText("ShackCQ host"), { target: { value: "settings.example.invalid" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide WSPR spots" }));
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_configure", expect.objectContaining({
      base_configuration: data.configuration,
      configuration: expect.objectContaining({
        hideWSPRSpots: true,
        servers: [expect.objectContaining({ host: "settings.example.invalid" })],
      }),
    })));

    const password = screen.getByLabelText("Password · none") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_password_set", {
      server_id: "server", password: "test-only-password",
    }));
    expect(password.value).toBe("");
    expect(JSON.stringify(request.mock.calls.filter(([method]) => method === "cluster_configure"))).not.toContain("test-only-password");
  });

  it("remembers full-table columns and widths independently without any cluster request", () => {
    const request = vi.fn(async () => ({}));
    const props = { passive: true, snapshot: response(), onRequest: request, onSelect: vi.fn() };
    const initial = render(<ClusterPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Country column" }));
    expect(screen.queryByRole("columnheader", { name: /Country/ })).toBeNull();
    const handle = screen.getByRole("separator", { name: "Resize Callsign column" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("106");
    fireEvent.change(screen.getByRole("spinbutton", { name: "MHz column width" }), { target: { value: "200" } });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "MHz column width" }));
    expect(JSON.parse(localStorage.getItem(fullClusterColumnsKey)!).widths.frequency).toBe(200);
    expect(localStorage.getItem("xlog.integration.operator-workspace.v1")).toBeNull();
    initial.unmount();
    render(<ClusterPanel {...props} />);
    expect(screen.queryByRole("columnheader", { name: /Country/ })).toBeNull();
    expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("106");
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getByRole("columnheader", { name: /Country/ })).toBeTruthy();
  });

  it("keeps one column visible and bounds invalid saved widths", () => {
    localStorage.setItem(fullClusterColumnsKey, JSON.stringify({ version: 1, columns: ["callsign", "bogus"], widths: { callsign: 9000 } }));
    render(<ClusterPanel passive snapshot={response()} onRequest={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
    expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("480");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("checkbox", { name: "Show Callsign column" }).hasAttribute("disabled")).toBe(true);
  });

  it("lets operators finish typing a width before bounding and saving it", () => {
    render(<ClusterPanel passive snapshot={response()} onRequest={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const input = screen.getByRole("spinbutton", { name: "Callsign column width" }) as HTMLInputElement;
    for (const value of ["", "1", "18", "180"]) {
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
      expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("96");
    }
    fireEvent.blur(input);
    expect(input.value).toBe("180");
    expect(JSON.parse(localStorage.getItem(fullClusterColumnsKey)!).widths.callsign).toBe(180);
    fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
    expect(input.value).toBe("180");
    fireEvent.change(input, { target: { value: "9999" } }); fireEvent.blur(input);
    expect(input.value).toBe("480");
  });

  it("disables unsupported secure-storage and forwarding controls without blocking callsign-only Connect", () => {
    const request = vi.fn(async () => ({}));
    const data = { ...response(), password_storage_available: false, flex_forwarding_available: false };
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Password · none").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save password" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Remove password" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Settings → Radio spots/)).toBeTruthy();
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
    expect(screen.getByText("Manage passwords in the main workspace.")).toBeTruthy();
  });
  it("directs radio spot output configuration to Settings", () => {
    const data = response();
    render(<ClusterPanel passive snapshot={data} onRequest={vi.fn(async () => ({}))} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Settings → Radio spots/)).toBeTruthy();
    expect(screen.queryByLabelText(/Forward incoming spots/)).toBeNull();
  });
  it("persists the Hide WSPR spots preference with cluster settings", async () => {
    const data = response();
    const request = vi.fn(async () => data);
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide WSPR spots" }));
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_configure", expect.objectContaining({
      configuration: expect.objectContaining({ hideWSPRSpots: true }),
    })));
  });
  it("persists default-on startup connection and recent-spot controls", async () => {
    const data = response();
    const request = vi.fn(async () => data);
    render(<ClusterPanel passive snapshot={data} onRequest={request} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect((screen.getByRole("checkbox", { name: "Connect automatically when xLog starts" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Request 100 recent DX spots after connecting" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Request 100 recent DX spots after connecting" }));
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_configure", expect.objectContaining({
      configuration: expect.objectContaining({ connectOnStartup: true, requestRecentSpotsOnConnect: false }),
    })));
  });
  it("preserves newer Radio spots settings and untouched palette colors when saving a Cluster draft", async () => {
    const initial = response();
    initial.configuration.palette.status = { Worked: "#111111", Confirmed: "#222222" };
    initial.configuration.palette.band = { "20m": "#333333", "40m": "#444444" };
    initial.configuration.palette.mode = { CW: "#555555", FT8: "#666666" };
    let canonical: any = initial;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "cluster_snapshot") return canonical;
      if (method === "cluster_configure") {
        const draft = params!.configuration as any;
        canonical = { ...canonical, configuration: { ...canonical.configuration,
          servers: draft.servers, hideWSPRSpots: draft.hideWSPRSpots,
          palette: { status: { ...canonical.configuration.palette.status, Worked: draft.palette.status.Worked },
            band: { ...canonical.configuration.palette.band, "20m": draft.palette.band["20m"] },
            mode: { ...canonical.configuration.palette.mode, CW: draft.palette.mode.CW } },
        } };
        return canonical;
      }
      return {};
    });
    const props = { passive: true, onRequest: request, onSelect: vi.fn() };
    const { rerender } = render(<ClusterPanel {...props} snapshot={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("ShackCQ host"), { target: { value: "new-cluster.example.invalid" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide WSPR spots" }));
    fireEvent.change(screen.getByLabelText("Worked"), { target: { value: "#abcdef" } });
    fireEvent.change(screen.getByLabelText("20m"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("CW"), { target: { value: "#654321" } });

    canonical = { ...initial, configuration: {
      ...initial.configuration, forwardSpotsToFlex: true, radioSpotColorPolicy: "dxcc",
      palette: {
        status: { Worked: "#111111", Confirmed: "#fedcba", Unknown: "#999999" },
        band: { "20m": "#333333", "40m": "#aaaaaa" },
        mode: { CW: "#555555", FT8: "#bbbbbb" },
      },
    } } as typeof initial;
    rerender(<ClusterPanel {...props} snapshot={canonical} />);
    expect((screen.getByLabelText("ShackCQ host") as HTMLInputElement).value).toBe("new-cluster.example.invalid");
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_configure", expect.objectContaining({
      base_configuration: initial.configuration,
      configuration: expect.objectContaining({
        hideWSPRSpots: true, forwardSpotsToFlex: false,
        servers: [expect.objectContaining({ host: "new-cluster.example.invalid" })],
        palette: {
          status: { Worked: "#abcdef", Confirmed: "#222222" },
          band: { "20m": "#123456", "40m": "#444444" },
          mode: { CW: "#654321", FT8: "#666666" },
        },
      }),
    })));
    expect(canonical.configuration.forwardSpotsToFlex).toBe(true);
    expect(canonical.configuration.radioSpotColorPolicy).toBe("dxcc");
    expect(canonical.configuration.palette.status.Confirmed).toBe("#fedcba");
  });
  it("stops a Cluster save when another window changed the same status colour", async () => {
    const initial = response();
    initial.configuration.palette.status = { Worked: "#111111" };
    let canonical = initial;
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (method === "cluster_configure") throw new Error("Cluster settings changed in another window. Refresh before saving.");
      return canonical;
    });
    const props = { passive: true, onRequest: request, onSelect: vi.fn() };
    const { rerender } = render(<ClusterPanel {...props} snapshot={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Worked"), { target: { value: "#abcdef" } });
    canonical = { ...initial, configuration: { ...initial.configuration,
      palette: { ...initial.configuration.palette, status: { Worked: "#123456" } } } };
    rerender(<ClusterPanel {...props} snapshot={canonical} />);
    fireEvent.click(screen.getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Cluster settings changed"));
    expect(request.mock.calls.some(([method]) => method === "cluster_configure")).toBe(true);
  });
  it("two Cluster windows retain each other's unrelated settings edits", async () => {
    const initial = response();
    let canonical = initial;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method !== "cluster_configure") return canonical;
      const draft = params!.configuration as typeof initial.configuration;
      const base = params!.base_configuration as typeof initial.configuration;
      canonical = { ...canonical, configuration: { ...canonical.configuration,
        reconnect: draft.reconnect !== base.reconnect ? draft.reconnect : canonical.configuration.reconnect,
        maximumSpots: draft.maximumSpots !== base.maximumSpots ? draft.maximumSpots : canonical.configuration.maximumSpots,
      } };
      return canonical;
    });
    const { container } = render(<><ClusterPanel passive snapshot={initial} onRequest={request} onSelect={vi.fn()} />
      <ClusterPanel passive snapshot={initial} onRequest={request} onSelect={vi.fn()} /></>);
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>(".live-cluster"));
    fireEvent.click(within(first).getByRole("button", { name: "Settings" }));
    fireEvent.click(within(second).getByRole("button", { name: "Settings" }));
    fireEvent.click(within(first).getByRole("checkbox", { name: /Reconnect automatically/ }));
    fireEvent.click(within(first).getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(canonical.configuration.reconnect).toBe(true));
    fireEvent.change(within(second).getByLabelText("Maximum visible spots"), { target: { value: "200" } });
    fireEvent.click(within(second).getByRole("button", { name: "Save cluster settings" }));
    await waitFor(() => expect(canonical.configuration.maximumSpots).toBe(200));
    expect(canonical.configuration.reconnect).toBe(true);
    const writes = request.mock.calls.filter(([method]) => method === "cluster_configure");
    expect((writes[1][1]!.configuration as typeof initial.configuration).reconnect).toBe(false);
    expect(writes[1][1]!.base_configuration).toEqual(initial.configuration);
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
