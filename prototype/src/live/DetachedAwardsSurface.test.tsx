// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { DetachedAwardsSurface } from "./DetachedAwardsSurface";
import { openDetachedAwards } from "./logbookWindows";
import { loadWindowSurface } from "../windowSurface";
const api = vi.hoisted(() => ({ worker: vi.fn(), changes: vi.fn(), dock: vi.fn(), invoke: vi.fn(), desktop: true }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./logbookWindows", async original => ({ ...await original<typeof import("./logbookWindows")>(), connectLogbookChanges: api.changes }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); api.desktop = true; });
it("owns read-only totals/catalogue requests and refresh without mounting the main desk", async () => {
  api.dock.mockResolvedValue(undefined);
  let refresh!: () => void;
  const stop = vi.fn(); api.changes.mockImplementation(callback => { refresh = callback; return stop; });
  api.worker.mockImplementation(async (method: string) => ({ result: method === "logbook_stats" ? { awards: { qso_count: 1 } } :
    { total_programmes: 0, catalogue_total: 192, programmes: [], items: [] } }));
  const Surface = await loadWindowSurface("?view=awards");
  const view = render(<Surface />);
  await screen.findByText("192");
  expect(screen.getByRole("main", { name: "Detached Awards" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Station intelligence" })).toBeNull();
  expect(screen.queryByText("Local award estimates and operating patterns.")).toBeNull();
  expect(screen.queryByText("LOCAL LOG · NOT AN AWARD APPLICATION")).toBeNull();
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(document.querySelector(".awards-page-head")).toBeNull();
  expect([...new Set(api.worker.mock.calls.map(([method]) => method))].sort()).toEqual(["logbook_catalog", "logbook_stats"]);
  refresh();
  await waitFor(() => expect(api.worker.mock.calls.filter(([method]) => method === "logbook_stats")).toHaveLength(2));
  expect(api.dock).not.toHaveBeenCalled();
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});
it("shows worker errors without a mutation or silent fallback", async () => {
  api.changes.mockReturnValue(() => {}); api.worker.mockRejectedValue(new Error("offline"));
  api.dock.mockRejectedValue(new Error("missing main")); render(<DetachedAwardsSurface />);
  await screen.findByText(/Awards library is unavailable/);
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(api.worker.mock.calls.every(([method]) => ["logbook_catalog", "logbook_stats"].includes(method))).toBe(true);
});
it("clears settled data on a same-revision restore wake before replacement reads finish", async () => {
  vi.useFakeTimers();
  const previous = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", current = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let restored = false, refresh!: () => void;
  const pending = new Map<string, (value: unknown) => void>();
  api.changes.mockImplementation(callback => { refresh = callback; return () => {}; });
  api.worker.mockImplementation(async (method: string, params: Record<string, unknown> = {}) => {
    if (restored && params.expected_generation === previous) {
      throw Object.assign(new Error("workspace retired"), { code: "logbook_refresh_retired" });
    }
    if (restored) return new Promise(resolve => { pending.set(method, resolve); });
    return { result: { workspace_generation: previous, logbook_revision: 42,
      ...(method === "logbook_stats" ? { awards: { qso_count: 1 } } : { total_programmes: 0, catalogue_total: 192, programmes: [], items: [] }) } };
  });
  await act(async () => { render(<DetachedAwardsSurface />); });
  expect(screen.getByText("192")).toBeTruthy();
  restored = true;
  await act(async () => { refresh(); });
  expect(screen.queryByText("192")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(pending.size).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(pending.size).toBe(2);
  const retryCalls = api.worker.mock.calls.slice(-2);
  expect(retryCalls.every(([, params]) => !params?.expected_generation)).toBe(true);
  await act(async () => {
    pending.get("logbook_stats")!({ result: { workspace_generation: current, logbook_revision: 42, awards: { qso_count: 2 } } });
    pending.get("logbook_catalog")!({ result: { workspace_generation: current, logbook_revision: 42,
      total_programmes: 0, catalogue_total: 193, programmes: [], items: [] } });
  });
  expect(screen.getByText("193")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => { refresh(); });
  expect(api.worker.mock.calls.slice(-2).every(([, params]) => params?.expected_generation === current)).toBe(true);
});
it("opens a singleton native route and does not pretend to undock in a browser", async () => {
  await openDetachedAwards(); expect(api.invoke).toHaveBeenCalledWith("open_detached_map", { kind: "awards" });
  api.desktop = false; await expect(openDetachedAwards()).rejects.toThrow("desktop application");
  expect(api.invoke).toHaveBeenCalledOnce();
});
