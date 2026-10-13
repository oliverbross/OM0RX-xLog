import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { serveDetachedLifecycle, verifyDetachedLifecycle } from "../src/detachedAcceptance";
const ready = () => ({ status: "passed", details: { instanceID: "same-renderer" } });
beforeEach(() => { invoke.mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it("requires a live same-instance probe after reopening, then observed closure", async () => {
  let phase = "initial";
  invoke.mockImplementation(async (method, params) => {
    if (method === "acceptance_open_window") { phase = "reopened"; return; }
    if (method === "acceptance_window_step") { phase = params.action; return { revision: 1 }; }
    if (method === "acceptance_window_state") return phase === "probe"
      ? { open: true, report: { ...ready(), details: { ...ready().details, phaseRevision: 1 } } }
      : { open: false, report: ready() };
  });
  const leave = vi.fn(async () => { expect(phase).toBe("probe"); });
  expect(await verifyDetachedLifecycle("awards", ready(), leave)).toEqual({ instanceID: "same-renderer", probeRevision: 1, closed: true });
  expect(leave).toHaveBeenCalledOnce();
  expect(invoke.mock.calls.map(([method]) => method)).toEqual([
    "acceptance_open_window", "acceptance_window_step", "acceptance_window_state", "acceptance_window_step", "acceptance_window_state",
  ]);
});
it("rejects a replacement renderer even if its window label and catalogue look correct", async () => {
  invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ revision: 4 }).mockResolvedValueOnce({ open: true,
    report: { status: "passed", details: { instanceID: "replacement", phaseRevision: 4 } } });
  const leave = vi.fn();
  await expect(verifyDetachedLifecycle("logbook", ready(), leave)).rejects.toThrow("replaced its renderer");
  expect(leave).not.toHaveBeenCalled();
});
it("does not accept an old report as proof that the reopened renderer is alive", async () => {
  invoke.mockImplementation(async method => method === "acceptance_window_step" ? { revision: 7 } :
    method === "acceptance_window_state" ? { open: true, report: { ...ready(), details: { ...ready().details, phaseRevision: 6 } } } : undefined);
  const pending = expect(verifyDetachedLifecycle("logbook", ready(), vi.fn())).rejects.toThrow("singleton readback");
  await vi.advanceTimersByTimeAsync(20_000); await pending;
});
it("surfaces a failed child instead of waiting for success or claiming closure", async () => {
  invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ revision: 1 }).mockResolvedValueOnce({ open: false, report: { status: "failed", error: "Dock refused" } });
  await expect(verifyDetachedLifecycle("awards", ready(), vi.fn())).rejects.toThrow("Dock refused");
});
it("child acknowledges each retained probe once and uses the supplied real Dock action", async () => {
  let reads = 0;
  invoke.mockImplementation(async method => {
    if (method === "acceptance_window_step") return ++reads < 3 ? { revision: 3, action: "probe" } : { revision: 4, action: "dock" };
  });
  const dock = vi.fn(async () => {}), report = ready();
  const pending = serveDetachedLifecycle(report, dock);
  await vi.advanceTimersByTimeAsync(100); await pending;
  expect(invoke.mock.calls.filter(([method]) => method === "acceptance_monitor")).toHaveLength(1);
  expect(report.details).toMatchObject({ instanceID: "same-renderer", phaseRevision: 3 });
  expect(dock).toHaveBeenCalledOnce();
});
it("refuses unknown child actions and propagates a Dock failure", async () => {
  invoke.mockResolvedValueOnce({ revision: 1, action: "tune" });
  await expect(serveDetachedLifecycle(ready(), vi.fn())).rejects.toThrow("Unexpected native");
  invoke.mockResolvedValueOnce({ revision: 2, action: "dock" });
  await expect(serveDetachedLifecycle(ready(), async () => { throw new Error("Dock failed"); })).rejects.toThrow("Dock failed");
});
