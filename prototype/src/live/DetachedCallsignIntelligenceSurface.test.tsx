// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CallsignIntelligenceSurface, requestDetachedIntelligence, detachedIntelligenceMethods } from "./DetachedCallsignIntelligenceSurface";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import { readFileSync } from "node:fs";
import { loadWindowSurface } from "../windowSurface";
const hooks = vi.hoisted(() => ({ draft: vi.fn(), history: vi.fn(), read: vi.fn(), draftRead: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: hooks.read }));
vi.mock("./operatorDraftTransport", () => ({ requestOperatorDraft: hooks.draftRead }));
vi.mock("./operatorDraftWindows", async original => ({ ...await original<typeof import("./operatorDraftWindows")>(), connectOperatorDraftChanges: hooks.draft }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: hooks.history }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: vi.fn() }));
let wakeDraft!: () => Promise<unknown>, wakeHistory!: () => void;
let current = { generation: testWorkspaceGeneration, revision: 0, qso: { id: "synthetic-draft", call: "TEST1", band: "20m", mode: "CW" } };
const profile = (call: string) => ({ call, dxcc: 504, country: "Synthetic country", name: "Example operator", source: "Synthetic CTY", gridSquare: "JN88AA" });
function reader() {
  return vi.fn(async (method: string, params: Record<string, any> = {}): Promise<any> => {
    if (method === "logbook_operator_draft") return { draft: structuredClone(current) };
    if (method === "lookup_call") return profile(params.call);
    if (method === "logbook_previous") return { qsos: [] };
    if (method === "logbook_matrix") return { cells: [{ band: "20m", worked: true, confirmed: false }] };
    if (method === "cluster_history") return { history: { call: params.call, adif: params.adif ?? null, previous_count: 0, previous: [], matrix: [], dxcc_contact_count: 3, dxcc_confirmed_count: 1 } };
    if (method === "workspace_preferences_load") return { preferences: { intelligenceBands: ["20m", "40m"] } };
    throw new Error(`Forbidden synthetic method ${method}`);
  });
}
beforeEach(() => {
  current = { generation: testWorkspaceGeneration, revision: 0, qso: { id: "synthetic-draft", call: "TEST1", band: "20m", mode: "CW" } };
  hooks.draft.mockImplementation((read: () => Promise<unknown>) => { wakeDraft = read; void read(); return vi.fn(); });
  hooks.history.mockImplementation((changed: () => void) => { wakeHistory = changed; return vi.fn(); });
  hooks.read.mockReset(); hooks.draftRead.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("follows the canonical draft without the main renderer or any editing/hardware method", async () => {
  const request = reader(); render(<CallsignIntelligenceSurface request={request} />);
  await screen.findByText("Example operator"); await screen.findByLabelText("Callsign 20m: Worked");
  expect(screen.queryByText("Following the saved new-QSO draft · read only")).toBeNull();
  expect(screen.queryByRole("button", { name: /Refresh|Dock back/ })).toBeNull();
  expect(screen.getByRole("main").firstElementChild?.classList.contains("detached-intelligence-content")).toBe(true);
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: /Log QSO|Read radio|Full editor/ })).toBeNull();
  await act(async () => { for (let index = 0; index < 4; index++) await wakeDraft(); });
  expect(request.mock.calls.filter(([method]) => method === "lookup_call")).toHaveLength(1);
  const before = request.mock.calls.filter(([method]) => method === "cluster_history").length;
  act(() => wakeHistory()); await waitFor(() => expect(request.mock.calls.filter(([method]) => method === "cluster_history").length).toBeGreaterThan(before));
  expect(request.mock.calls.filter(([method]) => method === "lookup_call")).toHaveLength(1);
  expect(request.mock.calls.every(([method]) => detachedIntelligenceMethods.includes(method as any))).toBe(true);
});

it("fences late lookup after the workspace changes with the same call", async () => {
  const request = reader(), original = request.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  request.mockImplementation((method, params) => method === "lookup_call" && request.mock.calls.filter(([name]) => name === "lookup_call").length === 1
    ? new Promise(done => { resolve = done; }) : original(method, params));
  render(<CallsignIntelligenceSurface request={request} />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  current = { ...current, generation: crypto.randomUUID() };
  await act(async () => { await wakeDraft(); }); await screen.findByText("Example operator");
  await act(async () => { resolve({ ...profile("TEST1"), name: "Stale previous workspace" }); });
  expect(screen.queryByText("Stale previous workspace")).toBeNull(); expect(screen.getByText("Example operator")).toBeTruthy();
  expect(request.mock.calls.filter(([method]) => method === "lookup_call")).toHaveLength(2);
});

it("fences late history after a workspace change even when callsign and DXCC match", async () => {
  const request = reader(), original = request.getMockImplementation()!;
  const stale: ((value: unknown) => void)[] = [];
  let hold = true;
  request.mockImplementation((method, params) => hold && ["logbook_matrix", "cluster_history"].includes(method)
    ? new Promise(done => { stale.push(done); }) : original(method, params));
  render(<CallsignIntelligenceSurface request={request} />);
  await screen.findByText("Example operator");
  await waitFor(() => expect(stale.length).toBeGreaterThanOrEqual(4));
  hold = false; current = { ...current, generation: crypto.randomUUID() };
  await act(async () => { await wakeDraft(); });
  await screen.findByLabelText("Callsign 20m: Worked");
  await act(async () => { for (const resolve of stale) resolve({ cells: [{ band: "20m", confirmed: true }],
    history: { call: "TEST1", adif: 504, matrix: [{ band: "20m", confirmed: true }], previous_count: 999, previous: [] } }); });
  expect(screen.getByLabelText("Callsign 20m: Worked")).toBeTruthy();
  expect(screen.queryByLabelText("Callsign 20m: Confirmed")).toBeNull();
  expect(screen.queryByText(/999 wkd/)).toBeNull();
});

it("hides prior identity when the draft becomes unavailable and retries without writes", async () => {
  const request = reader(); render(<CallsignIntelligenceSurface request={request} />); await screen.findByText("Example operator");
  request.mockRejectedValueOnce(new Error("Shared draft temporarily unavailable"));
  await act(async () => { await wakeDraft().catch(() => {}); });
  expect(screen.queryByText("Example operator")).toBeNull(); expect(screen.getByRole("alert").textContent).toContain("temporarily unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry intelligence" })); await screen.findByText("Example operator");
});

it("shows unavailable lookup/history rather than claiming unworked or a stale country", async () => {
  const request = reader(), original = request.getMockImplementation()!;
  request.mockImplementation((method, params) => ["lookup_call", "cluster_history", "logbook_matrix"].includes(method) ? Promise.reject(new Error("offline")) : original(method, params));
  render(<CallsignIntelligenceSurface request={request} />);
  await screen.findByText("Lookup unavailable"); await screen.findByText("Local history evidence is unavailable or incomplete.");
  expect(screen.getByLabelText("Callsign 20m: Unknown")).toBeTruthy(); expect(screen.getByLabelText("DXCC 20m: Unknown")).toBeTruthy();
  expect(screen.queryByText("Synthetic country")).toBeNull();
});

it("routes a direct menu window to the task surface with intrinsic height and narrow-window reflow", async () => {
  const Surface = await loadWindowSurface("?view=callsign-intelligence");
  expect(Surface.name).toBe("DetachedCallsignIntelligenceSurface");
  const css = readFileSync(`${process.cwd()}/src/live/DetachedCallsignIntelligenceSurface.css`, "utf8");
  expect(css).toMatch(/\.detached-intelligence-content\s*\{[^}]*container: detached-intelligence \/ inline-size;[^}]*flex: none;/);
  expect(css).toMatch(/\.detached-intelligence-content \.desk-intelligence\s*\{\s*min-height: 0;/);
  expect(css).toContain("@container detached-intelligence (max-width: 640px)");
  expect(css).toContain(".desk-matrices { grid-template-columns: 1fr; }");
});

it("has an independent frontend read allowlist as well as native enforcement", async () => {
  for (const method of ["logbook_operator_draft_apply", "logbook_operator_draft_receipt", "station_snapshot", "station_connect", "rotor_goto", "settings_load", "settings_save", "workspace_band_map_apply", "secret_status", "sync_run", "backup_create"])
    await expect(requestDetachedIntelligence(method)).rejects.toThrow("read only");
  expect(hooks.read).not.toHaveBeenCalled(); expect(hooks.draftRead).not.toHaveBeenCalled();
  hooks.draftRead.mockResolvedValue({ draft: current });
  expect(await requestDetachedIntelligence("logbook_operator_draft")).toEqual({ draft: current });
});
