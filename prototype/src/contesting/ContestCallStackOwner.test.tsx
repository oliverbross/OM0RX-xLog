// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestCallStackOwner, type ContestCallStackOwnerProps } from "./ContestCallStackOwner";
import { callStackStorageKey, emptyCallStack, type CallStackClassification } from "./contestCallStack";

afterEach(() => { cleanup(); localStorage.clear(); });
function props(): ContestCallStackOwnerProps {
  return { draft: { sessionID: "practice", workspaceGeneration: "disposable", draftID: "one", revision: 1,
    fields: { callsign: "", sent: "599", receive: "", other_1: "7", other_2: "" },
    defaults: { callsign: "", sent: "599", receive: "", other_1: "7", other_2: "" }, heardFieldIDs: ["other_2"] }, disabled: false,
  mutate: vi.fn(async () => { throw new Error("not expected"); }), receipt: vi.fn(async () => null),
  classify: vi.fn(async () => []), onError: vi.fn() };
}
function add(call: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Add heard call to stack" }), { target: { value: call } });
  fireEvent.click(screen.getByRole("button", { name: "Add caller" }));
}
it("persists the session-scoped queue and restores it after unmount with stable IDs", async () => {
  const p = props(), view = render(<ContestCallStackOwner {...p}/>); add("K1ONE");
  expect(screen.getByRole("button", { name: "K1ONE" })).toBeTruthy();
  const stored = localStorage.getItem(callStackStorageKey(p.draft)); expect(stored).toContain("K1ONE");
  view.unmount(); render(<ContestCallStackOwner {...p}/>);
  expect(screen.getByRole("button", { name: "K1ONE" })).toBeTruthy(); expect(localStorage.getItem(callStackStorageKey(p.draft))).toBe(stored);
});
it("keeps malformed storage intact and reports recovery failure without sending a request", async () => {
  const p = props(), key = callStackStorageKey(p.draft); localStorage.setItem(key, "corrupt-keep-me");
  render(<ContestCallStackOwner {...p}/>);
  expect(screen.getByRole("alert").textContent).toContain("preserved");
  expect(localStorage.getItem(key)).toBe("corrupt-keep-me"); expect(p.mutate).not.toHaveBeenCalled();
  await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.stringContaining("unreadable")));
});
it("uses current callbacks/draft after rerender and fences stale duplicate authority replies", async () => {
  const p = props(); let oldResolve!: (values: CallStackClassification[]) => void;
  p.classify = vi.fn((_items, _draft, _scope) => new Promise<CallStackClassification[]>(resolve => { oldResolve = resolve; }));
  const view = render(<ContestCallStackOwner {...p}/>); add("K1ONE");
  await waitFor(() => expect(p.classify).toHaveBeenCalled());
  const first = (p.classify as ReturnType<typeof vi.fn>).mock.calls[0], item = first[0][0];
  const next = { ...p, draft: { ...p.draft, revision: 2 }, classify: vi.fn(async () => []) };
  view.rerender(<ContestCallStackOwner {...next}/>);
  oldResolve([{ itemID: item.id, itemRevision: item.revision, scope: first[2], state: "duplicate", reason: "stale 20m" }]);
  await waitFor(() => expect(next.classify).toHaveBeenCalled());
  expect(screen.queryByText(/stale 20m/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load next" }));
  await waitFor(() => expect(p.mutate).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ revision: 2 }) })));
});
it("keeps another workspace queue separate when the existing owner changes sessions", () => {
  const p = props(), other = { ...p.draft, sessionID: "another" };
  localStorage.setItem(callStackStorageKey(other), JSON.stringify({ ...emptyCallStack(other), selectedID: "saved", items: [
    { id: "saved", revision: 0, callsign: "W2OTHER", fragments: {} } ] }));
  const view = render(<ContestCallStackOwner {...p}/>); add("K1ONE");
  view.rerender(<ContestCallStackOwner {...p} draft={other}/>);
  expect(screen.getByRole("button", { name: "W2OTHER" })).toBeTruthy(); expect(screen.queryByRole("button", { name: "K1ONE" })).toBeNull();
  expect(localStorage.getItem(callStackStorageKey(p.draft))).toContain("K1ONE");
});
it("reads synchronous owner refs between durable commit and load before React republishes the draft", async () => {
  const p = props(); p.draft.fields.callsign = "W1CURRENT"; let current = structuredClone(p.draft);
  p.getDraft = () => current;
  p.mutate = vi.fn(async operation => {
    if (operation.kind === "commit") current = { ...current, draftID: "next", revision: current.revision + 1,
      fields: { ...current.defaults, other_1: "8" }, defaults: { ...current.defaults, other_1: "8" } };
    else current = { ...current, revision: current.revision + 1, fields: { ...operation.fields } };
    return { operationID: operation.operationID, draft: structuredClone(current), ...(operation.kind === "commit" ? { qsoID: "saved-contact" } : {}) };
  });
  render(<ContestCallStackOwner {...p}/>); add("K1NEXT");
  fireEvent.click(screen.getByRole("button", { name: "Log and load next" }));
  await waitFor(() => expect(p.mutate).toHaveBeenCalledTimes(2));
  expect(current.fields.callsign).toBe("K1NEXT"); expect(current.fields.other_1).toBe("8");
  expect(p.onError).not.toHaveBeenCalled();
});
