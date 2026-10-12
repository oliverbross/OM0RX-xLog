// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveApp from "../src/LiveApp";
import Conditions from "../src/live/Conditions";
import Monitor from "../src/live/Monitor";
const calls = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/worker", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/worker")>(), workerRequest: calls.request, openMonitor: vi.fn() }));
vi.mock("../src/Map", () => ({ default: () => <div>Map surface</div> }));
let exists = false;
beforeEach(() => {
  exists = false; localStorage.clear(); calls.request.mockReset();
  calls.request.mockImplementation(async (method: string) => {
    const result = method === "workspace_status" ? { workspace_exists: exists, native_log_exists: true }
      : method === "workspace_create" ? (exists = true, { mode: "copy_native" })
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "station_snapshot" ? { source: "xcat_loopback", available: false, radio: null }
      : method === "settings_load" ? { settings: { stationCall: "", gridSquare: "" } }
      : method === "logbook_stats" ? { stats: { qso_count: 0 } }
      : method === "logbook_draft" ? { qso: { id: "draft", start: "2026-10-12T00:00:00Z", call: "", band: "20m", mode: "SSB" } }
      : method === "lookup_call" ? { source: "No match" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { ok: true, result };
  });
});
afterEach(cleanup);

it("opens the draft without waiting for slow logbook aggregates", async () => {
  exists = true;
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "logbook_stats" ? new Promise(() => {}) : base(method, params));
  render(<LiveApp />);
  expect(await screen.findByLabelText("Callsign")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Operator Desk" })).toBeNull();
  expect(calls.request).toHaveBeenCalledWith("logbook_stats", {});
  expect(screen.getByRole("button", { name: "Monitor" }).closest(".sidebar-foot")).not.toBeNull();
  expect(document.querySelector(".main-station-rail")?.textContent).not.toContain("Monitor");
});

it.each([{ kind: "pota", reference_kind: "pota", reference: "US-0001", field: "POTA" },
  { kind: "dxpedition", reference_kind: "iota", reference: "EU-001", field: "IOTA" }])("loads $kind reference into a draft without tuning or moving a rotor", async (programme) => {
  exists = true;
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "opportunities_snapshot" ? Promise.resolve({ result: {
    items: [{ id: "pota:test", ...programme, callsign: "K1ABC", name: "Park", frequency_hz: 14025000, mode: "CW", comment: "", source: "pota", source_url: "", observed_at: "2026-10-12T00:00:00Z", expires_at: "2026-10-12T01:00:00Z", worked_count: 0, confirmed_count: 0 }], sources: [], total_available: 1, history_state: "ready",
  } }) : base(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Chaser & DX" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load K1ABC into QSO draft" }));
  expect((await screen.findByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect((screen.getByLabelText(programme.field) as HTMLInputElement).value).toBe(programme.reference);
  expect((screen.getByRole("checkbox", { name: "Follow radio" }) as HTMLInputElement).checked).toBe(false);
  expect(calls.request.mock.calls.some(([method]) => ["station_tune", "rotor_goto", "logbook_save", "sync_run"].includes(method))).toBe(false);
});

it("resumes a saved reconnect cluster while radio is offline, once only", async () => {
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "cluster_snapshot" ? Promise.resolve({ ok: true, result: {
    configuration: { reconnect: true, servers: [{ enabled: true }] }, snapshot: { spots: [], connections: [], connectedClusters: 0 },
  } }) : base(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(calls.request).toHaveBeenCalledWith("cluster_connect", {}));
  expect(calls.request.mock.calls.filter(([method]) => method === "cluster_connect")).toHaveLength(1);
  expect(calls.request.mock.calls.some(([method]) => ["station_connect", "station_tune", "rotor_connect", "rotor_goto"].includes(method))).toBe(false);
});

it("does not reconnect after an explicit disconnect from a prior session", async () => {
  localStorage.setItem("xlog.integration.clusterSessionIntent", "disconnected");
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "cluster_snapshot" ? Promise.resolve({ ok: true, result: {
    configuration: { reconnect: true, servers: [{ enabled: true }] }, snapshot: { spots: [], connections: [], connectedClusters: 0 },
  } }) : base(method, params));
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  expect(calls.request.mock.calls.some(([method]) => method === "cluster_connect")).toBe(false);
});

it("starts with real-data onboarding and only reads; never creates a log or commands hardware implicitly", async () => {
  render(<LiveApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy my existing xLog logbook" }).hasAttribute("disabled")).toBe(false));
  expect(calls.request.mock.calls.every(([method]) => ["workspace_status", "cluster_snapshot", "station_snapshot", "rotor_snapshot", "propagation_snapshot"].includes(method))).toBe(true);
  expect(screen.getByText("No sample contacts, spots or station readings are loaded.")).toBeTruthy();
});

it("copies only on explicit action and retains the operator callsign through readback refresh", async () => {
  render(<LiveApp />);
  const copy = await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  await waitFor(() => expect(copy.hasAttribute("disabled")).toBe(false));
  await userEvent.click(copy);
  const input = await screen.findByLabelText("Callsign");
  await userEvent.type(input, "EA7EU");
  expect(calls.request).toHaveBeenCalledWith("workspace_create", { mode: "copy_native" });
  expect((input as HTMLInputElement).value).toBe("EA7EU");
  expect(calls.request.mock.calls.some(([method]) => ["logbook_save", "station_tune", "station_action", "sync_run"].includes(method))).toBe(false);
});

it("keeps graphical propagation and last-known bars when refresh temporarily has no data", () => {
  const request = vi.fn();
  const { rerender } = render(<Conditions request={request} propagation={{ solar_flux: 140, bands: [{ name: "20m", day: "Good", night: "Fair" }], updated_at: 1 }} />);
  expect(screen.getByLabelText("Day: Good")).toBeTruthy();
  rerender(<Conditions request={request} propagation={null} />);
  expect(screen.getByLabelText("Day: Good")).toBeTruthy();
  expect(screen.getByText(/last known/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it("renders both observed VFOs and rotor bearing without exposing write controls", () => {
  render(<Monitor map={<div>Map</div>} snapshot={{ source: "direct_agent", radio: { connected: true, observed: true,
    mode: "CW", receive_vfo: "A", receive_frequency_hz: 14025000, transmit_vfo: "B", transmit_frequency_hz: 14026000 },
    station: { kpa_operate: false, tx_power_watts: 0, swr: 1.2, rf_drive_watts: 25 }, rotor: { connected: true, azimuth: 184 } }} />);
  expect(screen.getByText("A: 14.025000")).toBeTruthy();
  expect(screen.getByText("B: 14.026000")).toBeTruthy();
  expect(screen.getByText("184°")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
