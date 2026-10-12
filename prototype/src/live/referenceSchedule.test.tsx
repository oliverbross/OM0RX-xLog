// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { referenceAutoCheckKey, useReferenceSchedule } from "./referenceSchedule";
function Harness({ ready, request }: { ready: boolean; request: (method: string) => Promise<unknown> }) { useReferenceSchedule(ready, request); return null; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T00:00:00Z")); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("reference check lifecycle", () => {
  it("waits for workspace and startup, checks once, throttles wake and stops on unmount", async () => {
    const request = vi.fn(async () => ({}));
    const view = render(<Harness ready={false} request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).not.toHaveBeenCalled();
    view.rerender(<Harness ready request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); window.dispatchEvent(new Event("focus")); });
    expect(request).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledWith("reference_schedule");
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); window.dispatchEvent(new Event("focus")); });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("honors disabled checks and never overlaps an unresolved request", async () => {
    localStorage.setItem(referenceAutoCheckKey, "false");
    const request = vi.fn(() => new Promise(() => {}));
    render(<Harness ready request={request} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(request).not.toHaveBeenCalled();
    localStorage.setItem(referenceAutoCheckKey, "true");
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(7_200_000); });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
