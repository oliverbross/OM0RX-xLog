// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAutoRotor, type AutomaticRotorState } from "./useAutoRotor";
const bridge = vi.hoisted(() => ({ call: vi.fn(), events: new Map<string, () => void>(), stops: [] as Array<ReturnType<typeof vi.fn>> }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(), isTauri: () => true, invoke: bridge.call }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (event: string, wake: () => void) => { bridge.events.set(event, wake); const stop = vi.fn(); bridge.stops.push(stop); return stop; } }));
const state = (armed = false, epoch = 0): AutomaticRotorState => ({ armed, epoch, owner: armed ? "native_dcu1" : null, generation: armed ? 4 : null,
  target: null, activation_pending: false, canonical_pending: false, error: "" });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
beforeEach(() => { vi.useFakeTimers(); bridge.events.clear(); bridge.stops.length = 0; bridge.call.mockReset(); bridge.call.mockResolvedValue(state()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("reads native authority passively and arms only the observed owner/generation without renderer motion or lookup", async () => {
  const view = renderHook(() => useAutoRotor()); await settle();
  expect(bridge.call).toHaveBeenCalledExactlyOnceWith("auto_rotor_snapshot");
  bridge.call.mockResolvedValue(state(true, 1));
  await act(async () => { await view.result.current.set(true, { owner: "native_dcu1", generation: 4, state: "active" }); });
  expect(bridge.call).toHaveBeenLastCalledWith("auto_rotor_set", { armed: true, owner: "native_dcu1", generation: 4 });
  expect(view.result.current.state?.armed).toBe(true);
  await expect(view.result.current.set(true, null)).rejects.toThrow("Observe");
  expect(bridge.call.mock.calls.every(([command]) => ["auto_rotor_snapshot", "auto_rotor_set"].includes(command))).toBe(true);
});
it("revokes stale reads on manual-rotor wakes and never restores an older armed epoch from a late arm reply", async () => {
  const view = renderHook(() => useAutoRotor()); await settle();
  const arm = deferred<any>(); bridge.call.mockReturnValueOnce(arm.promise);
  let arming!: Promise<void>; act(() => { arming = view.result.current.set(true, { owner: "native_dcu1", generation: 4, state: "active" }); });
  bridge.call.mockResolvedValue(state(false, 2)); act(() => bridge.events.get("xlog:rotor-telemetry")?.()); await settle();
  await act(async () => { arm.resolve(state(true, 1)); await arming; });
  expect(view.result.current.state).toMatchObject({ armed: false, epoch: 2 });
  const old = deferred<any>(); bridge.call.mockReturnValueOnce(old.promise);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  bridge.call.mockResolvedValue(state(false, 4)); act(() => bridge.events.get("xlog:auto-rotor")?.());
  await act(async () => { old.resolve(state(true, 3)); }); await settle();
  expect(view.result.current.state).toMatchObject({ armed: false, epoch: 4 });
  expect(bridge.call.mock.calls.filter(([command]) => command === "auto_rotor_set")).toHaveLength(1);
});
it("disarms explicitly without owner redirection and discards disposed pending reads", async () => {
  const view = renderHook(() => useAutoRotor()); await settle();
  bridge.call.mockResolvedValue(state(false, 1)); await act(async () => { await view.result.current.set(false); });
  expect(bridge.call).toHaveBeenLastCalledWith("auto_rotor_set", { armed: false });
  const held = deferred<any>(); bridge.call.mockReturnValueOnce(held.promise);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  view.unmount(); await act(async () => { held.resolve(state(true, 2)); });
  expect(view.result.current.state).toMatchObject({ armed: false, epoch: 1 }); bridge.stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
});
