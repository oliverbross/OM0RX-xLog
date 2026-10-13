// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedAwardsSurface, openDetachedAwards } from "./DetachedAwardsSurface";
const api = vi.hoisted(() => ({ worker: vi.fn(), changes: vi.fn(), dock: vi.fn(), invoke: vi.fn(), desktop: true }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: api.changes }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
afterEach(() => { cleanup(); vi.resetAllMocks(); api.desktop = true; });
it("owns read-only totals/catalogue requests and refresh without mounting the main desk", async () => {
  api.dock.mockResolvedValue(undefined);
  let refresh!: () => void;
  const stop = vi.fn(); api.changes.mockImplementation(callback => { refresh = callback; return stop; });
  api.worker.mockImplementation(async (method: string) => ({ result: method === "logbook_stats" ? { awards: { qso_count: 1 } } :
    { total_programmes: 0, catalogue_total: 192, programmes: [], items: [] } }));
  const view = render(<DetachedAwardsSurface />);
  await screen.findByText("192");
  expect(screen.getByRole("main", { name: "Detached Awards" })).toBeTruthy();
  expect([...new Set(api.worker.mock.calls.map(([method]) => method))].sort()).toEqual(["logbook_catalog", "logbook_stats"]);
  refresh();
  await waitFor(() => expect(api.worker.mock.calls.filter(([method]) => method === "logbook_stats")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
  await waitFor(() => expect(api.dock).toHaveBeenCalledOnce());
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});
it("shows worker and docking errors without a mutation or silent fallback", async () => {
  api.changes.mockReturnValue(() => {}); api.worker.mockRejectedValue(new Error("offline"));
  api.dock.mockRejectedValue(new Error("missing main")); render(<DetachedAwardsSurface />);
  await screen.findByText(/Awards library is unavailable/);
  fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
  await screen.findByText(/Could not dock Awards/);
  expect(api.worker.mock.calls.every(([method]) => ["logbook_catalog", "logbook_stats"].includes(method))).toBe(true);
});
it("opens a singleton native route and does not pretend to undock in a browser", async () => {
  await openDetachedAwards(); expect(api.invoke).toHaveBeenCalledWith("open_detached_map", { kind: "awards" });
  api.desktop = false; await expect(openDetachedAwards()).rejects.toThrow("desktop application");
  expect(api.invoke).toHaveBeenCalledOnce();
});
