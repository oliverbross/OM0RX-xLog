// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PreviousQSOsSurface, DetachedPreviousQSOsSurface, requestDetachedPreviousQSOs } from "./DetachedPreviousQSOsSurface";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import { loadWindowSurface } from "../windowSurface";
const hooks = vi.hoisted(() => ({ draft: vi.fn(), history: vi.fn(), read: vi.fn(), draftRead: vi.fn(), stopDraft: vi.fn(), stopHistory: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: hooks.read }));
vi.mock("./operatorDraftTransport", () => ({ requestOperatorDraft: hooks.draftRead }));
vi.mock("./operatorDraftWindows", async original => ({ ...await original<typeof import("./operatorDraftWindows")>(), connectOperatorDraftChanges: hooks.draft }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: hooks.history }));
let wakeDraft!: () => Promise<unknown>, wakeHistory!: () => void;
let current = { generation: testWorkspaceGeneration, revision: 0, qso: { id: "synthetic-draft", call: "TEST1", band: "20m", mode: "CW" } };
const history = (call: string, grid = "JN88AA") => ({ history: { call, previous_count: 24, previous_confirmed_count: 3,
  previous: [{ id: "synthetic-contact", call, date: "2026-10-01T12:00:00Z", band: "20m", mode: "CW", rstSent: "599", rstReceived: "579", grid, confirmed: true }] } });
const reader = () => vi.fn(async (method: string, params: Record<string, any> = {}): Promise<any> => {
  if (method === "logbook_operator_draft") return { draft: structuredClone(current) };
  if (method === "cluster_history") return history(params.call);
  throw new Error(`Forbidden method ${method}`);
});
beforeEach(() => {
  vi.clearAllMocks();
  current = { generation: testWorkspaceGeneration, revision: 0, qso: { id: "synthetic-draft", call: "TEST1", band: "20m", mode: "CW" } };
  hooks.draft.mockImplementation((read: () => Promise<unknown>) => { wakeDraft = read; void read(); return hooks.stopDraft; });
  hooks.history.mockImplementation((changed: () => void) => { wakeHistory = changed; return hooks.stopHistory; });
});
afterEach(cleanup);

it("loads the named independent route and follows canonical local history without custom window chrome", async () => {
  expect(await loadWindowSurface("?view=previous-qsos")).toBe(DetachedPreviousQSOsSurface);
  const request = reader(); const view = render(<PreviousQSOsSurface request={request} />);
  await screen.findByText("JN88AA");
  expect(screen.getByText("24 worked · 3 confirmed")).toBeTruthy();
  expect(screen.getByText("Showing the latest 1 of 24 contacts.")).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  act(() => wakeHistory());
  await waitFor(() => expect(request.mock.calls.filter(([method]) => method === "cluster_history")).toHaveLength(2));
  view.unmount(); expect(hooks.stopDraft).toHaveBeenCalledOnce(); expect(hooks.stopHistory).toHaveBeenCalledOnce();
  expect(request.mock.calls.every(([method]) => ["logbook_operator_draft", "cluster_history"].includes(method))).toBe(true);
});

it("fences an old workspace history response even when the callsign stays the same", async () => {
  const request = reader(), original = request.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  request.mockImplementation((method, params) => method === "cluster_history" && request.mock.calls.filter(([name]) => name === "cluster_history").length === 1
    ? new Promise(done => { resolve = done; }) : original(method, params));
  render(<PreviousQSOsSurface request={request} />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  current = { ...current, generation: "22345678-1234-1234-1234-123456789abc" };
  await act(async () => { await wakeDraft(); }); await screen.findByText("JN88AA");
  await act(async () => { resolve(history("TEST1", "OLDOLD")); });
  expect(screen.queryByText("OLDOLD")).toBeNull(); expect(screen.getByText("JN88AA")).toBeTruthy();
});

it("clears old rows on callsign change, blank draft, and mismatched history", async () => {
  const request = reader(); render(<PreviousQSOsSurface request={request} />); await screen.findByText("JN88AA");
  current = { ...current, revision: 1, qso: { ...current.qso, call: "TEST2" } };
  request.mockImplementation(async method => method === "logbook_operator_draft" ? { draft: structuredClone(current) } : history("TEST1"));
  await act(async () => { await wakeDraft(); }); await screen.findByRole("alert");
  expect(screen.queryByText("JN88AA")).toBeNull();
  current = { ...current, revision: 2, qso: { ...current.qso, call: "" } };
  await act(async () => { await wakeDraft(); });
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Previous contacts follow the callsign in Log QSO.")).toBeTruthy();
});

it("allows only canonical draft and local history reads at the transport boundary", async () => {
  hooks.draftRead.mockResolvedValue({ draft: current }); hooks.read.mockResolvedValue({ result: history("TEST1") });
  await requestDetachedPreviousQSOs("logbook_operator_draft"); await requestDetachedPreviousQSOs("cluster_history", { call: "TEST1" });
  for (const method of ["settings_load", "logbook_operator_draft_apply", "cluster_start", "station_tune", "logbook_list"])
    await expect(requestDetachedPreviousQSOs(method)).rejects.toThrow("can only read");
  expect(hooks.read).toHaveBeenCalledOnce(); expect(hooks.draftRead).toHaveBeenCalledOnce();
});
