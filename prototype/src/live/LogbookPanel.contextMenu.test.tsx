// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogbookPanel } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";

const first = { id: "first-contact", call: "OM0RX", start: "2026-11-02T00:00:00Z", band: "20m", mode: "CW" };
const second = { ...first, id: "second-contact", call: "VK8AA", start: "2026-11-01T00:00:00Z" };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const backend = contactEditFixture(second);
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => backend.request(method, params) ?? {
    qsos: backend.contact.qso.deletedAt ? [first] : [first, second], total: backend.contact.qso.deletedAt ? 1 : 2, offset: 0, limit: 20,
  });
  const onEdit = vi.fn(), mutations = new LogbookMutationSession(request, () => {});
  const props = { columnContext: "desk" as const, onRequest: request, onEdit, mutations, refreshKey: 0 };
  return { ...render(<LogbookPanel {...props} />), props, request, onEdit, mutations, backend };
}
async function openMenu() {
  const call = await screen.findByText(second.call);
  fireEvent.contextMenu(call.closest("td")!, { clientX: 200, clientY: 100 });
  return screen.findByRole("menu", { name: `Contact actions for ${second.call}` });
}

it("reviews the right-clicked contact, confirms a revision-scoped delete, refreshes and offers Undo on the Desk", async () => {
  const { request, onEdit, backend } = setup();
  const menu = await openMenu();
  expect(onEdit).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete contact…" }));
  const review = await screen.findByRole("group", { name: `Delete ${second.call}` });
  expect(request).toHaveBeenCalledWith("logbook_contact", { contactID: second.id });
  expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(within(review).getByRole("button", { name: "Cancel" })));
  fireEvent.click(within(review).getByRole("button", { name: "Confirm delete" }));
  await screen.findByText("1–1 of 1");
  expect(screen.queryByText(second.call)).toBeNull();
  expect(screen.getByText(first.call)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
  await screen.findByText(second.call);
  expect(backend.contact.qso.deletedAt).toBeNull();
  expect(request.mock.calls.filter(([method]) => method === "logbook_contact_apply").map(([, params]) => params)).toMatchObject([
    { contactID: second.id, action: "delete", expectedRevision: 1 },
    { contactID: second.id, action: "restore", expectedRevision: 2 },
  ]);
});

it("cancels menu and confirmation without changing the contact or opening Edit", async () => {
  const { request, onEdit } = setup();
  fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Cancel" }));
  expect(screen.queryByRole("menu")).toBeNull();
  const row = screen.getByText(second.call).closest("tr")!;
  expect(document.activeElement).toBe(row);
  fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Delete contact…" }));
  fireEvent.click(within(await screen.findByRole("group", { name: `Delete ${second.call}` })).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
  expect(document.activeElement).toBe(row);
  expect(onEdit).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
});

it("supports the context-menu keyboard gesture, arrow navigation and dismissal, while ordinary editing still works", async () => {
  const { onEdit } = setup();
  const call = await screen.findByText(second.call), row = call.closest("tr")!;
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  const menu = await screen.findByRole("menu"), remove = within(menu).getByRole("menuitem", { name: "Delete contact…" });
  expect(document.activeElement).toBe(remove);
  fireEvent.keyDown(remove, { key: "ArrowDown" });
  expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Cancel" }));
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row);
  await userEvent.setup().dblClick(call);
  expect(onEdit).toHaveBeenCalledWith(second);
});

it("dismisses an open menu when the page refreshes or the operator clicks outside it", async () => {
  const { rerender, props, request } = setup();
  await openMenu();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Columns" }));
  expect(screen.queryByRole("menu")).toBeNull();
  await openMenu();
  rerender(<LogbookPanel {...props} refreshKey={1} />);
  expect(screen.queryByRole("menu")).toBeNull();
  await waitFor(() => expect(screen.getByRole("region", { name: /Logbook contacts/ }).getAttribute("aria-busy")).toBe("false"));
  expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
});

it.each(["disabled", "busy", "pending", "conflict", "workspaceChanged"])("does not open a delete menu when %s", async blocker => {
  const { rerender, props, mutations, request } = setup();
  const call = await screen.findByText(second.call);
  if (blocker === "disabled") rerender(<LogbookPanel {...props} disabled />);
  else {
    // Exercise live owner admission even before React renders a changed snapshot.
    const snapshot = mutations.getSnapshot();
    vi.spyOn(mutations, "getSnapshot").mockReturnValue({ ...snapshot,
      [blocker]: blocker === "pending" ? { operationID: "pending" } : true } as any);
  }
  fireEvent.contextMenu(call.closest("td")!);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "logbook_contact")).toBe(false);
});

it("closes an already open menu when another mutation or workspace guard becomes active", async () => {
  const { mutations } = setup();
  await openMenu();
  await act(async () => { await mutations.prepareDelete(second.id); });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps the reviewed revision when a remote edit occurs before confirmation", async () => {
  const { backend, mutations } = setup();
  fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Delete contact…" }));
  const confirm = await screen.findByRole("button", { name: "Confirm delete" });
  backend.request("logbook_contact_apply", { contactID: second.id, expectedRevision: 1, generation: backend.contact.generation,
    operationID: "remote-edit", action: "update", qso: { ...second, comment: "New remote edit" } });
  fireEvent.click(confirm);
  await waitFor(() => expect(mutations.getSnapshot().conflict).toBe(true));
  expect(backend.contact.qso.deletedAt).toBeUndefined();
  expect(backend.contact.qso.comment).toBe("New remote edit");
});
