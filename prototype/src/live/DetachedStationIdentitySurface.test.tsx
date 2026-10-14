// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedStationIdentitySurface } from "./DetachedStationIdentitySurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let wake: () => void;
const frame = (revision = 1, available = true) => ({ epoch: "00000000-0000-4000-8000-000000000001", revision, available, snapshot: {
  worker_generation: 3, workspace_generation: "00000000-0000-4000-8000-000000000002", settings_revision: 7,
  operator_call: "OM0RX", station_call: "OM0RX/P", grid: "JN88TQ", location: "Example QTH", logbook_mode: "local",
} });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  native.listen.mockImplementation(async (_name, callback) => { wake = callback; return native.stop; });
  native.invoke.mockImplementation(async command => command === "station_identity_snapshot" ? frame() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("mounts through the retained projection only, with no Settings/defaults/device call or timer", async () => {
  const { unmount } = render(<DetachedStationIdentitySurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["station_identity_snapshot"]]);
  expect(screen.getByRole("status").textContent).toBe("Verified saved identity");
  expect(screen.getByText("OM0RX/P")).toBeTruthy(); expect(screen.getByText("JN88TQ")).toBeTruthy();
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Show Desk", "Dock back", "Close Identity"]);
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(native.invoke).toHaveBeenCalledOnce();
  unmount(); expect(native.stop).toHaveBeenCalledOnce();
});
it("does not fabricate station defaults before the canonical owner has been observed", async () => {
  native.invoke.mockResolvedValue({ ...frame(), available: false, snapshot: null });
  render(<DetachedStationIdentitySurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("No saved identity has been observed");
  expect(screen.queryByText("OM0RX/P")).toBeNull(); expect(screen.queryByText("OM0RX")).toBeNull();
});
it("invalidates on native changes, retains the old identity honestly and accepts a new saved generation", async () => {
  render(<DetachedStationIdentitySurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  native.invoke.mockResolvedValue(frame(2, false));
  await act(async () => { wake(); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("retained values only"); expect(screen.getByText("OM0RX/P")).toBeTruthy();
  const next = frame(3); next.snapshot.station_call = "K1ABC"; next.snapshot.settings_revision = 0;
  next.snapshot.workspace_generation = crypto.randomUUID(); native.invoke.mockResolvedValue(next);
  await act(async () => { wake(); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText("K1ABC")).toBeTruthy(); expect(screen.getByRole("status").textContent).toBe("Verified saved identity");
});
it("uses fixed lifecycle routes and keeps failed Close/Dock transitions open", async () => {
  render(<DetachedStationIdentitySurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async command => {
    if (["dock_detached_window", "close_station_identity_window"].includes(command)) throw new Error("Window unavailable");
    return original(command);
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show Desk" })); });
  expect(native.invoke).toHaveBeenCalledWith("show_station_identity_desk");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dock back" })); });
  expect(screen.getByRole("alert").textContent).toContain("Station Identity remains open");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close Identity" })); });
  expect(native.invoke).toHaveBeenCalledWith("close_station_identity_window");
  expect(native.invoke.mock.calls.every(call => ["station_identity_snapshot", "show_station_identity_desk", "dock_detached_window", "close_station_identity_window"].includes(call[0]))).toBe(true);
});
