// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedAlertsSurface } from "./DetachedAlertsSurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const wakes: Record<string, () => void> = {};
const frame = () => ({ epoch: "00000000-0000-4000-8000-000000000001", revision: 1, radio_report: true, rotor_report: true,
  items: [{ code: "radio_inhibitors", count: 2 }, { code: "rotor_uncertain", count: 1 }] });
const dxFrame = () => ({ epoch: "00000000-0000-4000-8000-000000000002", revision: 1,
  configuration: { generation:"00000000-0000-4000-8000-000000000003", revision:0, enabled:false, dedupSeconds:120, retentionMinutes:120, nativePopup:false, notificationSound:false,
    rules:[{ id:"new-dxcc", name:"New DXCC", enabled:true, callsignGlob:"*", bands:[], modes:[], callStatuses:[], dxccStatuses:["ATNO"], specials:[] }] },
  storageError:null, source:{ available:true, baselined:true, revision:2, receivedAtMs:1 }, entries:[], delivery:{ error:null, suppressed:0, maximumPerWindow:3, windowSeconds:10 }, limits:{ maximumRules:32, maximumEntries:200 } });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  for (const key of Object.keys(wakes)) delete wakes[key];
  native.listen.mockImplementation(async (name, callback) => { wakes[name] = callback; return native.stop; });
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : command === "dx_alerts_snapshot" || command === "dx_alerts_save" ? dxFrame() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("mounts with one retained native read and no timer, worker, hardware or acknowledgement", async () => {
  const { unmount } = render(<DetachedAlertsSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(native.invoke.mock.calls).toEqual(expect.arrayContaining([["alerts_snapshot"],["dx_alerts_snapshot"]])); expect(native.listen).toHaveBeenCalledWith("xlog:alerts", expect.any(Function));
  expect(screen.getByRole("status").textContent).toContain("not a live all-clear");
  expect(screen.getByText("Radio safety inhibitors reported (2)")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "DX opportunity alerts" })).toBeTruthy();
  expect(screen.getByText(/passive only/)).toBeTruthy(); unmount(); expect(native.stop).toHaveBeenCalledTimes(2);
});
it("never turns absent reports or a failed read into all-clear", async () => {
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? { ...frame(), radio_report:false, rotor_report:false, items:[] } : dxFrame());
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/This is not an all-clear/)).toBeTruthy();
  native.invoke.mockRejectedValue(Error("unavailable"));
  await act(async () => { wakes["xlog:alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("Reports unavailable or changing");
});
it("keeps coverage and report presence with compact retained-data status", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toBe("Retained data · not a live all-clear");
  expect(screen.getAllByText("Retained report present")).toHaveLength(2);
  expect(screen.getByText("Coverage: Agent safety inhibitors, alarms and rotor uncertainty.")).toBeTruthy();
  expect(native.invoke.mock.calls).toEqual(expect.arrayContaining([["alerts_snapshot"],["dx_alerts_snapshot"]]));
});
it("keeps native delivery opt in and saves popup and sound choices without an action", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const popup = screen.getByLabelText("Native popup") as HTMLInputElement, sound = screen.getByLabelText("Notification sound") as HTMLInputElement;
  expect(popup.checked).toBe(false); expect(sound.disabled).toBe(true);
  fireEvent.click(popup); expect(sound.disabled).toBe(false); fireEvent.click(sound);
  fireEvent.click(screen.getByRole("button", { name:"Save rules" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_save", expect.objectContaining({ configuration:expect.objectContaining({ nativePopup:true, notificationSound:true }) }));
  expect(screen.getByText(/cannot tune or transmit/)).toBeTruthy();
});
