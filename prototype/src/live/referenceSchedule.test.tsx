// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { referenceAutoCheckChanged, referenceAutoCheckKey, useReferenceSchedule, type ReferenceRequest } from "./referenceSchedule";
function Harness({ ready, request }: { ready: boolean; request: ReferenceRequest }) { useReferenceSchedule(ready, request); return null; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T00:00:00Z")); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("reference check lifecycle", () => {
  it("waits for workspace and startup, checks once, throttles wake and stops on unmount", async () => {
    const request = vi.fn(async () => ({ automatic_check: true }));
    const view = render(<Harness ready={false} request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).not.toHaveBeenCalled();
    view.rerender(<Harness ready request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("reference_configure", { enabled: true, only_if_unset: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); window.dispatchEvent(new Event("focus")); });
    expect(request).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledWith("reference_schedule");
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(request).toHaveBeenCalledTimes(2); // The native worker owns hourly checks.
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); window.dispatchEvent(new Event("focus")); });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("migrates disabled legacy checks and lets native persistence decide whether scheduling is due", async () => {
    localStorage.setItem(referenceAutoCheckKey, "false");
    const request = vi.fn(async (_method: string) => ({ automatic_check: false }));
    render(<Harness ready request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(request).toHaveBeenCalledWith("reference_configure", { enabled: false, only_if_unset: true });
    expect(request).toHaveBeenCalledWith("reference_schedule");
    localStorage.setItem(referenceAutoCheckKey, "true");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("focus")); });
    expect(request.mock.calls.filter(([method]) => method === "reference_configure")).toHaveLength(1);
  });
  it("coalesces wake signals while migration is pending and does not lose their scheduled check", async () => {
    let resolveMigration!: (value: any) => void;
    const request = vi.fn((method: string) => method === "reference_configure" ? new Promise(resolve => { resolveMigration = resolve; }) : new Promise(() => {}));
    render(<Harness ready request={request} />);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(30_000); });
    expect(request).toHaveBeenCalledOnce();
    await act(async () => { resolveMigration({ automatic_check: true }); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event(referenceAutoCheckChanged)); });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("retries a failed migration on wake and keeps schedule failures bounded", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "reference_configure" && request.mock.calls.length === 1) throw new Error("offline");
      if (method === "reference_configure") return { automatic_check: true };
      throw new Error("offline");
    });
    render(<Harness ready request={request} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("focus")); });
    expect(request).toHaveBeenCalledTimes(3);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("focus")); });
    expect(request.mock.calls.filter(([method]) => method === "reference_schedule")).toHaveLength(2);
  });
  it("does not schedule after an outstanding migration resolves following unmount", async () => {
    let resolveMigration!: (value: any) => void;
    const request = vi.fn(() => new Promise(resolve => { resolveMigration = resolve; }));
    const view = render(<Harness ready request={request} />);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    view.unmount();
    await act(async () => { resolveMigration({ automatic_check: true }); await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).toHaveBeenCalledOnce();
  });
});
