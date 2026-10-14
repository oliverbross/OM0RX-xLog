// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedAlertsSurface } from "./DetachedAlertsSurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let wake: () => void;
const frame = () => ({ epoch: "00000000-0000-4000-8000-000000000001", revision: 1, radio_report: true, rotor_report: true,
  items: [{ code: "radio_inhibitors", count: 2 }, { code: "rotor_uncertain", count: 1 }] });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  native.listen.mockImplementation(async (_name, callback) => { wake = callback; return native.stop; });
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("mounts with one retained native read and no timer, worker, hardware or acknowledgement", async () => {
  const { unmount } = render(<DetachedAlertsSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(native.invoke.mock.calls).toEqual([["alerts_snapshot"]]); expect(native.listen).toHaveBeenCalledWith("xlog:alerts", expect.any(Function));
  expect(screen.getByRole("status").textContent).toContain("not a live all-clear");
  expect(screen.getByText("Radio safety inhibitors reported (2)")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("heading", { name: "Alerts" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull(); unmount(); expect(native.stop).toHaveBeenCalledOnce();
});
it("never turns absent reports or a failed read into all-clear", async () => {
  native.invoke.mockResolvedValue({ ...frame(), radio_report: false, rotor_report: false, items: [] });
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/This is not an all-clear/)).toBeTruthy();
  native.invoke.mockRejectedValue(Error("unavailable"));
  await act(async () => { wake(); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("Reports unavailable or changing");
});
it("keeps coverage and report presence with compact retained-data status", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toBe("Retained data · not a live all-clear");
  expect(screen.getAllByText("Retained report present")).toHaveLength(2);
  expect(screen.getByText("Coverage: Agent safety inhibitors, alarms and rotor uncertainty.")).toBeTruthy();
  expect(native.invoke.mock.calls).toEqual([["alerts_snapshot"]]);
});
