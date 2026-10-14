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
    if (args.action === "refresh") { current = { ...current, revision: current.revision + 2, snapshot: source() }; wakes.forEach(wake => wake()); }
    return structuredClone(current);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("mounts passively, hides weather/device controls and fetches only after explicit Refresh", async () => {
  const { unmount } = render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["propagation_session_request", { action: "snapshot" }]]);
  expect(screen.queryByRole("button", { name: "Refresh weather" })).toBeNull();
  expect(screen.getAllByLabelText("Day: Unknown")).toHaveLength(5);
  await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
  expect(native.invoke).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.getByLabelText("Day: good")).toBeTruthy();
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "refresh")).toHaveLength(1);
  unmount(); expect(wakes.size).toBe(0);
});
it("embedded and independent views share the same explicit refresh and retain its source timestamp", async () => {
  const weather = vi.fn();
  render(<><div aria-label="Embedded"><SharedPropagationConditions compact request={weather} includeWeather={false} /></div><DetachedPropagationSurface /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const embedded = screen.getByLabelText("Embedded");
  await act(async () => { fireEvent.click(within(embedded).getByRole("button", { name: "Refresh propagation" })); });
  expect(screen.getAllByLabelText("Day: good")).toHaveLength(2); expect(weather).not.toHaveBeenCalled();
  const received = current.snapshot.received_at, calls = native.invoke.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(660_000); });
  expect(current.snapshot.received_at).toBe(received); expect(native.invoke).toHaveBeenCalledTimes(calls);
  expect(screen.getByText("HF propagation · cached")).toBeTruthy();
  expect(native.invoke.mock.calls.filter(call => call[1]?.action === "refresh")).toHaveLength(1);
});
it("starts with the propagation task and exposes only its explicit refresh", async () => {
  render(<DetachedPropagationSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByRole("heading", { name: /^Propagation$/ })).toBeNull();
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Refresh propagation"]);
  expect(screen.queryByText(/Opening this window reads retained/)).toBeNull();
  expect(native.invoke.mock.calls).toEqual([["propagation_session_request", { action: "snapshot" }]]);
});
