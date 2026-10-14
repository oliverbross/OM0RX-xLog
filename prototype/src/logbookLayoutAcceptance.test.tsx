// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogbookLayoutAcceptance, workspaceDraftMarker } from "./logbookLayoutAcceptance";
import { DetachedLogbookSurface, detachedContactJournalKey } from "./live/DetachedLogbookSurface";
import { contactEditFixture } from "../tests/contact-edit-fixture";
import { loadWindowSurface } from "./windowSurface";

const api = vi.hoisted(() => ({ worker: vi.fn(), contacts: vi.fn(), changes: vi.fn(), protect: vi.fn(), dock: vi.fn() }));
vi.mock("./worker", () => ({ workerRequest: api.worker }));
vi.mock("./live/logbookContactTransport", () => ({ requestLogbookContact: api.contacts }));
vi.mock("./live/logbookWindows", () => ({ connectLogbookChanges: api.changes, protectLogbookClose: api.protect }));
vi.mock("./live/DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("./live/useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: () => ({
  status: { phase: "uncertain", tuneConfirmed: false, rotor: "uncertain" }, error: "Global activation warning", reconcile: vi.fn(),
}) }));
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  api.changes.mockReturnValue(() => {}); api.protect.mockReturnValue(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

async function setup(originalComment = "Original stored comment") {
  const qso = { id: "contact-1", call: "W1AW", band: "20m", mode: "CW", start: "2026-10-13T01:00:00Z", comment: originalComment };
  const backend = contactEditFixture(qso);
  api.contacts.mockImplementation(async (method, params = {}) => backend.request(method, params));
  api.worker.mockImplementation(async (method: string) => ({ result: method === "logbook_list"
    ? { qsos: [structuredClone(qso)], total: 1, offset: 0, limit: 20 }
    : method === "logbook_matrix" ? { cells: [] }
    : method === "logbook_previous" ? { qsos: [] } : {} }));
  const Surface = await loadWindowSurface("?view=logbook");
  const view = render(<Surface />);
  await screen.findByText("W1AW");
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
  expect(screen.queryByText(/Global activation warning|Check activation|Draft saved locally/)).toBeNull();
  expect(document.querySelector(".station-rail")).toBeNull();
  const fill = vi.fn(async (selector: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing acceptance field: ${selector}`);
    await act(async () => { fireEvent.change(input, { target: { value } }); });
  });
  const click = vi.fn(async (name: string, selector = "button") => {
    let button: HTMLButtonElement | undefined;
    await waitFor(() => {
      button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent?.trim() === name);
      expect(button && !button.disabled).toBe(true);
    });
    await act(async () => { fireEvent.click(button!); });
  });
  return { backend, view, fill, click, action: createLogbookLayoutAcceptance({ fill, click }) };
}

it("prepares, probes while hidden, and cancels a real unsaved detached contact edit without backend writes", async () => {
  const context = await setup();
  const prepared = await context.action("editor_prepare");
  expect(prepared).toEqual({ originalComment: "Original stored comment", draftComment: workspaceDraftMarker, dirty: true });
  expect(screen.getByLabelText<HTMLInputElement>("Comment").value).toBe(workspaceDraftMarker);
  expect(JSON.parse(localStorage.getItem(detachedContactJournalKey)!).draft.comment).toBe(workspaceDraftMarker);
  const root = document.querySelector<HTMLElement>(".detached-logbook-app")!;
  root.hidden = true;
  const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => { throw new Error("Hidden webviews must not wait for frames"); });
  expect(await context.action("editor_probe")).toEqual(prepared);
  expect(frame).not.toHaveBeenCalled(); root.hidden = false;
  expect(await context.action("editor_cancel")).toEqual({ cancelled: true });
  expect(screen.queryByLabelText("Comment")).toBeNull();
  expect(localStorage.getItem(detachedContactJournalKey)).toBeNull();
  expect(context.backend.updates).toBe(0);
  expect(api.contacts.mock.calls.every(([method]) => method === "logbook_contact")).toBe(true);
  expect(api.worker.mock.calls.every(([method]) => ["logbook_list", "logbook_matrix", "lookup_call", "logbook_previous"].includes(method))).toBe(true);
  expect(api.dock).not.toHaveBeenCalled();
});

it("rejects missing or changed draft evidence and never clicks Update QSO", async () => {
  const context = await setup();
  await expect(context.action("editor_probe")).rejects.toThrow("not retained");
  await context.action("editor_prepare");
  await act(async () => { fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Different text" } }); });
  await expect(context.action("editor_probe")).rejects.toThrow("not retained");
  await expect(context.action("editor_cancel")).rejects.toThrow("not retained");
  expect(context.backend.updates).toBe(0);
  expect(context.click.mock.calls.map(([name]) => name)).toEqual(["Edit"]);
});

it("rejects existing editors, already stored markers, and unknown actions", async () => {
  const context = await setup(workspaceDraftMarker);
  await expect(context.action("unknown")).rejects.toThrow("Unknown detached");
  await expect(context.action("editor_prepare")).rejects.toThrow("already contains");
  await expect(context.action("editor_prepare")).rejects.toThrow("existing detached");
  expect(context.fill).not.toHaveBeenCalled(); expect(context.backend.updates).toBe(0);
});
