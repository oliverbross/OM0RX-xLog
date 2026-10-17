// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectWorkspaceLayout, requestWorkspaceLayout } from "./workspaceLayoutTransport";
import { LayoutRequestRejected } from "./workspaceLayoutSession";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); native.isTauri.mockReturnValue(true); });
afterEach(() => { vi.useRealTimers(); });

it("restricts operations and requires an exactly correlated response", async () => {
  native.invoke.mockImplementation(async (_command, { request }) => ({ id: request.id, ok: true, result: { layout: null } }));
  expect(await requestWorkspaceLayout("workspace_layout_load")).toEqual({ layout: null });
  await expect(requestWorkspaceLayout("station_tune" as any)).rejects.toThrow("outside");
  expect(native.invoke).toHaveBeenCalledOnce();
  native.invoke.mockResolvedValue({ id: "wrong", ok: true, result: {} });
  await expect(requestWorkspaceLayout("workspace_layout_apply")).rejects.toThrow("correlated");
});
it("distinguishes a verified rejection from an unknown transport outcome without retry", async () => {
  native.invoke.mockImplementation(async (_command, { request }) => ({ id: request.id, ok: false, error: { message: "invalid" } }));
  await expect(requestWorkspaceLayout("workspace_layout_apply")).rejects.toBeInstanceOf(LayoutRequestRejected);
  native.invoke.mockRejectedValue(new Error("IPC lost"));
  await expect(requestWorkspaceLayout("workspace_layout_apply")).rejects.toThrow("IPC lost");
  native.invoke.mockRejectedValue("native workspace unavailable");
  await expect(requestWorkspaceLayout("workspace_layout_load")).rejects.toThrow("native workspace unavailable");
  expect(native.invoke).toHaveBeenCalledTimes(3);
});
it("subscribes before initial read, coalesces wake events and disposes focus/timers", async () => {
  const stop = vi.fn(), changed = vi.fn(), failed = vi.fn(); let event!: () => void;
  native.listen.mockImplementation(async (_name, callback) => { event = callback; return stop; });
  const dispose = connectWorkspaceLayout(changed, failed);
  await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
  event(); event(); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(50);
  expect(changed).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  event(); dispose(); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(50);
  expect(changed).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
});
it("a late subscription resolution after teardown cannot start a read", async () => {
  let resolve!: (stop: () => void) => void;
  native.listen.mockReturnValue(new Promise(done => { resolve = done; }));
  const stop = vi.fn(), changed = vi.fn(), dispose = connectWorkspaceLayout(changed, vi.fn());
  dispose(); resolve(stop); await vi.advanceTimersByTimeAsync(100);
  expect(stop).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
});
it("reports a subscription failure and retains focus-read recovery", async () => {
  native.listen.mockRejectedValue(new Error("unavailable")); const changed = vi.fn(), failed = vi.fn();
  const dispose = connectWorkspaceLayout(changed, failed); await vi.advanceTimersByTimeAsync(100);
  expect(failed).toHaveBeenCalledOnce(); window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(50); expect(changed).toHaveBeenCalledOnce(); dispose();
});
