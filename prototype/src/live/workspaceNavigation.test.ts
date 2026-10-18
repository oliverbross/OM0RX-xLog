import { expect, it, vi } from "vitest";
import { connectWorkspaceNavigation, validWorkspaceNavigation, workspaceScreens, workspaceMenuScreens, workspaceMenuScreensFor } from "./workspaceNavigation";
import { OperatorDraftSession } from "./operatorDraftSession";
import { SpotActivationEditor } from "./spotActivation";
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
  expect(workspaceMenuScreens.some(screen => screen.id === "station-control")).toBe(false);
  expect(workspaceMenuScreens.some(screen => screen.id === "radio1-settings" || screen.id === "radio2-settings")).toBe(false);
  expect(workspaceScreens.map(s => s.title)).toEqual(["Operator Desk", "Log QSO", "Logbook", "DX Cluster", "Spot History", "World Map", "Band Maps", "Chaser & DX", "HF Prop live", "Awards", "Station Control", "Radio 1 Settings", "Radio 2 Settings", "Sync", "Wavelog Settings", "QRZ Settings", "Online Log Settings", "Reference Data Settings", "Settings", "Contest Manager / Desk"]);
  expect(workspaceMenuScreensFor({ contesting: false }).some(screen => screen.id === "contesting")).toBe(false);
  expect(workspaceMenuScreensFor({ contesting: true }).filter(screen => screen.id === "contesting")).toHaveLength(1);
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
it("delivers the retained native workspace mode command and awaits persistence before acknowledgement", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 1, screen: "workspace-mode-windows" });
  let finish!: () => void;
  f.navigate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  f.connect(); await tick();
  expect(f.navigate).toHaveBeenCalledWith("Workspace Mode: Separate Windows"); expect(f.api.ack).not.toHaveBeenCalled();
  finish(); await tick(); expect(f.api.ack).toHaveBeenCalledWith(1);
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

it("retains Dock's native route until the recreated editor has actually registered", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 9, screen: "spot-history" });
  const snapshot = { generation: "10000000-0000-4000-8000-000000000001", revision: 0, qso: { id: "draft", call: "" } };
  const session = new OperatorDraftSession(async () => ({ draft: structuredClone(snapshot) }), vi.fn(), null, undefined, true);
  await session.load();
  const editor = new SpotActivationEditor([session], async () => ({ draft: snapshot }));
  let route = "Operator Desk", release!: () => void;
  const navigate = vi.fn((title: string) => {
    if (!session.canAcceptLocalInput()) return false;
    route = title; return true;
  });
  const disconnect = connectWorkspaceNavigation(navigate, f.failed, f.api, retry => session.subscribe(retry));
  const registration = new Promise<void>(resolve => { release = resolve; }).then(() =>
    editor.registeredWith({ phase: "idle", operationId: null, barrier: null }));
  await tick();
  expect(route).toBe("Operator Desk"); expect(f.api.ack).not.toHaveBeenCalled();
  expect(session.canAcceptLocalInput()).toBe(false);
  release(); await registration; await tick();
  expect(route).toBe("Spot History"); expect(f.api.ack).toHaveBeenCalledExactlyOnceWith(9);
  expect(navigate.mock.calls).toEqual([["Spot History"], ["Spot History"]]);
  expect(f.failed).not.toHaveBeenCalled(); disconnect();
});

it("never acknowledges a guarded route and retries only the newest retained intent on readiness", async () => {
  const f = fixture(); f.api.read.mockResolvedValue({ revision: 1, screen: "spot-history" });
  let blocked = true, retry!: () => void;
  const navigate = vi.fn((_title: string) => !blocked), stopReadiness = vi.fn();
  const disconnect = connectWorkspaceNavigation(navigate, f.failed, f.api, notify => { retry = notify; return stopReadiness; });
  await tick(); expect(f.api.ack).not.toHaveBeenCalled();
  retry(); await tick(); expect(f.api.ack).not.toHaveBeenCalled();
  f.api.read.mockResolvedValue({ revision: 2, screen: "settings" }); blocked = false;
  retry(); await tick();
  expect(navigate).toHaveBeenLastCalledWith("Settings"); expect(f.api.ack).toHaveBeenCalledExactlyOnceWith(2);
  const reads = f.api.read.mock.calls.length; retry(); await tick(); expect(f.api.read).toHaveBeenCalledTimes(reads);
  disconnect(); expect(stopReadiness).toHaveBeenCalledOnce(); retry(); await tick();
  expect(f.api.read).toHaveBeenCalledTimes(reads);
});
