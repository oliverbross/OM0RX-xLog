// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LogbookPanel } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";
import type { LogbookColumnContext } from "./logbookColumnPreferences";

const contact = { id: "compact-contact", call: "OM0RX", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function setup(columnContext?: LogbookColumnContext, detached = false) {
  const request = vi.fn(async () => ({ qsos: [contact], total: 1, offset: 0, limit: 20 }));
  const onEdit = vi.fn();
  render(<LogbookPanel columnContext={columnContext} onRequest={request} onEdit={onEdit} refreshKey={0}
    mutations={new LogbookMutationSession(request, () => {})}
    onUndock={detached ? undefined : vi.fn()} onDock={detached ? vi.fn() : undefined} />);
  return { onEdit };
}

it("uses the explicit Desk context for a table with only Columns and pagination controls", async () => {
  const { onEdit } = setup("desk");
  await screen.findByText(contact.call);
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Logbook" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Search logbook" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Export selection" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Columns", "Previous", "Next"]);

  const columns = screen.getByRole("button", { name: "Columns" });
  fireEvent.click(columns);
  expect(columns.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("region", { name: "Logbook columns" }).id).toBe(columns.getAttribute("aria-controls"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Country column" }));
  expect(screen.queryByRole("columnheader", { name: "Country" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(document.activeElement).toBe(columns);
  expect(columns.getAttribute("aria-expanded")).toBe("false");

  fireEvent.keyDown(screen.getByText(contact.call).closest("tr")!, { key: "Enter" });
  expect(onEdit).toHaveBeenCalledWith(contact);
});

it.each([
  { context: undefined, detached: false, label: "dedicated" },
  { context: "docked" as const, detached: false, label: "canvas docked" },
  { context: undefined, detached: true, label: "independent detached" },
])("retains the full controls in the $label view at the same viewport size", async ({ context, detached }) => {
  setup(context, detached);
  await screen.findByText(contact.call);
  expect(screen.getByRole("heading", { name: "Logbook" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Search logbook" })).toBeTruthy();
  for (const name of ["Columns", "Edit", "Details", "Delete", "Undo delete", "Import ADIF", "Export all", "Export filtered", "Export selected", "Select page", "Clear selection"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
  expect(screen.getByRole("combobox", { name: "Import encoding" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Export format" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Export selection" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /for export/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: detached ? "Dock back" : "Undock" })).toBeTruthy();
});
