// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveApp from "../src/LiveApp";
import Conditions from "../src/live/Conditions";
import Monitor from "../src/live/Monitor";
import { operatorDraftFixture } from "./operator-draft-fixture";
import { contactEditFixture } from "./contact-edit-fixture";
import { readContactJournal } from "../src/live/logbookContactSession";
const calls = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/worker", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/worker")>(), workerRequest: calls.request, openMonitor: vi.fn() }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await calls.request(method, params)).result }));
vi.mock("../src/live/logbookContactTransport", () => ({ requestLogbookContact: async (method: string, params: any = {}) => (await calls.request(method, params)).result }));
vi.mock("../src/Map", () => ({ default: () => <div>Map surface</div> }));
let exists = false;
beforeEach(() => {
  exists = false; localStorage.clear(); calls.request.mockReset();
  const sharedDraft = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "", band: "20m", mode: "SSB" });
  calls.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = sharedDraft(method, params);
    if (shared) return { ok: true, result: shared };
    const result = method === "workspace_status" ? { workspace_exists: exists, native_log_exists: true }
      : method === "workspace_create" ? (exists = true, { mode: "copy_native" })
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "station_snapshot" ? { source: "xcat_loopback", available: false, radio: null }
      : method === "settings_load" ? { settings: { stationCall: "", gridSquare: "" } }
      : method === "workspace_preferences_load" ? { stored: true, preferences: { deskBandMapBands: ["20m", "15m"], detachedBandMapBands: ["20m", "15m"],
        deskBandMapFollowsRadio: false, detachedBandMapFollowsRadio: false, detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1.2,
        intelligenceBands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"], clusterSpotOpensFullEditor: false } }
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

it("logs through the shared draft receipt and keeps Follow radio enabled on normal Save", async () => {
  exists = true;
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "K1ABC" } });
  const follow = within(screen.getByLabelText("Callsign").closest("form")!).getByRole("checkbox", { name: "Follow radio" }) as HTMLInputElement;
  if (!follow.checked) fireEvent.click(follow);
  fireEvent.submit(screen.getByLabelText("Callsign").closest("form")!);
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
  expect(follow.checked).toBe(true);
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1);
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
});

it("recovers a lost Save acknowledgement without a second Save and leaves non-QSO navigation usable", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => {
    const result = await backend(method, params);
    if (method === "logbook_operator_draft_apply" && params.action === "save") throw new Error("Acknowledgement lost");
    return result;
  });
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "K1ABC" } });
  fireEvent.submit(screen.getByLabelText("Callsign").closest("form")!);
  const recovery = await screen.findByRole("alert", { name: "QSO draft recovery" });
  expect(recovery.textContent).toContain("retained");
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(screen.getByRole("button", { name: "Settings" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Check saved operation" }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: "QSO draft recovery" })).toBeNull());
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("");
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1);
});

it("offers legacy local text explicitly as a new draft without logging it automatically", async () => {
  exists = true;
  localStorage.setItem("xlog.integration.draft", JSON.stringify({ id: "legacy-id", wavelogID: 12, start: "2026-10-12T00:00:00Z", call: "OLD1", band: "20m", mode: "SSB" }));
  render(<LiveApp />);
  const input = await screen.findByLabelText("Callsign") as HTMLInputElement;
  expect(input.value).toBe("");
  expect(localStorage.getItem("xlog.integration.draft")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Recover old text as new draft" }));
  await waitFor(() => expect(localStorage.getItem("xlog.integration.draft")).toBeNull());
  expect(input.value).toBe("OLD1");
  const replace = calls.request.mock.calls.find(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "replace")?.[1];
  expect(replace.qso).toMatchObject({ id: "draft", call: "OLD1", wavelogID: null });
  expect(calls.request.mock.calls.some(([method, params]) => method === "logbook_save" || params?.action === "save" || ["station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it("retains conflicting local text and lets the operator explicitly load the shared draft", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  let conflict = false;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply" && params.action === "replace") {
      conflict = true;
      return { result: { status: "conflict", draft: { revision: 1, qso: { ...params.qso, call: "OTHER" } } } };
    }
    if (method === "logbook_operator_draft" && conflict)
      return { result: { draft: { revision: 1, qso: { id: "draft", call: "OTHER", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" } } } };
    return backend(method, params);
  });
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  await screen.findByRole("alert", { name: "QSO draft recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use shared draft" })); });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("OTHER");
  expect(calls.request.mock.calls.some(([method, params]) => method === "logbook_save" || params?.action === "save")).toBe(false);
});

it.each(["Update QSO", "Clear QSO"])("keeps an existing contact edit separate from the active draft on %s", async action => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact);
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) } : method === "logbook_list"
    ? { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } }
    : method === "logbook_save" ? { result: { qso: params.qso } } : backend(method, params));
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.doubleClick(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "W1AW/P" } });
  fireEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL"));
  const existing = calls.request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(existing).toHaveLength(action === "Update QSO" ? 1 : 0);
  if (existing.length) expect(existing[0][1].qso).toMatchObject({ id: "logged-contact", call: "W1AW/P" });
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action !== "replace")).toHaveLength(0);
});

it("recovers a logged-contact update after renderer restart without replaying it or replacing the new draft", async () => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact), backend = calls.request.getMockImplementation()!;
  let receiptAvailable = false;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_list") return { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } };
    if (method === "logbook_contact_receipt" && !receiptAvailable) return { result: { receipt: null } };
    if (method.startsWith("logbook_contact")) {
      const result = contactBackend.request(method, params);
      if (method === "logbook_contact_apply") throw new Error("Update acknowledgement lost");
      return { result };
    }
    return backend(method, params);
  });
  const first = render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.doubleClick(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "W1AW/P" } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(readContactJournal(localStorage.getItem("xlog.integration.contactEdit.main.v1"))?.pending).toBeTruthy();
  first.unmount(); render(<LiveApp />);
  await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW/P");
  expect(screen.getByRole("button", { name: "Settings" }).hasAttribute("disabled")).toBe(false);
  receiptAvailable = true;
  fireEvent.click(screen.getByRole("button", { name: "Check contact update" }));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL"));
  expect(contactBackend.updates).toBe(1);
  expect(calls.request.mock.calls.filter(([method]) => method === "logbook_contact_apply")).toHaveLength(1);
  expect(localStorage.getItem("xlog.integration.contactEdit.main.v1")).toBeNull();
  expect(calls.request.mock.calls.some(([method]) => ["logbook_save", "station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it("shows restored contact recovery even when its receipt service is unavailable", async () => {
  exists = true;
  const qso = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  localStorage.setItem("xlog.integration.contactEdit.main.v1", JSON.stringify({ base: { revision: 1, qso }, draft: qso,
    pending: { operationID: "unconfirmed", contactID: qso.id, expectedRevision: 1, action: "update", qso } }));
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_contact_receipt") throw new Error("Receipt service unavailable");
    return backend(method, params);
  });
  render(<LiveApp />);
  expect(await screen.findByRole("alert", { name: "Logged contact recovery" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check contact update" })).toBeTruthy();
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW");
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
});

it("blocks backup replacement while a contact edit is retained", async () => {
  exists = true;
  const qso = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  localStorage.setItem("xlog.integration.contactEdit.main.v1", JSON.stringify({ base: { revision: 1, qso }, draft: qso, pending: null }));
  const contactBackend = contactEditFixture(qso), backend = calls.request.getMockImplementation()!;
  const manifest = { createdAt: "2026-10-12T10:00:00Z", qsoCount: 42, pendingSyncCount: 0, databaseBytes: 1024, includesReferenceData: false };
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) }
    : method === "backup_list" ? { result: { backups: [{ name: "Fixture.xlogbackup" }] } }
    : method === "backup_inspect" ? { result: { name: "Fixture.xlogbackup", manifest, includes_settings: false } }
    : backend(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Backups" }));
  fireEvent.click(await screen.findByText("Fixture.xlogbackup"));
  fireEvent.click(await screen.findByRole("checkbox", { name: /I understand this replaces/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore integrated copy" }));
  expect(await screen.findByText("Finish or clear the logged contact edit before restoring a backup.")).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method === "backup_restore")).toBe(false);
});

it.each([false, true])("retains conflicting logged-contact text and offers only safe recovery (removed=%s)", async removed => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact), backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) }
    : method === "logbook_list" ? { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } } : backend(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.doubleClick(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "MYEDIT" } });
  if (removed) contactBackend.remove();
  else contactBackend.request("logbook_contact_apply", { operationID: "another-window", contactID: contact.id, expectedRevision: 1,
    action: "update", qso: { ...contact, call: "LATEST" } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  const recovery = await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("MYEDIT");
  expect(screen.getByRole("button", { name: "Update QSO" }).hasAttribute("disabled")).toBe(true);
  expect(within(recovery).getByRole("button", { name: "Copy my edits" })).toBeTruthy();
  if (removed) {
    expect(within(recovery).queryByRole("button", { name: "Load latest contact" })).toBeNull();
    fireEvent.click(within(recovery).getByRole("button", { name: "Cancel edit" }));
    await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
  } else {
    fireEvent.click(within(recovery).getByRole("button", { name: "Load latest contact" }));
    await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LATEST"));
  }
  expect(contactBackend.updates).toBe(removed ? 0 : 1);
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
