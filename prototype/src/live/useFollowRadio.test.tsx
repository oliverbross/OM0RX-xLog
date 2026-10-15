// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFollowRadio, type FollowRadioState } from "./useFollowRadio";

const bridge = vi.hoisted(() => ({ call: vi.fn(), wake: null as (() => void) | null, stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(), isTauri: () => true, invoke: bridge.call }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_event: string, wake: () => void) => { bridge.wake = wake; return bridge.stop; }) }));

const idle = { operationId: null, phase: "idle", barrier: null } as const;
const state = (enabled = false, epoch = 0): FollowRadioState => ({ enabled, epoch, error: "", operation: idle, settlementPending: false });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

beforeEach(() => {
  vi.useFakeTimers(); bridge.call.mockReset(); bridge.stop.mockReset(); bridge.wake = null;
  bridge.call.mockResolvedValue(state());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("subscribes before reading the disabled-by-default native permission", async () => {
  const view = renderHook(() => useFollowRadio()); await settle();
  expect(bridge.call).toHaveBeenCalledExactlyOnceWith("operator_draft_follow_snapshot");
  expect(view.result.current.state).toEqual(state());
  view.unmount(); expect(bridge.stop).toHaveBeenCalledOnce();
});

it("sets the shared permission against the observed epoch and adopts its reply", async () => {
  const view = renderHook(() => useFollowRadio()); await settle();
  bridge.call.mockResolvedValueOnce(state(true, 1));
  await act(async () => { await view.result.current.set(true); });
  expect(bridge.call).toHaveBeenLastCalledWith("operator_draft_follow_set", { enabled: true, expectedEpoch: 0 });
  expect(view.result.current.state).toEqual(state(true, 1));
});

it("serializes rapid local intents and never lets an earlier enable overwrite the later disable", async () => {
  const view = renderHook(() => useFollowRadio()); await settle();
  const enabled = deferred<FollowRadioState>();
  bridge.call.mockReturnValueOnce(enabled.promise).mockResolvedValueOnce(state(false, 2));
  let first!: Promise<FollowRadioState>, second!: Promise<FollowRadioState>;
  act(() => { first = view.result.current.set(true); });
  await act(async () => { await Promise.resolve(); });
  act(() => { second = view.result.current.set(false); });
  await act(async () => { enabled.resolve(state(true, 1)); await first; await second; });
  expect(bridge.call.mock.calls.slice(-2)).toEqual([
    ["operator_draft_follow_set", { enabled: true, expectedEpoch: 0 }],
    ["operator_draft_follow_set", { enabled: false, expectedEpoch: 1 }],
  ]);
  expect(view.result.current.state).toEqual(state(false, 2));
});
