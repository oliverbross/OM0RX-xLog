// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContestCallStackPanel, type ContestCallStackPanelProps } from "./ContestCallStackPanel";
import { emptyCallStack } from "./contestCallStack";

afterEach(cleanup);
function props(): ContestCallStackPanelProps {
  const scope = { sessionID: "practice", workspaceGeneration: "disposable" };
  return { state: { ...emptyCallStack(scope), selectedID: "one", items: [
    { id: "one", revision: 0, callsign: "K1ONE", fragments: {} },
    { id: "partial", revision: 0, callsign: "DL?AB", fragments: {} } ] },
  occupied: true, currentCallsign: "W1CURRENT", classificationScope: "20m/log4", classifications: [],
  onAdd: vi.fn(), onSelect: vi.fn(), onPromote: vi.fn(), onRemove: vi.fn(), onLoad: vi.fn(),
  onLogNext: vi.fn(), onRecover: vi.fn(), onKeepQueue: vi.fn() };
}
it("makes occupied-entry replacement explicit for every load and keeps On Deck optional", () => {
  const p = props(); render(<ContestCallStackPanel {...p}/>);
  const load = screen.getByRole("button", { name: "Load selected" }) as HTMLButtonElement;
  expect(load.disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Occupied entry decision" }), { target: { value: "swap" } });
  fireEvent.click(load); expect(p.onLoad).toHaveBeenCalledWith("one", "swap"); expect(load.disabled).toBe(true);
  expect(screen.getByLabelText("On Deck").textContent).toContain("K1ONE");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show On Deck" })); expect(screen.queryByLabelText("On Deck")).toBeNull();
});
it("adds heard partials, labels them as assistance and disables logging a partial entry", () => {
  const p = props(); render(<ContestCallStackPanel {...p} currentCallsign="W1?"/>);
  fireEvent.change(screen.getByRole("textbox", { name: "Add heard call to stack" }), { target: { value: "w?x" } });
  fireEvent.click(screen.getByRole("button", { name: "Add caller" })); expect(p.onAdd).toHaveBeenCalledWith("W?X");
  expect(screen.getByText("Partial · assistance only")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Log and load next" }) as HTMLButtonElement).disabled).toBe(true);
});
it("shows retained duplicates and drops old classification after a band/log scope change", () => {
  const p = props(); p.classifications = [{ itemID: "one", itemRevision: 0, scope: "20m/log4", state: "duplicate", reason: "Worked on 20m" }];
  const view = render(<ContestCallStackPanel {...p}/>);
  expect(screen.getByText("Duplicate · retained: Worked on 20m")).toBeTruthy();
  view.rerender(<ContestCallStackPanel {...p} classificationScope="40m/log4"/>);
  expect(screen.queryByText(/Duplicate · retained/)).toBeNull(); expect(screen.getByText("Duplicate status pending")).toBeTruthy();
});
it("offers the original receipt recovery while locking queue edits", () => {
  const p = props(); p.state.pending = { phase: "commit", operation: { kind: "commit", operationID: "original", fields: {},
    draft: { sessionID: "practice", workspaceGeneration: "disposable", revision: 1, draftID: "draft", fields: {}, defaults: {}, heardFieldIDs: [] } },
    transition: { item: p.state.items[0], decision: "discard" } };
  render(<ContestCallStackPanel {...p}/>);
  expect((screen.getByRole("button", { name: "Remove K1ONE" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check original receipt" })); expect(p.onRecover).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Retry original operation" })); expect(p.onRecover).toHaveBeenCalledWith(true);
  expect(p.onLogNext).not.toHaveBeenCalled();
});
