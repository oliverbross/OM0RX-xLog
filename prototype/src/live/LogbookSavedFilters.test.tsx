// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LogbookSavedFilters } from "./LogbookSavedFilters";

afterEach(cleanup);

function backend(initial = [{ name: "Worked", query: "OM0RX" }]) {
  let filters = structuredClone(initial), revision = 3;
  const request = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "workspace_preferences_load") return { preferences: { savedLogbookFilters: filters }, revision, generation: "generation-1" };
    if (method !== "workspace_logbook_filters_apply") throw new Error("unexpected method");
    if (JSON.stringify(params.expected) !== JSON.stringify(filters))
      return { status: "conflict", preferences: { savedLogbookFilters: filters }, revision, generation: "generation-1" };
    if (params.action === "clone") {
      const source = filters.find(filter => filter.name === params.source)!;
      filters = [...filters, { name: params.name, query: source.query }].sort((a, b) => a.name.localeCompare(b.name));
    } else if (params.action === "save") filters = [...filters, { name: params.name, query: params.query }].sort((a, b) => a.name.localeCompare(b.name));
    else if (params.action === "rename") filters = filters.map(filter => filter.name === params.source ? { ...filter, name: params.name } : filter).sort((a, b) => a.name.localeCompare(b.name));
    else if (params.action === "delete") filters = filters.filter(filter => filter.name !== params.source);
    revision++;
    return { status: "applied", preferences: { savedLogbookFilters: filters }, revision, generation: "generation-1" };
  });
  return request;
}

it("applies a saved filter through the existing search query callback", async () => {
  const request = backend(), apply = vi.fn();
  render(<LogbookSavedFilters onRequest={request} currentQuery="" onApply={apply} />);
  const select = await screen.findByRole("combobox", { name: "Saved Logbook filter" });
  fireEvent.change(select, { target: { value: "Worked" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledWith("OM0RX");
  expect(request.mock.calls.filter(([method]) => method === "workspace_logbook_filters_apply")).toHaveLength(0);
});

it("clones a named filter and persists the clone through the scoped mutation route", async () => {
  const request = backend();
  render(<LogbookSavedFilters onRequest={request} currentQuery="new query" onApply={vi.fn()} />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Saved Logbook filter" }), { target: { value: "Worked" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Saved filter name" }), { target: { value: "Worked copy" } });
  fireEvent.click(screen.getByRole("button", { name: "Clone" }));
  await screen.findByText("Filter cloned.");
  expect(request).toHaveBeenLastCalledWith("workspace_logbook_filters_apply", expect.objectContaining({
    action: "clone", source: "Worked", name: "Worked copy", expected: [{ name: "Worked", query: "OM0RX" }],
  }));
  expect(screen.getByRole("option", { name: "Worked copy" })).toBeTruthy();
});

it("rejects invalid and duplicate names before persistence", async () => {
  const request = backend();
  render(<LogbookSavedFilters onRequest={request} currentQuery="Pacific" onApply={vi.fn()} />);
  await screen.findByRole("combobox", { name: "Saved Logbook filter" });
  const name = screen.getByRole("textbox", { name: "Saved filter name" });
  fireEvent.change(name, { target: { value: " worked " } });
  fireEvent.click(screen.getByRole("button", { name: "Save current" }));
  expect(await screen.findByText(/without leading, trailing or control whitespace/)).toBeTruthy();
  fireEvent.change(name, { target: { value: "worked" } });
  fireEvent.click(screen.getByRole("button", { name: "Save current" }));
  expect(await screen.findByText("A filter with that name already exists.")).toBeTruthy();
  await waitFor(() => expect(request.mock.calls.filter(([method]) => method === "workspace_logbook_filters_apply")).toHaveLength(0));
});
