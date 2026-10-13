// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectOperatorDraftChanges, ownDraftUpdateWarnings } from "./operatorDraftWindows";

const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen, TauriEvent: {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); native.listen.mockReset().mockResolvedValue(vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Same ownership hook used by MainLiveApp, without mounting station controllers.
function Harness({ read }: { read: () => Promise<boolean> }) {
  const [error, setError] = useState("");
  const [health] = useState(() => ownDraftUpdateWarnings(setError));
  useEffect(() => connectOperatorDraftChanges(read, health.failed, health.recovered, health.subscribed), [read, health]);
  return <><output aria-label="Warning">{error}</output><button onClick={() => setError("Unrelated newer failure")}>Other failure</button></>;
}
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it("clears its own read warning only after verified recovery, not a skipped refresh", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("Shared draft updates unavailable."))
    .mockResolvedValueOnce(false).mockResolvedValue(true);
  render(<Harness read={read} />); await tick();
  expect(screen.getByLabelText("Warning").textContent).toBe("Shared draft updates unavailable.");
  await tick(1500); expect(screen.getByLabelText("Warning").textContent).toBe("Shared draft updates unavailable.");
  await tick(1500); expect(screen.getByLabelText("Warning").textContent).toBe("");
});
it("retains a newer unrelated warning after this reader recovers", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("Draft transport offline")).mockResolvedValue(true);
  render(<Harness read={read} />); await tick();
  fireEvent.click(screen.getByRole("button", { name: "Other failure" }));
  await tick(1500); expect(screen.getByLabelText("Warning").textContent).toBe("Unrelated newer failure");
});
it("does not claim a persistent subscription failure recovered because reads now work", async () => {
  native.listen.mockRejectedValue(new Error("listener unavailable"));
  const read = vi.fn().mockRejectedValueOnce(new Error("Draft transport offline")).mockResolvedValue(true);
  render(<Harness read={read} />); await tick();
  expect(screen.getByLabelText("Warning").textContent).toBe("Draft transport offline");
  await tick(1500); expect(screen.getByLabelText("Warning").textContent).toBe("Live draft notifications are unavailable; periodic refresh remains active.");
});
it("preserves ownership across subscription replacement and ignores disposed late errors", async () => {
  let reject!: (cause: Error) => void;
  const old = vi.fn().mockRejectedValueOnce(new Error("Draft read unavailable"))
    .mockImplementation(() => new Promise<boolean>((_, fail) => { reject = fail; }));
  const view = render(<Harness read={old} />); await tick(); await tick(1500);
  view.rerender(<Harness read={async () => true} />); await tick();
  expect(screen.getByLabelText("Warning").textContent).toBe("");
  await act(async () => { reject(new Error("late disposed failure")); await Promise.resolve(); });
  expect(screen.getByLabelText("Warning").textContent).toBe("");
});
it("clears an owned subscription warning only after a real subscription replacement succeeds", async () => {
  native.listen.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(vi.fn());
  const first = vi.fn().mockResolvedValue(false);
  const view = render(<Harness read={first} />); await tick();
  expect(screen.getByLabelText("Warning").textContent).toContain("Live draft notifications are unavailable");
  view.rerender(<Harness read={async () => false} />); await tick();
  expect(screen.getByLabelText("Warning").textContent).toBe("");
});
