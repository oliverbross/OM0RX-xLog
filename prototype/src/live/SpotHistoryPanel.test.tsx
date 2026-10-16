// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpotHistoryPanel, spotHistoryFilters, spotHistoryUTC, type SpotHistoryObservation } from "./SpotHistoryPanel";
import { defaultSpotHistoryColumns, spotHistoryColumnsKey } from "./spotHistoryColumnPreferences";

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const report = (id = "report-1", callsign = "OM0RX/P"): SpotHistoryObservation => ({
  id, callsign, sessionID: "session-1", sequence: 1, clusterID: "cluster-1", clusterName: "Test cluster", clusterHost: "cluster.example.invalid",
  arrivedAt: "2026-10-13T10:00:00Z", reportedAt: "2026-10-13T09:59:00Z", timeBasis: "arrival", recordKind: "live",
  spotter: "VK8AA", frequencyKHz: 14025, frequencyText: "14025.0", band: "20m", mode: "CW", source: "cluster",
  country: "Slovakia", adif: 504, comment: "Portable report", specialTags: [], callStatus: "New Call", dxccStatus: "ATNO",
});
const historyPage = (rows = [report()], watermark = 42, nextCursor: string | null = null) => ({ page: { rows, watermark, nextCursor, revision: watermark } });
const summary = (watermark = 42, total = 310) => ({ stats: { total, distinctCalls: 240, distinctSpotters: 12,
  bands: [{ key: "20m", count: total }], modes: [{ key: "CW", count: total }], countries: [{ key: "Slovakia", count: total }],
  sources: [{ key: "cluster", count: total }], spotters: [{ key: "VK8AA", count: total }], hourly: [{ hour: "2026-10-13T10:00:00Z", count: total }],
  earliest: "2026-10-12T12:00:00Z", latest: "2026-10-13T10:00:00Z", watermark, revision: watermark, bucketsTruncated: false } });
const healthy = () => ({ status: { revision: 42, total: 500, earliest: "2026-10-12T12:00:00Z", latest: "2026-10-13T10:00:00Z",
  lastCommit: "2026-10-13T10:00:00Z", schemaVersion: 1, fileBytes: 4096 }, recording: { state: "recording", queued: 0, unrecorded: 0,
  errorCode: null, startedAt: "2026-10-13T00:00:00Z", connections: [{ sessionID: "session-1", clusterID: "cluster-1", clusterName: "Test cluster", phase: "connected", at: "2026-10-13T00:00:00Z" }] } });
function fixture(overrides: Partial<Record<string, (params?: Record<string, unknown>) => any>> = {}) {
  return vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (overrides[method]) return overrides[method]!(params);
    if (method === "spot_history_status") return healthy();
    if (method === "spot_history_query") return historyPage();
    if (method === "spot_history_stats") return summary(Number(params?.watermark ?? 42));
    if (method === "spot_history_detail") return { observation: { ...report(String(params?.id)), rawLine: "DX de VK8AA: 14025 OM0RX/P", classificationJSON: '{"resolver":"stored"}' } };
    throw new Error(`Unexpected authority: ${method}`);
  });
}
function searchCall(call: string) { fireEvent.change(screen.getByRole("textbox", { name: "History callsign" }), { target: { value: call } }); fireEvent.click(screen.getByRole("button", { name: "Search" })); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe("Spot History scope and paging", () => {
  it("persists keyboard column ordering with matching cells and widths without changing retained report state", async () => {
    const request = fixture();
    const view = render(<SpotHistoryPanel request={request} />);
    fireEvent.click(await screen.findByText("OM0RX/P"));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await screen.findByText("DX de VK8AA: 14025 OM0RX/P");
    const calls = request.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const later = screen.getByRole("button", { name: "Move Callsign column later" });
    later.focus(); await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(later);
    const earlier = screen.getByRole("button", { name: "Move Callsign column earlier" });
    fireEvent.click(earlier); fireEvent.click(earlier);
    expect((earlier as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Comment column later" }) as HTMLButtonElement).disabled).toBe(true);
    const headers = () => screen.getAllByRole("columnheader").map(header => header.getAttribute("aria-label"));
    expect(headers().slice(0, 2)).toEqual(["Callsign", "Received UTC"]);
    const row = view.container.querySelector("tbody tr")!;
    expect(within(row as HTMLElement).getAllByRole("cell").slice(0, 2).map(cell => cell.getAttribute("data-label")))
      .toEqual(["Callsign", "Received UTC"]);
    expect(Array.from(view.container.querySelectorAll("colgroup col")).slice(0, 2).map(col => (col as HTMLElement).style.width))
      .toEqual(["110px", "165px"]);
    fireEvent.click(screen.getByLabelText("Show Received UTC column"));
    fireEvent.click(screen.getByLabelText("Show Received UTC column"));
    expect(headers().slice(0, 2)).toEqual(["Callsign", "Received UTC"]);
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("DX de VK8AA: 14025 OM0RX/P")).toBeTruthy();
    expect(screen.getByText("Page 1 · 1 reports shown")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(calls);
    expect(JSON.parse(localStorage.getItem(spotHistoryColumnsKey)!).order.slice(0, 2)).toEqual(["call", "utc"]);
    view.unmount();
    render(<SpotHistoryPanel request={fixture()} />); await screen.findByText("310");
    expect(headers()[0]).toBe("Callsign");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(headers()[0]).toBe("Received UTC");
    expect(JSON.parse(localStorage.getItem(spotHistoryColumnsKey)!)).toEqual(defaultSpotHistoryColumns());
  });
  it("restores keyboard focus to the persistent Details control after closing a report", async () => {
    render(<SpotHistoryPanel request={fixture()} />);
    fireEvent.click(await screen.findByText("OM0RX/P"));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const close = await screen.findByRole("button", { name: "Close details" });
    close.focus();
    fireEvent.click(close);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Details" }));
    expect(screen.queryByRole("button", { name: "Close details" })).toBeNull();
  });
  it("formats ISO values in UTC without depending on local time", () => {
    expect(spotHistoryUTC("2026-10-13T10:00:00+09:30")).toBe("2026-10-13 00:30:00");
    expect(spotHistoryUTC(null)).toBe("—"); expect(spotHistoryUTC("invalid")).toBe("invalid");
  });
  it("defaults to a bounded last-24-hour UTC query and calculates full-scope statistics", async () => {
    const request = fixture(); render(<SpotHistoryPanel request={request} />);
    await screen.findByText("310");
    const query = request.mock.calls.find(([method]) => method === "spot_history_query")![1]!;
    expect(query).toMatchObject({ match: "exact", limit: 100 });
    expect(Date.parse(String(query.to)) - Date.parse(String(query.from))).toBe(86_400_000);
    expect(String(query.from)).toMatch(/Z$/);
    expect(request).toHaveBeenCalledWith("spot_history_stats", { match: "exact", from: query.from, to: query.to, watermark: 42 });
    expect(screen.getByText("240 callsigns")).toBeTruthy(); expect(screen.getByText("12 spotters")).toBeTruthy();
    fireEvent.click(screen.getByText("Statistics")); expect(screen.getByText("20m 310")).toBeTruthy();
    expect(screen.getByText("Page 1 · 1 reports shown")).toBeTruthy();
    expect(Array.from(screen.getByText("OM0RX/P").closest("tr")!.querySelectorAll("td")).map(cell => cell.getAttribute("data-label"))).toEqual([
      "Received UTC", "Callsign", "kHz", "Band / Mode", "Spotter", "Source / Cluster", "Country", "Comment",
    ]);
    const bandMode = Array.from(screen.getByText("OM0RX/P").closest("tr")!.querySelectorAll<HTMLElement>(".spot-history-category"));
    expect(bandMode.map(value => value.textContent)).toEqual(["20m", "CW"]);
    expect(bandMode[0].style.color).not.toBe(bandMode[1].style.color);
    expect(screen.getByRole("cell", { name: "20m band, CW mode" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spot History" })).toBeNull();
  });
  it("applies explicit prefix, portable call, spotter, UTC and optional filters", async () => {
    const request = fixture(); render(<SpotHistoryPanel request={request} />); await screen.findByText("OM0RX/P");
    fireEvent.change(screen.getByRole("textbox", { name: "History callsign" }), { target: { value: " om0rx/p " } });
    fireEvent.change(screen.getByRole("textbox", { name: "History spotter" }), { target: { value: " vk8aa " } });
    fireEvent.change(screen.getByRole("combobox", { name: "Match" }), { target: { value: "prefix" } });
    fireEvent.change(screen.getByRole("combobox", { name: "UTC range" }), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("From UTC"), { target: { value: "2026-10-12T23:15" } });
    fireEvent.change(screen.getByLabelText("To UTC"), { target: { value: "2026-10-13T01:30" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Band" }), { target: { value: "20m" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "CW" } });
    fireEvent.change(screen.getByRole("textbox", { name: "History source" }), { target: { value: "rbl" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("spot_history_query", { call: "OM0RX/P", spotter: "VK8AA", match: "prefix", from: "2026-10-12T23:15:00.000Z", to: "2026-10-13T01:30:00.000Z", band: "20m", mode: "CW", source: "rbl", limit: 100 }));
    await screen.findByText("310");
    fireEvent.change(screen.getByRole("combobox", { name: "UTC range" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" })); await screen.findByText(/All retained dates/);
    const all = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
    expect(all.from).toBeUndefined(); expect(all.to).toBeUndefined();
  });
  it("rejects invalid or reversed UTC ranges without making a new query", async () => {
    const request = fixture(); render(<SpotHistoryPanel request={request} />); await screen.findByText("310");
    fireEvent.change(screen.getByRole("combobox", { name: "UTC range" }), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("From UTC"), { target: { value: "2026-10-14T01:00" } });
    fireEvent.change(screen.getByLabelText("To UTC"), { target: { value: "2026-10-13T01:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("alert").textContent).toContain("From UTC must be earlier");
    expect(request.mock.calls.filter(([method]) => method === "spot_history_query")).toHaveLength(1);
    expect(() => spotHistoryFilters({ call: "", spotter: "", match: "exact", range: "custom", from: "2026-02-30T00:00", to: "2026-03-02T00:00", band: "", mode: "", source: "" })).toThrow("valid UTC");
  });
  it("pins next and previous pages to the watermark and starts a new snapshot on Refresh", async () => {
    let fresh = 42;
    const request = fixture({ spot_history_query: params => params?.cursor ? historyPage([report("report-2", "VK8ZZ")], Number(params.watermark), null) : historyPage([report()], Number(params?.watermark ?? fresh), "next-42") });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("310");
    fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("VK8ZZ");
    expect(request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]).toMatchObject({ cursor: "next-42", watermark: 42 });
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("OM0RX/P");
    const back = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
    expect(back.watermark).toBe(42); expect(back.cursor).toBeUndefined();
    fresh = 51; fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByText(/Snapshot 51/);
    const refresh = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
    expect(refresh.watermark).toBeUndefined(); expect(refresh.cursor).toBeUndefined();
  });
  it("reuses full-scope statistics across pages in the same snapshot", async () => {
    const request = fixture({ spot_history_query: params => params?.cursor ? historyPage([report("report-2", "VK8ZZ")], 42) : historyPage([report()], 42, "next-42") });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("310");
    fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("VK8ZZ");
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("OM0RX/P");
    expect(request.mock.calls.filter(([method]) => method === "spot_history_stats")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByText("310");
    expect(request.mock.calls.filter(([method]) => method === "spot_history_stats")).toHaveLength(2);
  });
  it("fits rows to the measured area and retains resize paging inside the same snapshot", async () => {
    vi.useFakeTimers();
    let resized = () => {}, height = 280;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
    const size = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("spot-history-table-wrap") ? height : 0; });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.tagName === "THEAD" ? 35 : 29 } as DOMRect; });
    const request = fixture({ spot_history_query: params => historyPage(Array.from({ length: Number(params?.limit) }, (_, index) => report(`row-${index}`, `FIT${index}`)), Number(params?.watermark ?? 42), "next-page"),
      spot_history_detail: () => ({ observation: report("row-7", "FIT7") }) });
    try {
      await act(async () => { render(<SpotHistoryPanel request={request} />); });
      // Advance the measurement debounce explicitly rather than depending on
      // a wall-clock findBy timeout while parallel CI workers render 100 rows.
      await act(async () => { await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 1 · 8 reports shown")).toBeTruthy();
      fireEvent.click(screen.getByText("FIT7"));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Details" })); });
      expect(screen.getByLabelText("Report details for FIT7")).toBeTruthy();
      height = 200;
      await act(async () => { resized(); await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 1 · 5 reports shown")).toBeTruthy();
      expect(screen.getByLabelText("Report details for FIT7")).toBeTruthy();
      expect(screen.getByText("FIT0").closest("tr")!.getAttribute("tabindex")).toBe("0");
      const resizedQuery = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
      expect(resizedQuery).toMatchObject({ watermark: 42, limit: 5 }); expect(resizedQuery.cursor).toBeUndefined();
      expect(screen.getByText(/Layout resized; report position and snapshot retained/)).toBeTruthy();
      expect(request.mock.calls.filter(([method]) => method === "spot_history_stats")).toHaveLength(1);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next" })); });
      expect(screen.getByText("Page 2 · 5 reports shown")).toBeTruthy();
      height = 4000;
      await act(async () => { resized(); await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 2 · 100 reports shown")).toBeTruthy();
      const enlargedQuery = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
      expect(enlargedQuery).toMatchObject({ cursor: "next-page", watermark: 42, limit: 100 });
      expect(request.mock.calls.filter(([method]) => method === "spot_history_query").every(([, params]) => Number(params?.limit) <= 100)).toBe(true);
    } finally { cleanup(); size.mockRestore(); rect.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
  it("keeps Next navigation after closing details changes the available row count", async () => {
    vi.useFakeTimers();
    let resized = () => {};
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
    const size = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("spot-history-table-wrap") ? document.querySelector(".spot-history-detail") ? 200 : 280 : 0; });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.tagName === "THEAD" ? 35 : 29 } as DOMRect; });
    const request = fixture({ spot_history_query: params => historyPage(Array.from({ length: Number(params?.limit) }, (_, index) => report(`row-${index}`, `FIT${index}`)), Number(params?.watermark ?? 42), "next-page"),
      spot_history_detail: () => ({ observation: report("row-0", "FIT0") }) });
    try {
      await act(async () => { render(<SpotHistoryPanel request={request} />); });
      await act(async () => { await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 1 · 8 reports shown")).toBeTruthy();
      fireEvent.click(screen.getByText("FIT0"));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Details" })); });
      expect(screen.getByLabelText("Report details for FIT0")).toBeTruthy();
      await act(async () => { resized(); await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 1 · 5 reports shown")).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next" })); });
      expect(screen.getByText("Page 2 · 5 reports shown")).toBeTruthy();
      expect(screen.queryByLabelText("Report details for FIT0")).toBeNull();
      await act(async () => { resized(); await vi.advanceTimersByTimeAsync(120); });
      expect(screen.getByText("Page 2 · 8 reports shown")).toBeTruthy();
      expect(request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]).toMatchObject({ cursor: "next-page", watermark: 42, limit: 8 });
      expect(request.mock.calls.filter(([method]) => method === "spot_history_stats")).toHaveLength(1);
    } finally { cleanup(); size.mockRestore(); rect.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
  it("refreshes the applied scope even when draft fields have changed", async () => {
    const request = fixture(); render(<SpotHistoryPanel request={request} />); await screen.findByText("310");
    fireEvent.change(screen.getByRole("combobox", { name: "UTC range" }), { target: { value: "all" } }); searchCall("OM0RX/P"); await screen.findByText("310");
    fireEvent.change(screen.getByRole("textbox", { name: "History callsign" }), { target: { value: "UNAPPLIED" } });
    fireEvent.change(screen.getByRole("combobox", { name: "UTC range" }), { target: { value: "24h" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByText("310");
    const query = request.mock.calls.filter(([method]) => method === "spot_history_query").at(-1)![1]!;
    expect(query.call).toBe("OM0RX/P"); expect(query.from).toBeUndefined();
  });
});

describe("Spot History asynchronous boundaries", () => {
  it.each(["success", "failure"])("ignores a late query %s after a new search", async completion => {
    const old = deferred<ReturnType<typeof historyPage>>();
    const request = fixture({ spot_history_query: params => params?.call ? historyPage([report("new", "NEWCALL")], 51) : old.promise });
    render(<SpotHistoryPanel request={request} />); searchCall("NEWCALL"); await screen.findByText("NEWCALL");
    await act(async () => { if (completion === "success") old.resolve(historyPage([report("old", "OLDCALL")])); else old.reject(new Error("Old request failed")); });
    expect(screen.queryByText("OLDCALL")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["success", "failure"])("ignores a late statistics %s after a new search", async completion => {
    const old = deferred<ReturnType<typeof summary>>();
    const request = fixture({ spot_history_query: params => params?.call ? historyPage([report("new", "NEWCALL")], 51) : historyPage(),
      spot_history_stats: params => params?.watermark === 42 ? old.promise : summary(51, 999) });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("OM0RX/P"); searchCall("NEWCALL"); await screen.findByText("999");
    await act(async () => { if (completion === "success") old.resolve(summary(42, 7)); else old.reject(new Error("Old summary failed")); });
    expect(screen.queryByText("7")).toBeNull(); expect(screen.queryByRole("button", { name: "Retry statistics" })).toBeNull();
  });
  it("suppresses a late detail response and escapes full original source", async () => {
    const old = deferred<{ observation: SpotHistoryObservation }>();
    const request = fixture({ spot_history_query: () => historyPage([report(), report("report-2", "VK8ZZ")]),
      spot_history_detail: params => params?.id === "report-1" ? old.promise : { observation: { ...report("report-2", "VK8ZZ"), comment: "<img src=x onerror=alert(1)>", rawLine: "<script>unsafe()</script>", classificationJSON: '{"original":"<b>source</b>"}' } } });
    render(<SpotHistoryPanel request={request} />); fireEvent.click(await screen.findByText("OM0RX/P")); fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getByText("VK8ZZ")); fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const panel = await screen.findByLabelText("Report details for VK8ZZ"); await within(panel).findByText("<script>unsafe()</script>");
    await act(async () => old.resolve({ observation: { ...report(), rawLine: "Late original" } }));
    expect(screen.queryByText("Late original")).toBeNull(); expect(panel.querySelector("script, img")).toBeNull();
    expect(within(panel).getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-controls")).toBe(panel.id);
  });
  it("supports keyboard selection and opening details", async () => {
    const request = fixture({ spot_history_query: () => historyPage([report(), report("report-2", "VK8ZZ")]), spot_history_detail: () => ({ observation: report("report-2", "VK8ZZ") }) });
    render(<SpotHistoryPanel request={request} />); const first = (await screen.findByText("OM0RX/P")).closest("tr")!;
    fireEvent.keyDown(first, { key: "ArrowDown" }); const second = screen.getByText("VK8ZZ").closest("tr")!;
    expect(second.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Enter" }); await screen.findByLabelText("Report details for VK8ZZ");
    expect(request).toHaveBeenCalledWith("spot_history_detail", { id: "report-2" });
  });
  it("does not overlap status requests or poll the query while browsing", async () => {
    vi.useFakeTimers(); const first = deferred<ReturnType<typeof healthy>>(); let polls = 0;
    const request = fixture({ spot_history_status: () => ++polls === 1 ? first.promise : healthy() });
    render(<SpotHistoryPanel request={request} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); vi.advanceTimersByTime(20_000); });
    expect(polls).toBe(1);
    await act(async () => { first.resolve(healthy()); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(polls).toBe(2);
    expect(request.mock.calls.filter(([method]) => method === "spot_history_query")).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === "spot_history_stats")).toHaveLength(1);
  });
});

describe("Spot History recovery and authority", () => {
  it("distinguishes empty archive, filtered empty and failed query with retry", async () => {
    let fails = false;
    const request = fixture({ spot_history_status: () => ({ ...healthy(), status: { ...healthy().status, total: 0 } }),
      spot_history_query: () => { if (fails) throw new Error("database locked"); return historyPage([]); }, spot_history_stats: () => summary(42, 0) });
    const view = render(<SpotHistoryPanel request={request} />); await screen.findByText("No reports retained yet"); view.unmount();
    const filtered = fixture({ spot_history_query: () => historyPage([]), spot_history_stats: () => summary(42, 0) });
    const filteredView = render(<SpotHistoryPanel request={filtered} />); await screen.findByText("No reports match this search"); filteredView.unmount();
    fails = true; render(<SpotHistoryPanel request={request} />); await screen.findByRole("button", { name: "Retry history" });
    expect(screen.queryByText("No reports retained yet")).toBeNull(); fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry history" })); await screen.findByText("No reports retained yet");
  });
  it("retains rows when statistics fail and offers a scoped retry", async () => {
    let fails = true; const request = fixture({ spot_history_stats: () => { if (fails) throw new Error("timed out"); return summary(); } });
    render(<SpotHistoryPanel request={request} />); await screen.findByRole("button", { name: "Retry statistics" });
    expect(screen.getByText("OM0RX/P")).toBeTruthy(); fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry statistics" })); await screen.findByText("310");
  });
  it("exposes unavailable status separately from no matching reports", async () => {
    const request = fixture({ spot_history_status: () => ({ ...healthy(), status: null, recording: { ...healthy().recording, state: "unavailable", errorCode: "future_schema" } }), spot_history_query: () => historyPage([]), spot_history_stats: () => summary(42, 0) });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("History is unavailable");
    expect(screen.queryByText("No reports match this search")).toBeNull(); expect(screen.getByText("Recording code: future_schema")).toBeTruthy();
  });
  it("shows recording degradation, known gaps and prior coverage events", async () => {
    const request = fixture({ spot_history_status: () => ({ ...healthy(), recording: { ...healthy().recording, state: "degraded", queued: 8, unrecorded: 3, errorCode: "writer_busy", events: [{ id: "event-1", occurredAt: "2026-10-12T01:00:00Z", kind: "recording_gap", payloadJSON: '{"unrecorded":2}' }] } }) });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("Recording degraded");
    expect(screen.getByText("Known archive gap: 3 unrecorded reports")).toBeTruthy(); expect(screen.getByText(/8 queued/)).toBeTruthy();
    expect(within(screen.getByLabelText("Recorded coverage events")).getByText(/recording_gap/)).toBeTruthy();
    expect(screen.getByText(/disconnected periods are not backfilled/)).toBeTruthy();
  });
  it("keeps persisted gap evidence visible after recording has recovered", async () => {
    const request = fixture({ spot_history_status: () => ({ ...healthy(), recording: { ...healthy().recording, retainedGap: true, events: [{ id: "event-1", occurredAt: "2026-10-12T01:00:00Z", kind: "unclean_shutdown", payloadJSON: "{}" }] } }) });
    render(<SpotHistoryPanel request={request} />); await screen.findByText("Known archive gap: inspect recorded coverage events");
    expect(screen.getByText("Recording")).toBeTruthy(); expect(screen.getByText(/unclean_shutdown/)).toBeTruthy();
  });
  it("accepts wrapped worker results and only requests read-only archive methods", async () => {
    const base = fixture(); const request = vi.fn(async (method: string, params?: Record<string, unknown>) => ({ result: await base(method, params) }));
    render(<SpotHistoryPanel request={request} />); fireEvent.click(await screen.findByText("OM0RX/P")); fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await screen.findByText("DX de VK8AA: 14025 OM0RX/P");
    const methods = new Set(request.mock.calls.map(([method]) => method));
    expect([...methods].sort()).toEqual(["spot_history_detail", "spot_history_query", "spot_history_stats", "spot_history_status"]);
  });
});
