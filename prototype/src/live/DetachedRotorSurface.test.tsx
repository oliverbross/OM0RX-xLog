// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedRotorSurface } from "./DetachedRotorSurface";
import { readFileSync } from "node:fs";
const taskStyles = readFileSync("src/live/DetachedTaskSurface.css", "utf8");

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
const automatic = vi.hoisted(() => ({ state: null as { armed: boolean } | null, error: "", set: vi.fn() }));
vi.mock("./useAutoRotor", () => ({ useAutoRotor: () => automatic }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let event: (value: { payload: unknown }) => void;
const snapshot = () => ({ owner: "native_dcu1", generation: 7, state: "active", backend_available: true,
  backend: { connected: true, name: "Existing rotor", azimuth: 123.4, observed_at: Date.now() / 1000, status: "Observed" } });
const observation = (revision = 1) => ({ revision, available: true, snapshot: snapshot(), received_at_ms: Date.now() });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  automatic.state = { armed: false }; automatic.error = ""; automatic.set.mockResolvedValue(undefined);
  native.listen.mockImplementation(async (_name, callback) => { event = callback; return native.dispose; });
  native.invoke.mockResolvedValue({ revision: 0, available: false, snapshot: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("subscribes to retained observations without starting device polling or motion/setup commands", async () => {
  const { unmount } = render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.listen).toHaveBeenCalledWith("xlog:rotor-telemetry", expect.any(Function));
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
  expect(screen.getByRole("status").textContent).toBe("No rotor observation available");
  expect(screen.getByRole("checkbox", { name: "Auto rotor" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Turn automatic rotor off" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop rotor" })).toHaveProperty("disabled", true);
  expect(automatic.set).not.toHaveBeenCalled();
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

it("reflows the compass, automatic controls and retained details without wrapper chrome", async () => {
  const { container } = render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(container.firstElementChild?.classList.contains("detached-task-app")).toBe(true);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByRole("button", { name: "Turn automatic rotor off" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop rotor" })).toBeTruthy();
  expect(screen.queryByText(/independent of Desk|Connection setup, turning/)).toBeNull();
  expect(screen.getByRole("img")).toBeTruthy();
  expect(taskStyles).toMatch(/\.app\.live\.detached-task-app\s*\{[^}]*display: flex/);
  expect(taskStyles).toContain("width: min(100%, 560px, max(140px, calc(100dvh - 300px)))");
  expect(taskStyles).toContain("@container detached-rotor (min-width: 680px)");
  expect(taskStyles).not.toContain("190px");
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
});

it("arms only through the existing automatic controller with the current observed owner", async () => {
  const retained = observation(); native.invoke.mockResolvedValue(retained);
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const toggle = screen.getByRole("checkbox", { name: "Auto rotor" });
  expect(toggle).toHaveProperty("disabled", false);
  await act(async () => { fireEvent.click(toggle); });
  expect(automatic.set).toHaveBeenCalledExactlyOnceWith(true, retained.snapshot);
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
});

it("rechecks freshness at the event boundary and leaves Off available with unavailable telemetry", async () => {
  native.invoke.mockResolvedValue(observation());
  const view = render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  vi.setSystemTime(Date.now() + 6000); // No render/timer tick before the click.
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Auto rotor" })); });
  expect(automatic.set).not.toHaveBeenCalled();
  automatic.state = { armed: true };
  await act(async () => { event({ payload: { ...observation(2), available: false } }); });
  view.rerender(<DetachedRotorSurface />);
  expect(screen.getByRole("checkbox", { name: "Auto rotor" })).toHaveProperty("disabled", false);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn automatic rotor off" })); });
  expect(automatic.set).toHaveBeenCalledExactlyOnceWith(false, undefined);
  expect(screen.getByText("123.4°")).toBeTruthy();
});

it("reports an automatic-controller failure without claiming a changed bearing or issuing a direct move", async () => {
  native.invoke.mockResolvedValue(observation()); automatic.set.mockRejectedValue(new Error("Owner changed; refresh"));
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Auto rotor" })); });
  expect(screen.getByRole("alert").textContent).toBe("Owner changed; refresh");
  expect(screen.getByText("123.4°")).toBeTruthy();
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"]]);
});

it("stops through the native same-owner ingress even when the retained position is stale", async () => {
  const retained = observation(); retained.snapshot.backend.observed_at -= 20;
  native.invoke.mockImplementation(async command => command === "rotor_telemetry_snapshot" ? retained :
    command === "monitor_rotor_stop" ? { ok: true, result: snapshot() } : Promise.reject(new Error(`Unexpected ${command}`)));
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toBe("Position unavailable or stale");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop rotor" })); });
  expect(native.invoke.mock.calls).toEqual([["rotor_telemetry_snapshot"], ["monitor_rotor_stop", { owner: "native_dcu1" }]]);
});

it("reports an uncertain Stop once and does not retry it", async () => {
  native.invoke.mockImplementation(async command => command === "rotor_telemetry_snapshot" ? observation() :
    command === "monitor_rotor_stop" ? Promise.reject(new Error("Stop acknowledgement lost")) : Promise.reject(new Error(`Unexpected ${command}`)));
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop rotor" })); });
  expect(screen.getByRole("alert").textContent).toBe("Stop acknowledgement lost");
  expect(native.invoke.mock.calls.filter(([command]) => command === "monitor_rotor_stop")).toHaveLength(1);
});
