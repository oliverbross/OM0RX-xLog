// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AwardsPanel } from "./AwardsPanel";

const stats = { awards: {
  qso_count: 412, dxcc_worked: 67, dxcc_confirmed: 54, cq_zones_worked: 31,
  cq_zones_confirmed: 28, states_worked: 12, states_confirmed: 9, grids_worked: 75,
  grids_confirmed: 50, mode_counts: { CW: 240, SSB: 172 },
  band_counts: { "20m": 300, "40m": 112 }, continent_counts: { EU: 320, AS: 92 },
  achievements: [{ code: "DXCC", title: "DXCC entities", current: 67, target: 100, completed: false }],
} };
const catalogue = { reference_date: "2026-09-01", research_date: "2026-09-30", total_programmes: 2,
  catalogue_total: 192, offset: 0, limit: 20,
  delivery_counts: { implemented: 9, trackingOnly: 180, blocked: 2, historical: 1 },
  items: [{ code: "AJD", title: "All Japan Districts", worked: 8, current: 7, sponsor_credited: null,
    target: 10, unit: "districts", detail: "Eligible confirmed districts from the local log.",
    breakdowns: [{ label: "Honshu", value: 4, target: 5 }] }],
  programmes: [
    { id: "jarl.ajd", short_code: "AJD", name: "All Japan Districts", sponsor: "JARL", catalogue_group: "world",
      delivery_state: "implemented", delivery_detail: "Local evidence estimate; submit separately.", progress_code: "AJD",
      scope_or_counting_focus: "Districts in Japan", research_sections: [{ title: "Modes", text: "CW and SSB" }],
      open_questions: ["Confirm sponsor rules"], official_sources: [{ url: "https://example.org/rules" }], checked_on_utc: "2026-09-30" },
    { id: "research.castles", short_code: "CASTLES", name: "Castles research", sponsor: "Society", catalogue_group: "europe",
      delivery_state: "blocked", delivery_detail: "Reference list unavailable.", progress_code: null,
      scope_or_counting_focus: "Castle references", research_sections: [], open_questions: [], official_sources: [], checked_on_utc: "2026-09-30" },
  ],
};
const makeRequest = () => vi.fn(async (method: string) => method === "logbook_stats" ? stats : catalogue);
afterEach(() => cleanup());

describe("native Insights and Awards presentation", () => {
  it("shows already loaded award totals immediately without a duplicate worker calculation", async () => {
    const request = makeRequest();
    render(<AwardsPanel request={request} refresh={0} initialStats={stats.awards} />);
    expect(screen.getByRole("progressbar", { name: "DXCC milestone" }).getAttribute("aria-valuenow")).toBe("67");
    await screen.findByRole("article", { name: "All Japan Districts detail" });
    expect(request.mock.calls.filter(([method]) => method === "logbook_stats")).toHaveLength(0);
  });
  it("uses native worker counts, achievements and nine-rule evidence without computing an award", async () => {
    const request = makeRequest();
    render(<AwardsPanel request={request} refresh={0} />);
    expect(await screen.findByRole("article", { name: "All Japan Districts detail" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "DXCC milestone" }).getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText("Not imported")).toBeTruthy();
    expect(screen.getByText("Honshu")).toBeTruthy();
    expect(screen.getByText("Local evidence estimate; submit separately.")).toBeTruthy();
    expect(screen.getByText("192")).toBeTruthy();
    expect(screen.getByText("180")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("logbook_stats");
  });

  it("keeps research-only and blocked programmes free of invented eligibility", async () => {
    render(<AwardsPanel request={makeRequest()} refresh={0} />);
    await screen.findByRole("article", { name: "All Japan Districts detail" });
    fireEvent.click(screen.getByRole("button", { name: "Castles research, Blocked" }));
    const detail = screen.getByRole("article", { name: "Castles research detail" });
    expect(within(detail).getByText("No eligibility result is asserted for this programme.")).toBeTruthy();
    expect(within(detail).getByText("Reference list unavailable.")).toBeTruthy();
    expect(within(detail).queryByText("evidence-eligible")).toBeNull();
  });

  it("sends native facets to the worker before pagination", async () => {
    const request = makeRequest();
    render(<AwardsPanel request={request} refresh={0} />);
    await screen.findByRole("article", { name: "All Japan Districts detail" });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "europe" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "cw" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "hunter" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "trackingOnly" } });
    fireEvent.change(screen.getByLabelText("Search programmes"), { target: { value: "castle" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_catalog", expect.objectContaining({
      offset: 0, limit: 20, search: "castle", delivery_state: "trackingOnly",
      catalogue_group: "europe", mode_facet: "cw", role_facet: "hunter",
    })));
  });

  it("renders only safe official links and readable projection text", async () => {
    const unsafe = { ...catalogue, programmes: [{ ...catalogue.programmes[0], official_sources: [{ url: "javascript:alert(1)" }, { url: "https://example.org/rules" }] }] };
    const request = vi.fn(async (method: string) => method === "logbook_stats" ? stats : unsafe);
    render(<AwardsPanel request={request} refresh={0} />);
    const detail = await screen.findByRole("article", { name: "All Japan Districts detail" });
    expect(within(detail).getByText("CW and SSB")).toBeTruthy();
    const links = within(detail).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.org/rules");
    expect(detail.textContent).not.toContain("{\"");
  });

  it("refreshes native totals after a logbook mutation", async () => {
    const request = makeRequest();
    const view = render(<AwardsPanel request={request} refresh={0} />);
    await screen.findByRole("article", { name: "All Japan Districts detail" });
    view.rerender(<AwardsPanel request={request} refresh={1} />);
    await waitFor(() => expect(request.mock.calls.filter(([method]) => method === "logbook_stats")).toHaveLength(2));
  });
});
