// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedPropagationSurface } from "./DetachedPropagationSurface";
import SharedPropagationConditions from "./SharedPropagationConditions";
import { propagationRefreshKey } from "./propagationPreferences";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let wakes: Set<() => void>, current: any;
const source = () => ({ status: "Current", source: "N0NBH / HamQSL", stale: false, received_at: Date.now() / 1000, updated_at: Date.now() / 1000,
  solar_flux: 122, a_index: 13, k_index: 1, x_ray: "A1", bands: [{ name: "20m", day: "good", night: "fair" }] });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear(); wakes = new Set();
  current = { epoch: "00000000-0000-4000-8000-000000000001", revision: 0, pending: false, snapshot: null, error: "" };
  native.listen.mockImplementation(async (_name, wake) => { wakes.add(wake); return () => { wakes.delete(wake); }; });
  native.invoke.mockImplementation(async (command, args) => {
    if (command !== "propagation_session_request") return;
    const stale = !current.snapshot || Date.now() / 1000 - current.snapshot.received_at >= args.refreshIntervalSeconds;
    if (args.action === "ensure" && stale) current = { ...current, revision: current.revision + 2, snapshot: source() };
    return structuredClone(current);
  });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

it("refreshes automatically without propagation or weather buttons and cleans up", async () => {
  const { unmount } = render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["propagation_session_request", { action: "ensure", refreshIntervalSeconds: 600 }]]);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
  const received = current.snapshot.received_at;
  await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
  expect(current.snapshot.received_at).toBeGreaterThan(received);
  expect(native.invoke.mock.calls.every(call => call[1].action === "ensure")).toBe(true);
  unmount(); expect(wakes.size).toBe(0);
});
it("uses the persisted cadence in embedded and detached views", async () => {
  localStorage.setItem(propagationRefreshKey, "30");
  render(<><SharedPropagationConditions compact includeWeather={false} /><DetachedPropagationSurface /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const received = current.snapshot.received_at;
  await act(async () => { await vi.advanceTimersByTimeAsync(29 * 60_000); });
  expect(current.snapshot.received_at).toBe(received);
  expect(screen.queryByText("HF propagation · cached")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(current.snapshot.received_at).toBeGreaterThan(received);
  expect(native.invoke.mock.calls.every(call => call[1].refreshIntervalSeconds === 1800)).toBe(true);
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2);
});
it("recovers failed initial observations on the next automatic freshness check", async () => {
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementationOnce(async () => ({ ...current, error: "Propagation unavailable" }));
  render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText("Propagation unavailable")).toBeTruthy();
  native.invoke.mockImplementation(original);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByText("Propagation unavailable")).toBeNull();
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
});
it("shows delayed observations immediately in both surfaces", async () => {
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => { if (args?.action === "ensure") await response; return original(command, args); });
  render(<><SharedPropagationConditions compact includeWeather={false} /><DetachedPropagationSurface /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2);
  expect(screen.queryByText(/last known/)).toBeNull();
});
