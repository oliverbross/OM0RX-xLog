import { expect, it, vi } from "vitest";
import { connectWorkspaceNavigation, validWorkspaceNavigation, workspaceScreens, workspaceMenuScreens } from "./workspaceNavigation";
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  let wake = () => {};
  const stop = vi.fn(), navigate = vi.fn(), failed = vi.fn();
  const api = { read: vi.fn(async (): Promise<unknown> => null), ack: vi.fn(async (_revision: number) => {}),
    listen: vi.fn(async (handler: () => void): Promise<() => void> => { wake = handler; return stop; }) };
  return { api, stop, navigate, failed, wake: () => wake(), connect: () => connectWorkspaceNavigation(navigate, failed, api) };
}
it("has every existing destination and no unknown navigation or CW function-key shortcut", () => {
  expect(workspaceMenuScreens.some(screen => screen.id === "sync")).toBe(false);
  expect(workspaceMenuScreens.some(screen => screen.id === "settings")).toBe(true);
  expect(workspaceScreens.map(s => s.title)).toEqual(["Operator Desk", "Log QSO", "Logbook", "DX Cluster", "Spot History", "World Map", "Band Maps", "Chaser & DX", "Awards", "Station Control", "Sync", "Settings"]);
  for (const s of workspaceScreens) {
    expect(validWorkspaceNavigation({ revision: 1, screen: s.id })).toBe(true);
    if (s.shortcut) expect(s.shortcut).toMatch(/^CmdOrCtrl\+/);
  }
  for (const value of [null, {}, { revision: 0, screen: "logbook" }, { revision: 1, screen: "station_tune" }, { revision: Infinity, screen: "logbook" }])
    expect(validWorkspaceNavigation(value)).toBeFalsy();
});
it("subscribes before reading a menu click retained before the renderer started", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 1, screen: "logbook" });
  const disconnect = f.connect(); await tick();
  expect(f.api.listen.mock.invocationCallOrder[0]).toBeLessThan(f.api.read.mock.invocationCallOrder[0]);
  expect(f.navigate).toHaveBeenCalledWith("Logbook"); expect(f.api.ack).toHaveBeenCalledWith(1);
  disconnect(); expect(f.stop).toHaveBeenCalledOnce();
});
it("coalesces wake-ups while reading and then delivers the newest request", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.api.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  f.api.read.mockResolvedValue({ revision: 2, screen: "settings" });
  f.connect(); await tick(); f.wake(); f.wake();
  expect(f.api.read).toHaveBeenCalledOnce();
  resolve({ revision: 1, screen: "logbook" }); await tick();
  expect(f.navigate.mock.calls).toEqual([["Logbook"], ["Settings"]]); expect(f.api.read).toHaveBeenCalledTimes(2);
});
it("does not replay an old revision or navigate after unmount", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 2, screen: "logbook" });
  const disconnect = f.connect(); await tick();
  f.api.read.mockResolvedValue({ revision: 1, screen: "settings" }); f.wake(); await tick();
  expect(f.navigate).toHaveBeenCalledTimes(1);
  let resolve!: (value: unknown) => void;
  f.api.read.mockReturnValueOnce(new Promise(done => { resolve = done; })); f.wake(); disconnect();
  resolve({ revision: 3, screen: "settings" }); await tick(); expect(f.navigate).toHaveBeenCalledTimes(1);
});
it("retries a failed acknowledgement without replaying navigation", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 1, screen: "settings" });
  f.api.ack.mockRejectedValueOnce(new Error("IPC unavailable")); f.connect(); await tick(); f.wake(); await tick();
  expect(f.failed).toHaveBeenCalledWith("IPC unavailable"); expect(f.navigate).toHaveBeenCalledOnce(); expect(f.api.ack).toHaveBeenCalledTimes(2);
});
it("rejects invalid native data without acknowledging it", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 1, screen: "unknown" }); f.connect(); await tick();
  expect(f.failed).toHaveBeenCalledOnce(); expect(f.navigate).not.toHaveBeenCalled(); expect(f.api.ack).not.toHaveBeenCalled();
});
it("disposes a subscription which finishes after unmount", async () => {
  const f = fixture(); let finish!: (stop: () => void) => void;
  f.api.listen.mockReturnValue(new Promise(done => { finish = done; })); const disconnect = f.connect(); disconnect();
  finish(f.stop); await tick(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.api.read).not.toHaveBeenCalled();
});
