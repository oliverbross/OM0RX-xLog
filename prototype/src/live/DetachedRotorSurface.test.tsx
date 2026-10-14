// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedRotorSurface } from "./DetachedRotorSurface";
import { readFileSync } from "node:fs";
const taskStyles = readFileSync("src/live/DetachedTaskSurface.css", "utf8");

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let event: (value: { payload: unknown }) => void;
const snapshot = () => ({ owner: "native_dcu1", generation: 7, state: "active", backend_available: true,
  backend: { connected: true, name: "Existing rotor", azimuth: 123.4, observed_at: Date.now() / 1000, status: "Observed" } });
const observation = (revision = 1) => ({ revision, available: true, snapshot: snapshot(), received_at_ms: Date.now() });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  native.listen.mockImplementation(async (_name, callback) => { event = callback; return native.dispose; });
  native.invoke.mockResolvedValue({ revision: 0, available: false, snapshot: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("mounts as a retained-only subscriber, starts no renderer poller and exposes no motion/setup controls", async () => {
  const { unmount } = render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.listen).toHaveBeenCalledWith("xlog:rotor-telemetry", expect.any(Function));
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
  expect(screen.getByRole("status").textContent).toBe("No rotor observation available");
  expect(screen.queryByRole("button")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(native.invoke).toHaveBeenCalledOnce();
  unmount(); expect(native.dispose).toHaveBeenCalledOnce();
});

it("shows streamed observations but hides the compass needle when position or stream becomes stale", async () => {
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); event({ payload: observation() }); });
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Observed rotor bearing 123 degrees");
  expect(screen.getByText("123.4°")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Rotor bearing unavailable");
  expect(screen.getByText("123.4°")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Position unavailable or stale");
  await act(async () => { event({ payload: observation(2) }); });
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Observed rotor bearing 123 degrees");
  await act(async () => { event({ payload: { ...observation(3), available: false } }); });
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Rotor bearing unavailable");
  expect(native.invoke).toHaveBeenCalledOnce();
});

it("does not treat a freshly received projection of an old device position as current", async () => {
  const retained = observation(); retained.snapshot.backend.observed_at -= 20;
  native.invoke.mockResolvedValue(retained);
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Rotor bearing unavailable");
  expect(screen.getByText("123.4°")).toBeTruthy();
});

it("uses the window width for only the passive rotor task without wrapper chrome", async () => {
  const { container } = render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(container.firstElementChild?.classList.contains("detached-task-app")).toBe(true);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(/independent of Desk|Connection setup, turning/)).toBeNull();
  expect(screen.getByRole("img")).toBeTruthy();
  expect(taskStyles).toMatch(/\.app\.live\.detached-task-app\s*\{[^}]*display: flex/);
  expect(taskStyles).toContain("width: min(100%, 560px)");
  expect(taskStyles).not.toContain("190px");
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
});
