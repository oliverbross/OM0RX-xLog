// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { DetachedAwardsSurface } from "./DetachedAwardsSurface";
import { openDetachedAwards } from "./logbookWindows";
import { loadWindowSurface } from "../windowSurface";
const api = vi.hoisted(() => ({ worker: vi.fn(), changes: vi.fn(), dock: vi.fn(), invoke: vi.fn(), desktop: true }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./logbookWindows", async original => ({ ...await original<typeof import("./logbookWindows")>(), connectLogbookChanges: api.changes }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
afterEach(() => { cleanup(); vi.resetAllMocks(); api.desktop = true; });
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
it("opens a singleton native route and does not pretend to undock in a browser", async () => {
  await openDetachedAwards(); expect(api.invoke).toHaveBeenCalledWith("open_detached_map", { kind: "awards" });
  api.desktop = false; await expect(openDetachedAwards()).rejects.toThrow("desktop application");
  expect(api.invoke).toHaveBeenCalledOnce();
});
