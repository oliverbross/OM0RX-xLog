// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetachedLogbookSurface } from "./DetachedLogbookSurface";
import { contactEditFixture } from "../../tests/contact-edit-fixture";

const api = vi.hoisted(() => ({ read: vi.fn(), contact: vi.fn(), protect: vi.fn(), stop: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: api.read }));
vi.mock("./logbookContactTransport", () => ({ requestLogbookContact: api.contact }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: () => api.stop, protectLogbookClose: api.protect }));
vi.mock("./useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: () => ({}) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it("opens at the logbook task toolbar without window navigation and retains native close protection", async () => {
  api.read.mockResolvedValue({ result: { qsos: [], total: 0, offset: 0, limit: 20 } });
  api.protect.mockReturnValue(() => {});
  const view = render(<DetachedLogbookSurface />);
  expect(await screen.findByRole("button", { name: /^Search$/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Show Desk|Dock back|Close window/ })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Logbook" })).toBeNull();
  expect(api.protect).toHaveBeenCalledOnce();
  await waitFor(() => expect(api.protect.mock.calls[0][0]()).toBe(false));
  expect(api.contact).not.toHaveBeenCalled();
  view.unmount(); expect(api.stop).toHaveBeenCalledOnce();
});

const qso = { id: "qso-1", call: "OM0RX", start: "2026-10-12T10:20:30Z", band: "20m", mode: "CW", frequencyHz: 14025000,
  extraFields: { APP_CUSTOM: "unchanged", SAT_NAME: "QO-100" }, wavelogID: 42, isDirty: false };
async function setupContact() {
  const backend = contactEditFixture(qso);
  api.contact.mockImplementation(async (method, params) => backend.request(method, params));
  api.read.mockImplementation(async method => ({ result: method === "logbook_list" ? {
    qsos: backend.contact.qso.deletedAt ? [] : [backend.contact.qso], total: backend.contact.qso.deletedAt ? 0 : 1, offset: 0, limit: 20,
  } : {} }));
  api.protect.mockReturnValue(() => {});
  render(<DetachedLogbookSurface />);
  await screen.findByText("OM0RX");
  await waitFor(() => expect(api.protect.mock.calls[0][0]()).toBe(false));
  return backend;
}

it("opens on one row click, leaves checkbox selection separate, and saves arbitrary ADIF edits through the canonical contact revision", async () => {
  const backend = await setupContact();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Select OM0RX/ }));
  expect(api.contact).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("OM0RX"));
  await screen.findByRole("button", { name: "Update QSO" });
  fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
  fireEvent.change(screen.getByLabelText("ADIF SAT_NAME"), { target: { value: "AO-100" } });
  fireEvent.change(screen.getByLabelText("New ADIF field name"), { target: { value: "app_rare_field" } });
  fireEvent.click(screen.getByRole("button", { name: "Add ADIF field" }));
  fireEvent.change(screen.getByLabelText("ADIF APP_RARE_FIELD"), { target: { value: "  exact\nvalue  " } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  await screen.findByRole("button", { name: /^Search$/ });
  expect(backend.contact.qso).toMatchObject({ wavelogID: 42, extraFields: { APP_CUSTOM: "unchanged", SAT_NAME: "AO-100", APP_RARE_FIELD: "  exact\nvalue  " } });
  expect(api.contact.mock.calls.find(([method]) => method === "logbook_contact_apply")?.[1]).toMatchObject({ action: "update", expectedRevision: 1, generation: backend.contact.generation });
});

it("deletes the opened revision with confirmation and preserves table Undo delete", async () => {
  const backend = await setupContact();
  fireEvent.click(await screen.findByText("OM0RX"));
  fireEvent.click(await screen.findByRole("button", { name: "Delete QSO" }));
  expect(backend.updates).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await screen.findByRole("button", { name: /^Search$/ });
  expect(backend.contact.qso.deletedAt).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
  await screen.findByText("OM0RX");
  expect(backend.contact.qso.deletedAt).toBeNull();
  expect(backend.contact.qso.extraFields).toEqual(qso.extraFields);
  expect(api.contact.mock.calls.filter(([method]) => method === "logbook_contact_apply").map(([, params]) => params.action)).toEqual(["delete", "restore"]);
});

it.each(["revision", "workspace"])("refuses editor Delete after the %s changes without deleting the replacement", async change => {
  const backend = await setupContact();
  fireEvent.click(await screen.findByText("OM0RX"));
  fireEvent.click(await screen.findByRole("button", { name: "Delete QSO" }));
  if (change === "workspace") backend.replaceWorkspace();
  else backend.request("logbook_contact_apply", { operationID: "other-window", contactID: qso.id, generation: backend.contact.generation,
    expectedRevision: 1, action: "update", qso: { ...qso, name: "Changed elsewhere" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(api.contact.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(true));
  await act(async () => {});
  expect(backend.contact.qso.deletedAt).toBeUndefined();
  expect(screen.getByLabelText("Callsign")).toBeTruthy();
  expect(api.contact.mock.calls.find(([method]) => method === "logbook_contact_apply")?.[1]?.expectedRevision).toBe(1);
});

it("reconciles a lost Delete acknowledgement before closing the editor and keeps Undo", async () => {
  const backend = await setupContact();
  api.contact.mockImplementation(async (method, params) => {
    const response = backend.request(method, params);
    if (method === "logbook_contact_apply" && params.action === "delete") throw new Error("Reply lost");
    return response;
  });
  fireEvent.click(screen.getByText("OM0RX"));
  fireEvent.click(await screen.findByRole("button", { name: "Delete QSO" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  const check = await screen.findByRole("button", { name: "Check logbook operation" });
  await waitFor(() => expect(check.hasAttribute("disabled")).toBe(false));
  expect(screen.getByLabelText("Callsign")).toBeTruthy();
  expect(backend.updates).toBe(1);
  fireEvent.click(check);
  await screen.findByRole("button", { name: /^Search$/ });
  expect(screen.getByRole("button", { name: "Undo delete" }).hasAttribute("disabled")).toBe(false);
  expect(api.contact.mock.calls.filter(([method]) => method === "logbook_contact_apply")).toHaveLength(1);
});
