// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogbookLayoutAcceptance, workspaceDraftMarker } from "./logbookLayoutAcceptance";
import { DetachedLogbookSurface, detachedContactJournalKey } from "./live/DetachedLogbookSurface";
import { contactEditFixture } from "../tests/contact-edit-fixture";
import { loadWindowSurface } from "./windowSurface";

const api = vi.hoisted(() => ({ worker: vi.fn(), contacts: vi.fn(), changes: vi.fn(), protect: vi.fn(), dock: vi.fn() }));
// The production acceptance poll has a 20-second bounded deadline. Keep the
// test watchdog slightly longer so failures retain the useful poll label.
const acceptanceTestTimeout = 25_000;
vi.mock("./worker", () => ({ workerRequest: api.worker }));
vi.mock("./live/logbookContactTransport", () => ({ requestLogbookContact: api.contacts }));
vi.mock("./live/logbookWindows", () => ({ connectLogbookChanges: api.changes, protectLogbookClose: api.protect }));
vi.mock("./live/DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("./live/useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: () => ({
  status: null, error: "", reconcile: vi.fn(),
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

it("opens a direct-menu Logbook with only a compact task toolbar above the table", async () => {
  await setup();
  const toolbar = document.querySelector<HTMLElement>(".live-logbook-task-toolbar")!;
  expect(toolbar).not.toBeNull();
  expect(within(toolbar).getByRole("textbox", { name: "Search logbook" })).toBeTruthy();
  expect(within(toolbar).getAllByRole("button").map(button => button.getAttribute("aria-label") || button.textContent?.trim())).toEqual([
    "Search", "Edit", "Details", "Columns", "Delete", "Undo delete", "Select page", "Clear selection",
  ]);
  expect(screen.queryByRole("heading", { name: "Logbook" })).toBeNull();
  expect(screen.queryByText(/Local working copy|Selection clears/)).toBeNull();
  for (const name of ["Import ADIF", "Export all", "Export filtered", "Export selected", "Dock back"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Import encoding" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Export format" })).toBeNull();
  expect(document.querySelector(".live-logbook-export-selection")).toBeNull();
  expect(toolbar.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const css = readFileSync(`${process.cwd()}/src/live/logbook.css`, "utf8");
  expect(css).toMatch(/\.live-logbook-head\.live-logbook-task-toolbar > \.live-logbook-actions\s*\{[^}]*justify-content: flex-start;[^}]*flex-wrap: wrap;/);
  expect(css).toMatch(/\.live-logbook-task-toolbar \.live-logbook-search\s*\{[^}]*flex: 1 1 120px;[^}]*min-width: 120px;/);
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /for export/ }).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /for export/ }).checked).toBe(false);
}, acceptanceTestTimeout);

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
}, acceptanceTestTimeout);

it("retries a row open that lands before the table accepts contact edits", async () => {
  const context = await setup();
  const row = screen.getByRole("row", { name: /W1AW/ });
  const open = row.click.bind(row);
  let attempts = 0;
  vi.spyOn(row, "click").mockImplementation(() => { attempts += 1; if (attempts > 1) open(); });
  await context.action("editor_prepare");
  expect(attempts).toBeGreaterThan(1);
  expect(screen.getByLabelText<HTMLInputElement>("Comment").value).toBe(workspaceDraftMarker);
}, acceptanceTestTimeout);

it("rejects missing or changed draft evidence and never clicks Update QSO", async () => {
  const context = await setup();
  await expect(context.action("editor_probe")).rejects.toThrow("not retained");
  await context.action("editor_prepare");
  await act(async () => { fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Different text" } }); });
  await expect(context.action("editor_probe")).rejects.toThrow("not retained");
  await expect(context.action("editor_cancel")).rejects.toThrow("not retained");
  expect(context.backend.updates).toBe(0);
  expect(context.click).not.toHaveBeenCalled();
}, acceptanceTestTimeout);

it("rejects existing editors, already stored markers, and unknown actions", async () => {
  const context = await setup(workspaceDraftMarker);
  await expect(context.action("unknown")).rejects.toThrow("Unknown detached");
  await expect(context.action("editor_prepare")).rejects.toThrow("already contains");
  await expect(context.action("editor_prepare")).rejects.toThrow("existing detached");
  expect(context.fill).not.toHaveBeenCalled(); expect(context.backend.updates).toBe(0);
}, acceptanceTestTimeout);
