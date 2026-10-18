// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpportunitiesPanel, opportunityDXCCNeed } from "./OpportunitiesPanel";

const pota = { id: "pota:OM0RX:OM-0001", kind: "pota", callsign: "OM0RX/P", reference: "OM-0001", name: "Verified park",
  frequency_hz: 14_074_000, mode: "FT8", observed_at: "2026-10-12T10:00:00Z", expires_at: "2026-10-12T10:30:00Z",
  source: "POTA official spots", source_url: "https://api.pota.app/spot/activator", comment: "", reference_status: "verified",
  worked_count: 3, confirmed_count: 1, dxcc_history: { adif: 291, entity: "United States", worked_modes: ["FT8"], confirmed_modes: ["SSB", "CW"] },
  band_modes: [{ band: "20m", mode: "FT8", worked_count: 3, confirmed_count: 1 }] };
const expedition = { ...pota, id: "425dxn:DX1", kind: "dxpedition", callsign: "DX1ABC", reference: "", name: "DX1ABC: DXpedition",
  frequency_hz: null, mode: "", source: "425DXN Worldwide DX Calendar", source_url: "https://www.425dxn.org/index.php?op=wcal",
  reference_status: "not_applicable", dxcc_history: { adif: 999, entity: "New Entity", worked_modes: [], confirmed_modes: [] }, worked_count: 0, confirmed_count: 0, band_modes: [] };
const snapshot = { generated_at: "2026-10-12T10:01:00Z", items: [pota, expedition], total_available: 2, history_state: "ready",
  sources: [{ source: "pota", state: "stale", count: 1, source_url: pota.source_url, last_success: "2026-10-11T10:00:00Z", last_attempt: null, safe_error: "SOURCE_UNAVAILABLE_OR_INVALID" }], selection_tunes: false, transmit: false };
vi.mock("../Map", () => ({ default: (props: { data: { id: string }[]; onSpot: (spot: { id: string }) => void; spotActionLabel: string }) =>
  <button onClick={() => props.onSpot(props.data[0])}>{props.spotActionLabel}</button> }));
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

describe("read-only opportunities", () => {
  it("withholds DXCC claims when a callsign cannot be resolved", () => {
    expect(opportunityDXCCNeed({ ...pota, dxcc_history: null })).toEqual({
      text: "DXCC history unavailable", state: "unknown", title: "This callsign could not be resolved to a DXCC entity.",
    });
  });
  it("retires pending responses when a logbook revision replaces the request owner", async () => {
    let finishOld!: (value: unknown) => void;
    const oldRequest = vi.fn(() => new Promise(resolve => { finishOld = resolve; }));
    const view = render(<OpportunitiesPanel request={oldRequest} />);
    const freshRequest = vi.fn(async () => ({ ...snapshot, generated_at: "2026-10-12T10:02:00Z", items: [expedition] }));
    view.rerender(<OpportunitiesPanel request={freshRequest} refresh={1} />);
    await screen.findByText("DX1ABC");
    await act(async () => { finishOld({ ...snapshot, generated_at: "2026-10-12T10:03:00Z" }); });
    expect(screen.queryByText("Verified park")).toBeNull();
    expect(oldRequest).toHaveBeenCalledTimes(1);
    expect(freshRequest).toHaveBeenCalledTimes(3);
  });
  it("puts DXpeditions second and includes island operations in IOTA without duplicating All", async () => {
    const island = { ...expedition, reference: "EU-001", reference_kind: "iota", programmes: ["dxpedition", "iota"],
      activity: "scheduled", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-20T23:59:59Z",
      latitude: 38, longitude: 25, location_accuracy: "reference_area", location_source: "IOTA group centre" };
    const request = vi.fn(async () => ({ ...snapshot, items: [pota, island] })), select = vi.fn();
    render(<OpportunitiesPanel request={request} onSelect={select} />);
    await screen.findByText("DX1ABC");
    expect(screen.getAllByRole("tab").slice(0, 2).map(tab => tab.textContent)).toEqual(["All", "DXpeditions"]);
    expect(screen.getAllByText("DX1ABC")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "IOTA" }));
    expect(screen.getByText("IOTA · EU-001")).toBeTruthy();
    expect(screen.getByText("Approximate IOTA group area")).toBeTruthy();
    expect(screen.getByText("Not a live frequency report")).toBeTruthy();
    expect(screen.queryByText("Verified park")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show map" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load QSO draft only" }));
    expect(select).toHaveBeenCalledWith(island);
    expect(screen.getByText(/1 located · 0 without published coordinates/)).toBeTruthy();
  });
  it("names each programme beside its reference and keeps WWFF out of the POTA filter", async () => {
    const wwff = { ...pota, id: "cluster:wwff", kind: "wwff", callsign: "K5G", reference: "KFF-3017", name: "Guadalupe River" };
    const request = vi.fn(async () => ({ ...snapshot, items: [pota, wwff] }));
    const select = vi.fn();
    render(<OpportunitiesPanel request={request} onSelect={select} />);
    expect(await screen.findByText("WWFF · KFF-3017")).toBeTruthy();
    expect(screen.getByText("POTA · OM-0001")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "POTA" }));
    expect(screen.queryByText("WWFF · KFF-3017")).toBeNull();
    expect(screen.getByText("POTA · OM-0001")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(3);
    expect(select).not.toHaveBeenCalled();
  });
  it("shows source age, full reference history and only loads a draft on selection", async () => {
    const request = vi.fn(async (_method: string) => snapshot), select = vi.fn();
    render(<OpportunitiesPanel request={request} onSelect={select} />);
    expect(await screen.findByText("Verified park")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
    expect(screen.getByText(/Retrying automatically/)).toBeTruthy();
    expect(screen.getByText("3 worked")).toBeTruthy();
    expect(screen.getByText("Confirmed on SSB, CW · Worked on FT8").classList.contains("is-worked")).toBe(true);
    expect(screen.getByText("All Time New One · Wanted").classList.contains("is-wanted")).toBe(true);
    expect(screen.getByTitle("20m FT8: 3 worked, 1 confirmed")).toBeTruthy();
    expect(screen.getByText("No reference history")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load OM0RX/P into QSO draft" }));
    expect(select).toHaveBeenCalledWith(pota);
    expect(request).toHaveBeenCalledWith("opportunities_snapshot");
    expect(request.mock.calls.some(([method]) => /tune|station_/.test(method))).toBe(false);
  });
  it("automatically refreshes every feed and retains a last-good view on failure", async () => {
    const request = vi.fn(async (method: string) => { if (method === "opportunities_refresh") throw Error("network"); return snapshot; });
    render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    await screen.findByText("Verified park");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Previous data is retained"));
    expect(screen.getByText("Verified park")).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Check/ })).toBeNull();
  });
  it("withholds history labels when backend history is not ready and filters without requests", async () => {
    const request = vi.fn(async () => ({ ...snapshot, history_state: "unavailable" }));
    render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    await screen.findByText("Verified park");
    expect(screen.getByText(/worked and confirmed labels are withheld/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "DXpeditions" }));
    expect(screen.queryByText("Verified park")).toBeNull();
    expect(screen.getByText("DX1ABC: DXpedition")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("remembers filters and loads map selections only into the draft", async () => {
    const located = { ...pota, latitude: 48, longitude: 18, location_source: "public_feed" };
    const request = vi.fn(async (_method: string) => ({ ...snapshot, items: [located] })), select = vi.fn();
    const first = render(<OpportunitiesPanel request={request} onSelect={select} />);
    await screen.findByText("Verified park");
    fireEvent.click(screen.getByRole("tab", { name: "POTA" }));
    fireEvent.change(screen.getByLabelText("Band"), { target: { value: "20m" } });
    fireEvent.click(screen.getByRole("button", { name: "Show map" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load QSO draft only" }));
    expect(select).toHaveBeenCalledWith(located);
    first.unmount();
    render(<OpportunitiesPanel request={request} onSelect={select} />);
    await screen.findByText("Verified park");
    expect(screen.getByRole("tab", { name: "POTA" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Band") as HTMLSelectElement).value).toBe("20m");
    expect(screen.getByRole("button", { name: "Hide map" })).toBeTruthy();
    expect(request.mock.calls.every(([method]) => /opportunities_/.test(method))).toBe(true);
  });
  it("refreshes on a timer and stops polling when unmounted", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => snapshot);
    const view = render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(4);
    view.unmount(); const calls = request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it("shows selected POTA after 100ms while a 20-second unrelated feed is still pending", async () => {
    vi.useFakeTimers();
    localStorage.setItem("xlog.integration.chaser.v1", JSON.stringify({ kind: "pota" }));
    const empty = { ...snapshot, items: [], total_available: 0, sources: [] };
    const settled: string[] = [];
    const startedAt = Date.now();
    let legacyFirstUsefulAt: number | null = null;
    // Before: the original loader published on its 15s snapshot poll or when
    // the all-feed batch finished (20s here), even though POTA was ready at 100ms.
    const legacyAccept = () => {
      if (settled.includes("pota") && legacyFirstUsefulAt == null) legacyFirstUsefulAt = Date.now() - startedAt;
    };
    legacyAccept();
    const legacyPoll = window.setInterval(legacyAccept, 15_000);
    window.setTimeout(legacyAccept, 20_000);
    const request = vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method === "opportunities_snapshot") return Promise.resolve(settled.includes("pota")
        ? { ...snapshot, generated_at: new Date(Date.now()).toISOString(), items: [pota] } : empty);
      const source = params?.source as string;
      return new Promise(resolve => window.setTimeout(() => {
        settled.push(source);
        resolve({ ...snapshot, generated_at: new Date(Date.now()).toISOString(), items: source === "pota" ? [pota] : [pota, expedition] });
      }, source === "pota" ? 100 : 20_000));
    });
    render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "POTA" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { await vi.advanceTimersByTimeAsync(99); });
    expect(screen.queryByText("Verified park")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("Verified park")).toBeTruthy();
    expect(settled).toEqual(["pota"]);
    expect(legacyFirstUsefulAt).toBeNull();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh").map(([, params]) => params?.source))
      .toEqual(["pota", "all"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(19_900); });
    expect(screen.getByText("Verified park")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh feeds" })).toBeTruthy();
    expect(legacyFirstUsefulAt).toBe(15_000);
    window.clearInterval(legacyPoll);
  });
  it("prioritises a saved summit programme and keeps its rows through an unrelated failure", async () => {
    localStorage.setItem("xlog.integration.chaser.v1", JSON.stringify({ kind: "sota" }));
    const summit = { ...pota, id: "sota:OM0RX", kind: "sota", name: "Selected summit" };
    let failBatch!: (reason: Error) => void;
    const request = vi.fn((method: string, params?: Record<string, unknown>) => {
      if (params?.source === "all") return new Promise((_resolve, reject) => { failBatch = reject; });
      return Promise.resolve({ ...snapshot, items: method === "opportunities_snapshot" ? [] : [summit] });
    });
    render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    await screen.findByText("Selected summit");
    expect(request.mock.calls.find(([method]) => method === "opportunities_refresh")?.[1]).toEqual({ source: "sota", automatic: true });
    await act(async () => { failBatch(Error("feed timeout")); });
    expect(screen.getByText("Selected summit")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Previous data is retained");
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("shows cached rows immediately even when every feed download is pending", async () => {
    const request = vi.fn((method: string) => method === "opportunities_snapshot" ? Promise.resolve(snapshot) : new Promise(() => {}));
    const view = render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    expect(await screen.findByText("Verified park")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeTruthy();
    expect(screen.getByText(/Retrying automatically/)).toBeTruthy();
    view.unmount();
  });
  it("paints retained data before starting background feed requests", async () => {
    let finishRead!: (value: unknown) => void;
    const request = vi.fn((method: string) => {
      if (method === "opportunities_snapshot") return new Promise(resolve => { finishRead = resolve; });
      return new Promise(() => {});
    });
    const view = render(<OpportunitiesPanel request={request} onSelect={vi.fn()} />);
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(0);
    await act(async () => { finishRead(snapshot); });
    expect(screen.getByText("Verified park")).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(2);
    view.unmount();
  });
  it("shares pending requests across a refresh prop change and ignores the retired lifecycle", async () => {
    let finish!: (value: unknown) => void;
    const shared = new Promise(resolve => { finish = resolve; });
    const request = vi.fn(() => shared);
    const view = render(<OpportunitiesPanel request={request} onSelect={vi.fn()} refresh={0} />);
    view.rerender(<OpportunitiesPanel request={request} onSelect={vi.fn()} refresh={1} />);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { finish(snapshot); });
    expect(screen.getByText("Verified park")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(3);
    view.unmount();
  });
});
