// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectOperatorDraftChanges, openDetachedQSO, protectOperatorDraftClose } from "./operatorDraftWindows";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), close: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen, TauriEvent: { WINDOW_CLOSE_REQUESTED: "tauri://close-requested" } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: api.close }) }));
beforeEach(() => { vi.useFakeTimers(); api.desktop = true; api.invoke.mockReset().mockResolvedValue(undefined); api.listen.mockReset().mockResolvedValue(vi.fn()); api.close.mockReset(); });
afterEach(() => vi.useRealTimers());
it("opens only the native Log QSO singleton", async () => {
  await openDetachedQSO(); expect(api.invoke).toHaveBeenCalledWith("open_detached_map", { kind: "log-qso" });
  api.desktop = false; await expect(openDetachedQSO()).rejects.toThrow("desktop"); expect(api.invoke).toHaveBeenCalledOnce();
});
it("subscribes before reading and recovers through coalesced events, focus and polling", async () => {
  const read = vi.fn().mockResolvedValue(undefined), stop = vi.fn(); let wake!: () => void;
  api.listen.mockImplementation(async (_: string, handler: () => void) => { wake = handler; expect(read).not.toHaveBeenCalled(); return stop; });
  const dispose = connectOperatorDraftChanges(read, vi.fn()); await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  for (let i = 0; i < 50; i++) wake();
  await vi.advanceTimersByTimeAsync(120); expect(read).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(120); expect(read).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1380); expect(read).toHaveBeenCalledTimes(4);
  wake(); dispose(); await vi.runAllTimersAsync(); expect(stop).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(4);
});
it("never overlaps reads and drains a wake received during an in-flight read", async () => {
  let finish!: () => void, wake!: () => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  api.listen.mockImplementation(async (_: string, handler: () => void) => { wake = handler; return vi.fn(); });
  const dispose = connectOperatorDraftChanges(read, vi.fn()); await vi.advanceTimersByTimeAsync(0);
  wake(); await vi.advanceTimersByTimeAsync(120); expect(read).toHaveBeenCalledOnce();
  finish(); await vi.advanceTimersByTimeAsync(120); expect(read).toHaveBeenCalledTimes(2); dispose();
});
it("disposes late subscriptions without starting work", async () => {
  let resolve!: (stop: () => void) => void; const stop = vi.fn(), read = vi.fn();
  api.listen.mockReturnValue(new Promise(done => { resolve = done; }));
  const dispose = connectOperatorDraftChanges(read, vi.fn()); dispose(); resolve(stop); await vi.runAllTimersAsync();
  expect(stop).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
});
it("keeps periodic recovery after subscription failure and reports read failures", async () => {
  api.listen.mockRejectedValue(new Error("unavailable")); const failed = vi.fn(), read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const dispose = connectOperatorDraftChanges(read, failed); await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalledWith(expect.stringContaining("periodic refresh"), "subscription"); expect(failed).toHaveBeenCalledWith("offline", "read");
  await vi.advanceTimersByTimeAsync(1620); expect(read).toHaveBeenCalledTimes(2); dispose();
});
it("does not report a late read error after disposal", async () => {
  let reject!: (cause: Error) => void; const failed = vi.fn(); api.desktop = false;
  const dispose = connectOperatorDraftChanges(() => new Promise((_, fail) => { reject = fail; }), failed);
  dispose(); reject(new Error("late")); await vi.runAllTimersAsync(); expect(failed).not.toHaveBeenCalled();
});
it("reports recovery only for verified reads, not skipped reads or disposed completions", async () => {
  api.listen.mockResolvedValue(vi.fn());
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const recovered = vi.fn(), failed = vi.fn();
  const dispose = connectOperatorDraftChanges(read, failed, recovered);
  await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalledWith("offline", "read");
  await vi.advanceTimersByTimeAsync(1500); expect(recovered).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500); expect(recovered).toHaveBeenCalledOnce();
  let finish!: (verified: boolean) => void;
  read.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(1500); dispose(); finish(true);
  await vi.runAllTimersAsync(); expect(recovered).toHaveBeenCalledOnce();
});
it("guards native close using current draft state and a narrow close command", async () => {
  let close!: () => void, blocked = true; const stop = vi.fn(), explain = vi.fn();
  api.close.mockImplementation(async (_: string, handler: () => void) => { close = handler; return stop; });
  const dispose = protectOperatorDraftClose(() => blocked, explain, vi.fn()); await Promise.resolve();
  close(); expect(api.invoke).not.toHaveBeenCalled(); expect(explain).toHaveBeenCalledOnce();
  blocked = false; close(); expect(api.invoke).toHaveBeenCalledWith("close_qso_window");
  dispose(); close(); expect(api.invoke).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
});
it("freezes edits before approved close, ignores repeated close, and unlocks on failure", async () => {
  let close!: () => void, reject!: (cause: Error) => void;
  const changed = vi.fn(), failed = vi.fn();
  api.close.mockImplementation(async (_: string, handler: () => void) => { close = handler; return vi.fn(); });
  api.invoke.mockImplementation((command: string) => {
    if (command === "operating_module_transition_pending") return Promise.resolve(null);
    expect(changed).toHaveBeenLastCalledWith(true); return new Promise((_, fail) => { reject = fail; });
  });
  const dispose = protectOperatorDraftClose(() => false, vi.fn(), failed, changed); await Promise.resolve();
  close(); close(); expect(api.invoke).toHaveBeenCalledOnce();
  reject(new Error("failed")); await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenLastCalledWith(false); expect(failed).toHaveBeenCalledOnce();
  close(); expect(api.invoke.mock.calls.filter(([command]) => command === "close_qso_window")).toHaveLength(2); dispose();
});
it("uses the main-only close command with the same synchronous admission and no automatic flush", async () => {
  let close!: () => void; const changed = vi.fn();
  api.close.mockImplementation(async (_: string, handler: () => void) => { close = handler; return vi.fn(); });
  api.invoke.mockImplementation(async () => { expect(changed).toHaveBeenLastCalledWith(true); });
  const dispose = protectOperatorDraftClose(() => false, vi.fn(), vi.fn(), changed, "close_main_window"); await Promise.resolve();
  close(); close(); expect(api.invoke).toHaveBeenCalledExactlyOnceWith("close_main_window"); dispose();
});
