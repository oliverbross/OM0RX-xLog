import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { verifyDetachedLifecycle } from "../src/detachedAcceptance";
const ready = () => ({ status: "passed", details: { instanceID: "same-renderer" } });
beforeEach(() => { invoke.mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it("requires a live same-instance renderer after reopening, then observed native closure", async () => {
  let phase = "initial";
  invoke.mockImplementation(async method => {
    if (method === "acceptance_open_window") { phase = "reopened"; return; }
    if (method === "acceptance_close_window") { phase = "closed"; return; }
    if (method === "acceptance_window_state") return phase === "reopened"
      ? { open: true, report: ready() } : { open: false, report: ready() };
  });
  const leave = vi.fn(async () => { expect(phase).toBe("reopened"); });
  expect(await verifyDetachedLifecycle("awards", ready(), leave)).toEqual({ instanceID: "same-renderer", closed: true });
  expect(leave).toHaveBeenCalledOnce();
  expect(invoke.mock.calls.map(([method]) => method)).toEqual([
    "acceptance_open_window", "acceptance_window_state", "acceptance_close_window", "acceptance_window_state",
  ]);
});
it("rejects a replacement renderer even if its window label and catalogue look correct", async () => {
  invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ open: true,
    report: { status: "passed", details: { instanceID: "replacement" } } });
  const leave = vi.fn();
  await expect(verifyDetachedLifecycle("logbook", ready(), leave)).rejects.toThrow("replaced its renderer");
  expect(leave).not.toHaveBeenCalled();
});
it("does not accept a closed window as proof that the retained renderer is alive", async () => {
  invoke.mockImplementation(async method => method === "acceptance_window_state"
    ? { open: false, report: ready() } : undefined);
  const pending = expect(verifyDetachedLifecycle("logbook", ready(), vi.fn())).rejects.toThrow("singleton readback");
  await vi.advanceTimersByTimeAsync(20_000); await pending;
});
it("surfaces a failed child instead of waiting for success or claiming closure", async () => {
  invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ open: false, report: { status: "failed", error: "Close refused" } });
  await expect(verifyDetachedLifecycle("awards", ready(), vi.fn())).rejects.toThrow("Close refused");
});
