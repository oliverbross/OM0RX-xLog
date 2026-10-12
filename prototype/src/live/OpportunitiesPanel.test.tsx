// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpportunitiesPanel } from "./OpportunitiesPanel";

const pota = { id: "pota:OM0RX:OM-0001", kind: "pota", callsign: "OM0RX/P", reference: "OM-0001", name: "Verified park",
  frequency_hz: 14_074_000, mode: "FT8", observed_at: "2026-10-12T10:00:00Z", expires_at: "2026-10-12T10:30:00Z",
  source: "POTA official spots", source_url: "https://api.pota.app/spot/activator", comment: "", reference_status: "verified",
  worked_count: 3, confirmed_count: 1, band_modes: [{ band: "20m", mode: "FT8", worked_count: 3, confirmed_count: 1 }] };
const expedition = { ...pota, id: "425dxn:DX1", kind: "dxpedition", callsign: "DX1ABC", reference: "", name: "DX1ABC: DXpedition",
  frequency_hz: null, mode: "", source: "425DXN Worldwide DX Calendar", source_url: "https://www.425dxn.org/index.php?op=wcal",
  reference_status: "not_applicable", worked_count: 0, confirmed_count: 0, band_modes: [] };
const snapshot = { generated_at: "2026-10-12T10:01:00Z", items: [pota, expedition], total_available: 2, history_state: "ready",
  sources: [{ source: "pota", state: "stale", count: 1, source_url: pota.source_url, last_success: "2026-10-11T10:00:00Z", last_attempt: null, safe_error: "SOURCE_UNAVAILABLE_OR_INVALID" }], selection_tunes: false, transmit: false };
vi.mock("../Map", () => ({ default: (props: { data: { id: string }[]; onSpot: (spot: { id: string }) => void; spotActionLabel: string }) =>
  <button onClick={() => props.onSpot(props.data[0])}>{props.spotActionLabel}</button> }));
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

describe("read-only opportunities", () => {
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
    expect(request).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
  });
  it("shows source age, full reference history and only loads a draft on selection", async () => {
    const request = vi.fn(async (_method: string) => snapshot), select = vi.fn();
    render(<OpportunitiesPanel request={request} onSelect={select} />);
    expect(await screen.findByText("Verified park")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
    expect(screen.getByText(/Retrying automatically/)).toBeTruthy();
    expect(screen.getByText("3 worked")).toBeTruthy();
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
    expect(request).toHaveBeenCalledWith("opportunities_refresh", { source: "all" });
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
    expect(request).toHaveBeenCalledTimes(2);
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
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(2);
    view.unmount(); const calls = request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(request).toHaveBeenCalledTimes(calls);
  });
});
