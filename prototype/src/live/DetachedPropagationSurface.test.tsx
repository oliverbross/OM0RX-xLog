// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedPropagationSurface } from "./DetachedPropagationSurface";
import SharedPropagationConditions from "./SharedPropagationConditions";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let wakes: Set<() => void>, current: any;
const source = () => ({ status: "Current", source: "N0NBH / HamQSL", stale: false, received_at: Date.now() / 1000, updated_at: Date.now() / 1000,
  solar_flux: 122, a_index: 13, k_index: 1, x_ray: "A1", bands: [{ name: "20m", day: "good", night: "fair" }] });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); wakes = new Set();
  current = { epoch: "00000000-0000-4000-8000-000000000001", revision: 0, pending: false, snapshot: null, error: "" };
  native.listen.mockImplementation(async (_name, wake) => { wakes.add(wake); return () => { wakes.delete(wake); }; });
  native.invoke.mockImplementation(async (command, args) => {
    if (command !== "propagation_session_request") return;
    const stale = !current.snapshot || Date.now() / 1000 - current.snapshot.received_at >= 600;
    if (args.action === "refresh" || args.action === "ensure" && stale)
      current = { ...current, revision: current.revision + 2, snapshot: source() };
    if (args.action === "refresh") wakes.forEach(wake => wake());
    return structuredClone(current);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("ensures fresh shared conditions on mount and cadence while hiding weather/device controls", async () => {
  const { unmount } = render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["propagation_session_request", { action: "ensure" }]]);
  expect(screen.queryByRole("button", { name: "Refresh weather" })).toBeNull();
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
  const firstReceived = current.snapshot.received_at;
  await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
  expect(current.snapshot.received_at).toBeGreaterThan(firstReceived);
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "ensure")).toHaveLength(11);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "refresh")).toHaveLength(1);
  unmount(); expect(wakes.size).toBe(0);
});
it("embedded and independent views share explicit refresh and native freshness cadence", async () => {
  const weather = vi.fn();
  render(<><div aria-label="Embedded"><SharedPropagationConditions compact request={weather} includeWeather={false} /></div><DetachedPropagationSurface /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const embedded = screen.getByLabelText("Embedded");
  await act(async () => { fireEvent.click(within(embedded).getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2); expect(weather).not.toHaveBeenCalled();
  const received = current.snapshot.received_at, calls = native.invoke.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(660_000); });
  expect(current.snapshot.received_at).toBeGreaterThan(received); expect(native.invoke.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.queryByText("HF propagation · cached")).toBeNull();
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "refresh")).toHaveLength(1);
});
it("starts with the propagation task and exposes only its explicit refresh", async () => {
  render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByRole("heading", { name: /^Propagation$/ })).toBeNull();
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Refresh propagation"]);
  expect(screen.queryByText(/Opening this window reads retained/)).toBeNull();
  expect(native.invoke.mock.calls).toEqual([["propagation_session_request", { action: "ensure" }]]);
});
it("keeps failed refresh warnings visible in both surfaces and recovers with a fresh shared observation", async () => {
  render(<><div aria-label="Embedded"><SharedPropagationConditions compact includeWeather={false} /></div><DetachedPropagationSurface /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    if (args?.action === "refresh") {
      current = { ...current, revision: current.revision + 2, snapshot: { ...current.snapshot, stale: true }, error: "Upstream unavailable" };
      wakes.forEach(wake => wake());
      return structuredClone(current);
    }
    return original(command, args);
  });
  await act(async () => { fireEvent.click(within(screen.getByLabelText("Embedded")).getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.getAllByText("Upstream unavailable")).toHaveLength(2);
  expect(screen.getByText("HF propagation · cached")).toBeTruthy();
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2);
  native.invoke.mockImplementation(async (command, args) => {
    if (args?.action === "refresh") current.error = "";
    return original(command, args);
  });
  await act(async () => { fireEvent.click(within(screen.getByLabelText("Detached Propagation")).getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.queryByText("Upstream unavailable")).toBeNull();
  expect(screen.queryByText("HF propagation · cached")).toBeNull();
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2);
  expect(native.invoke.mock.calls.every(call => call[0] === "propagation_session_request")).toBe(true);
});
it("replaces initial placeholders after an explicit detached refresh when startup fetch failed", async () => {
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => args?.action === "ensure"
    ? { ...structuredClone(current), error: "Propagation refresh unavailable" } : original(command, args));
  render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText("Awaiting propagation data")).toBeTruthy();
  expect(screen.getByText("Propagation refresh unavailable")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.queryByText("Awaiting propagation data")).toBeNull();
  expect(screen.queryByText("Propagation refresh unavailable")).toBeNull();
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "refresh")).toHaveLength(1);
});
