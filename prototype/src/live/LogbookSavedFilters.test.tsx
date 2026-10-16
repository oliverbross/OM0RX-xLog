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
    else if (params.action === "update") filters = filters.map(filter => filter.name === params.source ? { ...filter, query: params.query } : filter);
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

it("updates only the selected stored query without applying it or using the edited name", async () => {
  const request = backend([{ name: "Worked", query: "OM0RX" }, { name: "Other", query: "SOTA" }]), apply = vi.fn();
  render(<LogbookSavedFilters onRequest={request} currentQuery=" Pacific " onApply={apply} />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Saved Logbook filter" }), { target: { value: "Worked" } });
  expect(screen.getByText("OM0RX")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Saved filter name" }), { target: { value: "Different name" } });
  fireEvent.click(screen.getByRole("button", { name: "Update selected" }));
  await screen.findByText("Filter updated.");
  expect(request).toHaveBeenLastCalledWith("workspace_logbook_filters_apply", {
    action: "update", source: "Worked", query: "Pacific", generation: "generation-1",
    expected: [{ name: "Worked", query: "OM0RX" }, { name: "Other", query: "SOTA" }],
  });
  expect(screen.getByText("Pacific")).toBeTruthy();
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("Worked");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Worked");
  expect(screen.getByRole("option", { name: "Other" })).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  expect(request.mock.calls.map(([method]) => method)).toEqual(["workspace_preferences_load", "workspace_logbook_filters_apply"]);
  expect((screen.getByRole("button", { name: "Update selected" }) as HTMLButtonElement).disabled).toBe(true);
});

it("disables update for missing selection, empty, invalid or unchanged searches and external disablement", async () => {
  const request = backend(), apply = vi.fn();
  const { rerender } = render(<LogbookSavedFilters onRequest={request} currentQuery="Pacific" onApply={apply} />);
  const select = await screen.findByRole("combobox", { name: "Saved Logbook filter" });
  const update = screen.getByRole("button", { name: "Update selected" }) as HTMLButtonElement;
  expect(update.disabled).toBe(true);
  fireEvent.change(select, { target: { value: "Worked" } });
  for (const currentQuery of ["", "   ", " OM0RX ", "line\nbreak", "x".repeat(129)]) {
    rerender(<LogbookSavedFilters onRequest={request} currentQuery={currentQuery} onApply={apply} />);
    expect(update.disabled).toBe(true);
    fireEvent.click(update);
  }
  rerender(<LogbookSavedFilters onRequest={request} currentQuery="Pacific" onApply={apply} disabled />);
  expect(update.disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
});

it.each(["conflict", "workspace_changed"])("refreshes %s evidence without retrying or applying the update", async status => {
  const initial = [{ name: "Worked", query: "OM0RX" }], apply = vi.fn();
  const request = vi.fn(async (method: string) => method === "workspace_preferences_load"
    ? { preferences: { savedLogbookFilters: initial }, revision: 3, generation: "generation-1" }
    : { status, preferences: { savedLogbookFilters: [{ name: "Worked", query: "Refreshed" }] }, revision: 4, generation: "generation-2" });
  render(<LogbookSavedFilters onRequest={request} currentQuery="Pacific" onApply={apply} />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Saved Logbook filter" }), { target: { value: "Worked" } });
  fireEvent.click(screen.getByRole("button", { name: "Update selected" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Refreshed")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Update selected" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request).toHaveBeenLastCalledWith("workspace_logbook_filters_apply", expect.objectContaining({
    generation: "generation-2", expected: [{ name: "Worked", query: "Refreshed" }],
  }));
});
