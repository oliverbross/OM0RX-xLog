// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedOpportunitiesSurface, requestDetachedOpportunity } from "./DetachedOpportunitiesSurface";
import { loadWindowSurface } from "../windowSurface";

const api = vi.hoisted(() => ({ worker: vi.fn(), dock: vi.fn(), activate:vi.fn(), status: null as null | { phase: "uncertain"; operationId: string; tuneConfirmed: boolean; rotor: string } }));
vi.mock("./useSpotActivation", () => ({ useSpotActivation: () => ({ status:api.status, error:"", requesting:false, activate:api.activate, reconcile:vi.fn() }) }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("../Map", () => ({ default: () => <div>Opportunity map</div> }));

const opportunity = { id: "pota:OM0RX:OM-0001", kind: "pota", callsign: "OM0RX/P", reference: "OM-0001", name: "Verified park",
  frequency_hz: 14_074_000, mode: "FT8", observed_at: "2026-10-14T05:00:00Z", expires_at: "2026-10-14T06:00:00Z",
  source: "POTA official spots", source_url: "https://api.pota.app/spot/activator", comment: "", reference_status: "verified",
  worked_count: 0, confirmed_count: 0, band_modes: [] };
const snapshot = { generated_at: "2026-10-14T05:01:00Z", items: [opportunity], total_available: 1, history_state: "ready",
  sources: [], selection_tunes: false, transmit: false };

afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); api.status = null; });

it("keeps uncertain activation recovery available in direct-menu Chaser & DX", async () => {
  api.worker.mockResolvedValue({ result: snapshot });
  api.status = { phase: "uncertain", operationId: crypto.randomUUID(), tuneConfirmed: false, rotor: "uncertain" };
  const Surface = await loadWindowSurface("?view=chaser-dx");
  render(<Surface />);
  await screen.findByText("Verified park");
  expect(screen.getByText(/Spot activation outcome is uncertain/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Check activation/ })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: /Load .* into QSO draft/ })).toBeTruthy();
});

it("owns a main-absent view and delegates draft selection only to the protected native owner", async () => {
  api.worker.mockResolvedValue({ result: snapshot }); api.dock.mockResolvedValue(undefined);
  api.activate.mockResolvedValue({ phase:"confirmed", draftOnly:true });
  render(<DetachedOpportunitiesSurface />);
  expect(await screen.findByText("Verified park")).toBeTruthy();
  expect(screen.getByRole("main", { name: "Detached Chaser & DX" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Load .* into QSO draft/ }));
  await waitFor(() => expect(api.activate).toHaveBeenCalledWith(opportunity));
  expect([...new Set(api.worker.mock.calls.map(([method]) => method))].sort()).toEqual(["opportunities_refresh", "opportunities_snapshot"]);
  expect(api.worker.mock.calls.every(([method]) => ["opportunities_refresh", "opportunities_snapshot"].includes(method))).toBe(true);
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Chaser & DX" })).toBeNull();
});

it("rejects every method outside the exact passive feed boundary", async () => {
  for (const method of ["logbook_operator_draft_apply", "station_tune", "rotor_goto", "hamlib_control", "settings_load"])
    await expect(requestDetachedOpportunity(method)).rejects.toThrow("unavailable");
  expect(api.worker).not.toHaveBeenCalled();
});

it("keeps task-local selection failure visible without loading the main application", async () => {
  api.worker.mockResolvedValue({ result: snapshot }); api.activate.mockRejectedValue(new Error("Selection unavailable"));
  render(<DetachedOpportunitiesSurface />); await screen.findByText("Verified park");
  fireEvent.click(screen.getByRole("button", { name: /Load .* into QSO draft/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("Selection unavailable");
});
