// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceWindowsStatus, useWorkspaceWindows } from "./useWorkspaceWindows";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const idle = () => ({ supported: ["monitor", "world-map", "band-maps", "dx-cluster", "logbook", "awards"],
  generation: null, revision: null, presetID: null, state: "idle", shown: [], hidden: [], error: "", stopped: false });
const applied = () => ({ ...idle(), state: "applied", generation: "01234567-89ab-cdef-0123-456789abcdef", revision: 2, presetID: "desk-1" });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let wake: (event?: unknown) => void, dispose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.resetAllMocks(); native.isTauri.mockReturnValue(true); dispose = vi.fn();
  native.listen.mockImplementation(async (_event, callback) => { wake = callback; return dispose; });
  native.invoke.mockImplementation(async command => command === "workspace_windows_status" ? idle() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("native workspace status schema", () => {
  it("accepts bounded native observations and a supported subset", () => {
    const value = { ...idle(), supported: ["world-map"], shown: ["world-map"], state: "applied",
      generation: "01234567-89ab-cdef-0123-456789abcdef", revision: 2, presetID: "desk-1" };
    expect(readWorkspaceWindowsStatus(value)).toEqual(value);
    expect(readWorkspaceWindowsStatus({ ...idle(), state: "applying" }).state).toBe("applying");
  });
  it.each([
    { state: "done" }, { supported: ["rotor"] }, { supported: ["monitor", "monitor"] },
    { supported: ["world-map"], shown: ["monitor"] }, { state: "applied" },
    { ...applied(), generation: null }, { ...applied(), revision: null }, { ...applied(), presetID: null },
    { generation: "bad" }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { presetID: "x".repeat(65) }, { error: "x".repeat(4097) }, { stopped: 1 },
  ])("rejects malformed or unsupported observations %j", change => {
    expect(() => readWorkspaceWindowsStatus({ ...idle(), ...change })).toThrow("could not be verified");
  });
  it("accepts a window shown then hidden by a superseding layout", () => {
    expect(readWorkspaceWindowsStatus({ ...applied(), shown: ["world-map"], hidden: ["world-map"] }))
      .toMatchObject({ state: "applied", shown: ["world-map"], hidden: ["world-map"] });
  });
});

it("is inert outside Tauri, including retry and focus", async () => {
  native.isTauri.mockReturnValue(false);
  const { result } = renderHook(useWorkspaceWindows);
  await act(async () => { await result.current.retry(); window.dispatchEvent(new Event("focus")); });
  expect(result.current).toMatchObject({ status: null, error: "", retrying: false });
  expect(native.invoke).not.toHaveBeenCalled(); expect(native.listen).not.toHaveBeenCalled();
});

it("subscribes before reading and treats wake payload as untrusted", async () => {
  const subscription = deferred<() => void>(); native.listen.mockReturnValue(subscription.promise);
  const { result } = renderHook(useWorkspaceWindows);
  expect(native.invoke).not.toHaveBeenCalled();
  await act(async () => { subscription.resolve(dispose); });
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(native.listen).toHaveBeenCalledWith("xlog:workspace-windows", expect.any(Function));
  native.invoke.mockResolvedValue({ ...applied(), shown: ["world-map"] });
  await act(async () => { native.listen.mock.calls[0][1]({ payload: { state: "error", shown: ["rotor"] } }); });
  await waitFor(() => expect(result.current.status?.shown).toEqual(["world-map"]));
  expect(native.invoke.mock.calls.every(args => args.length === 1 && args[0] === "workspace_windows_status")).toBe(true);
});

it("coalesces burst invalidations and never overlaps status reads", async () => {
  const first = deferred<unknown>(); native.invoke.mockReturnValueOnce(first.promise);
  const { result } = renderHook(useWorkspaceWindows);
  await act(async () => {});
  await act(async () => { for (let index = 0; index < 30; index++) { wake(); window.dispatchEvent(new Event("focus")); } });
  expect(native.invoke).toHaveBeenCalledTimes(1);
  native.invoke.mockResolvedValue(applied());
  await act(async () => { first.resolve({ ...idle(), state: "applying" }); });
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

it("reports read failures and recovers on focus without reconciling", async () => {
  native.invoke.mockRejectedValueOnce(new Error("status failed"));
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.error).toBe("status failed"));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(result.current.error).toBe("");
  expect(native.invoke.mock.calls.every(([command]) => command === "workspace_windows_status")).toBe(true);
});

it("keeps focus fallback after subscription failure", async () => {
  native.listen.mockRejectedValue(new Error("listen failed"));
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(result.current.error).toContain("Refocus to reload");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
});

it("retry queues only the saved snapshot, refreshes, and does not invent completion", async () => {
  const queued = deferred<void>();
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  native.invoke.mockImplementation(command => command === "workspace_windows_reconcile" ? queued.promise : Promise.resolve({ ...idle(), state: "applying" }));
  let retry!: Promise<void>;
  act(() => { retry = result.current.retry(); void result.current.retry(); });
  expect(result.current.retrying).toBe(true);
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_windows_reconcile")).toEqual([["workspace_windows_reconcile"]]);
  await act(async () => { queued.resolve(); await retry; });
  expect(result.current.retrying).toBe(false); expect(result.current.status?.state).toBe("applying");
  native.invoke.mockResolvedValue({ ...idle(), state: "error", error: "could not show world-map", shown: [] });
  act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.state).toBe("error"));
  expect(result.current.status?.error).toContain("could not show");
});

it("reports retry errors", async () => {
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  native.invoke.mockRejectedValue(new Error("queue failed"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.error).toBe("queue failed"); expect(result.current.retrying).toBe(false);
});

it("disposes a late subscription and prevents retained retry or focus work", async () => {
  const subscription = deferred<() => void>(); native.listen.mockReturnValue(subscription.promise);
  const { result, unmount } = renderHook(useWorkspaceWindows); const retry = result.current.retry;
  unmount();
  await act(async () => { subscription.resolve(dispose); await retry(); window.dispatchEvent(new Event("focus")); });
  expect(dispose).toHaveBeenCalledTimes(1); expect(native.invoke).not.toHaveBeenCalled();
});

it("drops pending wake and post-retry reads after disposal", async () => {
  const queued = deferred<void>();
  const { result, unmount } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status).not.toBeNull());
  native.invoke.mockReturnValue(queued.promise);
  let retry!: Promise<void>; act(() => { retry = result.current.retry(); wake(); });
  unmount();
  await act(async () => { queued.resolve(); await retry; });
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledTimes(1);
});

it("ignores a late read and its coalesced followup after disposal", async () => {
  const reading = deferred<unknown>(); native.invoke.mockReturnValue(reading.promise);
  const { result, unmount } = renderHook(useWorkspaceWindows);
  await act(async () => {}); act(() => { wake(); }); unmount();
  await act(async () => { reading.resolve(applied()); });
  expect(result.current.status).toBeNull(); expect(native.invoke).toHaveBeenCalledTimes(1);
});
