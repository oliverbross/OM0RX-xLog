// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedLogbookSurface, detachedContactJournalKey, detachedMutationJournalKey } from "../src/live/DetachedLogbookSurface";
import { contactEditFixture } from "./contact-edit-fixture";
const api = vi.hoisted(() => ({ request: vi.fn(), dock: vi.fn(), changes: new Set<() => void>(),
  blocked: undefined as (() => boolean) | undefined }));
vi.mock("../src/worker", () => ({ workerRequest: async (method: string, params: any) => ({ result: await api.request(method, params) }) }));
vi.mock("../src/live/logbookContactTransport", () => ({ requestLogbookContact: (method: string, params: any) => api.request(method, params) }));
vi.mock("../src/live/DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("../src/live/logbookWindows", () => ({
  connectLogbookChanges: (changed: () => void) => { api.changes.add(changed); return () => { api.changes.delete(changed); }; },
  protectLogbookClose: (blocked: () => boolean) => { api.blocked = blocked; return () => { api.blocked = undefined; }; },
}));
let backend: ReturnType<typeof contactEditFixture>;
beforeEach(() => {
  localStorage.clear(); api.request.mockReset(); api.dock.mockReset(); api.dock.mockResolvedValue(undefined);
  api.changes.clear(); api.blocked = undefined;
  backend = contactEditFixture({ id: "contact", call: "W1AW", start: "2026-10-13T01:00:00Z", band: "20m", mode: "SSB",
    frequencyHz: 14240000, rstSent: "59", rstReceived: "59", comment: "Original", extraFields: {} });
  api.request.mockImplementation(async (method, params) => {
    const result = backend.request(method, params); if (result) return result;
    if (method === "logbook_list") return { qsos: backend.contact?.qso.deletedAt ? [] : [backend.contact.qso], total: backend.contact?.qso.deletedAt ? 0 : 1, offset: 0, limit: 20 };
    if (method === "logbook_previous") return { qsos: [] };
    if (method === "lookup_call") return { call: params.call, source: "Fixture" };
    if (method === "logbook_matrix") return { cells: [] };
    throw new Error(`Unexpected method ${method}`);
  });
});
afterEach(cleanup);
async function openEditor() {
  fireEvent.click(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByRole("button", { name: "Update QSO" });
}
it("uses the shared editor with its own journal and no radio authority", async () => {
  localStorage.setItem("xlog.integration.contactEdit.main.v1", "main view's journal");
  render(<DetachedLogbookSurface />); await openEditor();
  expect(api.changes.size).toBe(2); // Outer contact owner and shared editor.
  expect(api.blocked?.()).toBe(true);
  expect(screen.queryByLabelText("Follow radio")).toBeNull();
  expect(screen.queryByRole("button", { name: "Read radio" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Detached edit" } });
  expect(JSON.parse(localStorage.getItem(detachedContactJournalKey)!).draft.comment).toBe("Detached edit");
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  await screen.findByText("Detached edit"); expect(backend.updates).toBe(1);
  expect(api.changes.size).toBe(1); // Editor cleanup retains the outer listener.
  expect(localStorage.getItem(detachedContactJournalKey)).toBeNull();
  expect(localStorage.getItem("xlog.integration.contactEdit.main.v1")).toBe("main view's journal");
  expect(api.request.mock.calls.some(([method]) => /station|rotor|hamlib|winkeyer|operator_draft|settings|sync/.test(method))).toBe(false);
  cleanup(); expect(api.changes.size).toBe(0);
});
it("retains a conflicting edit from another view without overwriting it", async () => {
  render(<DetachedLogbookSurface />); await openEditor();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "My unsaved text" } });
  const base = backend.contact;
  backend.request("logbook_contact_apply", { action: "update", operationID: "external", contactID: base.qso.id,
    expectedRevision: base.revision, generation: base.generation, qso: { ...base.qso, comment: "Other window" } });
  await act(async () => { for (const changed of [...api.changes]) changed(); });
  await screen.findByText("This logged contact changed elsewhere. Your unsaved text is retained.");
  expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe("My unsaved text");
  expect((screen.getByRole("button", { name: "Update QSO" }) as HTMLButtonElement).disabled).toBe(true);
  expect(backend.contact.qso.comment).toBe("Other window");
  fireEvent.click(screen.getByRole("button", { name: "Load latest contact" }));
  await waitFor(() => expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe("Other window"));
});
it("recovers a lost update acknowledgement after reopening without a second write", async () => {
  const implementation = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (method, params) => {
    const result = await implementation(method, params);
    if (method === "logbook_contact_apply") throw new Error("lost acknowledgement");
    return result;
  });
  render(<DetachedLogbookSurface />); await openEditor();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Already committed" } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  await screen.findByRole("button", { name: "Check contact update" });
  expect(api.blocked?.()).toBe(true); cleanup();
  render(<DetachedLogbookSurface />);
  await screen.findByText("Already committed"); expect(backend.updates).toBe(1);
  expect(localStorage.getItem(detachedContactJournalKey)).toBeNull();
});
it("deletes and restores with receipts, retains undo after remount, and docks when settled", async () => {
  render(<DetachedLogbookSurface />); fireEvent.click(await screen.findByText("W1AW"));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));
  await screen.findByText(/working logbook is empty/);
  expect(JSON.parse(localStorage.getItem(detachedMutationJournalKey)!).undo.qso.deletedAt).toBeTruthy();
  cleanup(); render(<DetachedLogbookSurface />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Undo delete" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
  await screen.findByText("W1AW");
  await waitFor(() => expect((screen.getByRole("button", { name: "Dock back" }) as HTMLButtonElement).disabled).toBe(false));
  api.dock.mockImplementation(async () => { expect(api.blocked?.()).toBe(false); });
  fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
  await waitFor(() => expect(api.dock).toHaveBeenCalledOnce()); expect(backend.updates).toBe(2);
});
