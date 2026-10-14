// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedAntennaSurface } from "./DetachedAntennaSurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let wake: () => void;
const frame = () => ({ epoch: "00000000-0000-4000-8000-000000000001", revision: 1, available: true, snapshot: {
  worker_generation: 3, workspace_generation: "00000000-0000-4000-8000-000000000002", settings_revision: 7,
  display: "antenna", antenna: "dipole", name: "Garden", bands: ["20m", "40m"],
} });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  native.listen.mockImplementation(async (_name, callback) => { wake = callback; return native.stop; });
  native.invoke.mockImplementation(async command => command === "antenna_snapshot" ? frame() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("reuses Desk antenna rendering with one retained native read and no timer or control", async () => {
  const { unmount } = render(<DetachedAntennaSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(native.invoke.mock.calls).toEqual([["antenna_snapshot"]]); expect(screen.getByText("Garden")).toBeTruthy();
  expect(screen.getByText("Configured · no telemetry")).toBeTruthy(); expect(screen.getByRole("status").textContent).toContain("Verified saved profile");
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Show Desk", "Dock back", "Close Antenna"]);
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("combobox")).toBeNull(); unmount(); expect(native.stop).toHaveBeenCalledOnce();
});
it("does not infer a fixed antenna from missing, automatic or hidden saved settings", async () => {
  for (const display of [null, "automatic", "hidden"]) {
    const value = frame(); native.invoke.mockResolvedValue(display === null ? { ...value, available: false, snapshot: null } : { ...value, snapshot: { ...value.snapshot, display } });
    const { unmount } = render(<DetachedAntennaSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByLabelText("Configured antenna")).toBeNull(); expect(screen.queryByText("Garden")).toBeNull(); unmount();
  }
});
it("invalidates saved profile availability while retaining a clearly marked reference", async () => {
  render(<DetachedAntennaSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  native.invoke.mockResolvedValue({ ...frame(), revision: 2, available: false });
  await act(async () => { wake(); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("retained reference only"); expect(screen.getByText("Garden")).toBeTruthy();
});
it("uses fixed Desk/Dock/Close routes and leaves failed transitions open", async () => {
  render(<DetachedAntennaSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  native.invoke.mockImplementation(async command => { if (command !== "show_antenna_desk") throw Error("Window unavailable"); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show Desk" })); }); expect(native.invoke).toHaveBeenCalledWith("show_antenna_desk");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dock back" })); }); expect(screen.getByRole("alert").textContent).toContain("Antenna remains open");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close Antenna" })); }); expect(native.invoke).toHaveBeenCalledWith("close_antenna_window");
});
