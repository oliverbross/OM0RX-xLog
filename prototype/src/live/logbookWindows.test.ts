// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectLogbookChanges, openDetachedLogbook, protectLogbookClose } from "./logbookWindows";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), close: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen, TauriEvent: { WINDOW_CLOSE_REQUESTED: "tauri://close-requested" } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: api.close }) }));
beforeEach(() => { vi.useFakeTimers(); api.desktop = true; api.invoke.mockReset(); api.invoke.mockResolvedValue(undefined); api.listen.mockReset(); api.close.mockReset(); });
afterEach(() => vi.useRealTimers());
it("opens the singleton native Logbook and rejects browser undocking", async () => {
  await openDetachedLogbook(); expect(api.invoke).toHaveBeenCalledWith("open_detached_map", { kind: "logbook" });
  api.desktop = false; await expect(openDetachedLogbook()).rejects.toThrow("desktop"); expect(api.invoke).toHaveBeenCalledOnce();
});
it("reloads after subscription and coalesces bulk notifications, with focus recovery", async () => {
  const changed = vi.fn(), stop = vi.fn(); let wake!: () => void;
  api.listen.mockImplementation(async (_: string, handler: () => void) => { wake = handler; return stop; });
  const dispose = connectLogbookChanges(changed, vi.fn()); await vi.advanceTimersByTimeAsync(120);
  expect(changed).toHaveBeenCalledOnce();
  for (let i = 0; i < 50; i++) wake();
  await vi.advanceTimersByTimeAsync(120); expect(changed).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(120); expect(changed).toHaveBeenCalledTimes(3);
  wake(); dispose(); await vi.runAllTimersAsync(); expect(stop).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledTimes(3);
});
it("disposes late subscriptions without refreshing an unmounted view", async () => {
  const changed = vi.fn(), stop = vi.fn(); let resolve!: (value: () => void) => void;
  api.listen.mockReturnValue(new Promise(done => { resolve = done; }));
  const dispose = connectLogbookChanges(changed, vi.fn()); dispose(); resolve(stop); await vi.runAllTimersAsync();
  expect(stop).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
});
it("reports subscription failure but retains refocus recovery", async () => {
  api.listen.mockRejectedValue(new Error("unavailable")); const failed = vi.fn(), changed = vi.fn();
  const dispose = connectLogbookChanges(changed, failed); await vi.runAllTimersAsync(); expect(failed).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("focus")); await vi.runAllTimersAsync(); expect(changed).toHaveBeenCalledOnce(); dispose();
});
it("guards close using current edit state and removes its listener", async () => {
  let handler!: () => void, blocked = true;
  const stop = vi.fn(), explain = vi.fn();
  api.close.mockImplementation(async (_event: string, callback: typeof handler) => { handler = callback; return stop; });
  const dispose = protectLogbookClose(() => blocked, explain, vi.fn()); await Promise.resolve();
  handler(); expect(api.invoke).not.toHaveBeenCalled(); expect(explain).toHaveBeenCalledOnce();
  blocked = false; handler(); expect(api.invoke).toHaveBeenCalledWith("close_logbook_window");
  dispose(); expect(stop).toHaveBeenCalledOnce();
});
