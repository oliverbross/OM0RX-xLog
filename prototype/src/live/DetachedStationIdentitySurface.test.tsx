// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("OM0RX/P")).toBeTruthy(); expect(screen.getByText("JN88TQ")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("heading", { name: "Station Identity" })).toBeNull();
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
  expect(screen.getByText("K1ABC")).toBeTruthy(); expect(screen.queryByRole("status")).toBeNull();
});
it("starts with saved identity and preserves revision and generation data", async () => {
  render(<DetachedStationIdentitySurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByLabelText("Saved station identity").firstElementChild?.className).toBe("live-station-readback");
  expect(screen.getByText("Saved settings revision").nextElementSibling?.textContent).toBe("7");
  expect(screen.getByText("Workspace generation").nextElementSibling?.textContent).toBe(frame().snapshot.workspace_generation);
  expect(native.invoke.mock.calls).toEqual([["station_identity_snapshot"]]);
});
