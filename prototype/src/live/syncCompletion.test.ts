import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchSyncCompletion } from "./syncCompletion";

const native = vi.hoisted(() => ({ desktop: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.desktop }));
beforeEach(() => { vi.useFakeTimers(); native.desktop = false; });
afterEach(() => vi.useRealTimers());

it("reads a small summary and refreshes once per completion, including failures", async () => {
  let summary: Record<string, unknown> = { running: false, completion_id: "old" };
  const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => summary), changed = vi.fn();
  const stop = watchSyncCompletion(request, changed);
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledWith("sync_summary", {});
  expect(changed).toHaveBeenCalledOnce();
  for (const [completion_id, status] of [["first", "Completed"], ["second", "Completed with failures"], ["third", "Failed"]]) {
    summary = { running: true }; await vi.advanceTimersByTimeAsync(5_000);
    summary = { running: false, completion_id, status, finished_at: "same second" };
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(15_000);
  }
  expect(changed).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.every(([method]) => method === "sync_summary")).toBe(true);
  stop();
});

it("never overlaps slow polls and ignores responses after disposal", async () => {
  let resolve!: (summary: Record<string, unknown>) => void;
  const request = vi.fn(() => new Promise<Record<string, unknown>>(done => { resolve = done; }));
  const changed = vi.fn(), stop = watchSyncCompletion(request, changed);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledOnce();
  resolve({ running: false }); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(4_999); expect(request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(2);
  stop(); resolve({ running: false, completion_id: "late" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
});

it("keeps polling after a transient read failure", async () => {
  const request = vi.fn().mockResolvedValueOnce({ running: false })
    .mockRejectedValueOnce(new Error("worker busy"))
    .mockResolvedValue({ running: false, completion_id: "new" });
  const changed = vi.fn(), stop = watchSyncCompletion(request, changed);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(changed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10_000); expect(changed).toHaveBeenCalledOnce();
  stop();
});

it("leaves native completion monitoring entirely to the application owner", async () => {
  native.desktop = true;
  const request = vi.fn().mockResolvedValueOnce({ running: false })
    .mockResolvedValue({ running: false, completion_id: "new" });
  const changed = vi.fn(), stop = watchSyncCompletion(request, changed);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(request).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  stop();
});
