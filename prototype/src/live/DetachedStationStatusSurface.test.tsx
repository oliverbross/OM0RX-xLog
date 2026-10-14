// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedStationStatusSurface } from "./DetachedStationStatusSurface";
import type { MonitorContext } from "./monitorContext";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), worker: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../worker", () => ({ workerRequest: native.worker }));
let wakes: Record<string, () => void>;
const id = "00000000-0000-4000-8000-000000000002";
function fixture(provider: "direct_agent" | "direct_flex_lan" | "hamlib" = "direct_agent", revision = 1): MonitorContext {
  const now = Date.now();
  const snapshot = provider === "hamlib" ? { observed_at_ms: now, fields: {
    frequency: { Frequency: "14074000" }, mode: { Mode: "USB" }, ptt: { PTT: "0" }, split: { Split: "0" }, vfo: { VFO: "VFOA" },
  }, field_observed_at_ms: { frequency: now, mode: now, ptt: now, split: now, vfo: now, tx_frequency: now } } : {
    source: provider, generated_at: now / 1000,
    radio: { connected: true, observed: true, observed_at: now / 1000, frequency_hz: 14074000, mode: "USB", transmitting: false, split: false },
    station: { coordinator_state: "Ready", interlock_state: "Receive", route_alignment: "Aligned", kpa_operate: false, inhibitors: ["Example retained safety report"] },
  };
  return { epoch: "00000000-0000-4000-8000-000000000001", revision,
    selection: { provider, generation: 9, selection_id: id },
    radio: { revision, available: true, provider, selection_id: id, selection_generation: 9, received_at_ms: now, snapshot },
    rotor: { available: false, snapshot: null } };
}
const value = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z")); vi.resetAllMocks(); wakes = {};
  native.listen.mockImplementation(async (name, wake) => { wakes[name] = wake; return native.stop; });
  native.invoke.mockImplementation(async command => command === "station_status_snapshot" ? fixture() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("mounts through retained-only native status, exposes no control authority and performs no timer reads", async () => {
  const { unmount } = render(<DetachedStationStatusSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["station_status_snapshot"]]);
  expect(screen.getByRole("status").textContent).toContain("Observed current");
  expect(screen.getByText("14.074000 MHz")).toBeTruthy(); expect(value("PTT")).toBe("Receive");
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Show Desk", "Dock back", "Close Status"]);
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(native.invoke).toHaveBeenCalledOnce(); expect(native.worker).not.toHaveBeenCalled();
  expect(value("PTT")).toBe("Unavailable"); expect(value("Split")).toBe("Unavailable");
  expect(screen.getByRole("status").textContent).toContain("retained values are display only");
  unmount(); expect(native.stop).toHaveBeenCalledTimes(2);
});

it.each(["direct_agent", "direct_flex_lan", "hamlib"] as const)("follows exact retained %s selection without connecting or switching", async provider => {
  native.invoke.mockResolvedValue(fixture(provider));
  render(<DetachedStationStatusSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("Observed current");
  expect(value("PTT")).toBe("Receive"); expect(value("Split")).toBe("Off");
  const mismatch = fixture(provider, 2); mismatch.radio.selection_id = crypto.randomUUID();
  native.invoke.mockResolvedValue(mismatch);
  await act(async () => { wakes["xlog:station-selection"](); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).not.toContain("Observed current"); expect(value("PTT")).toBe("Unavailable");
  expect(screen.queryByText("14.074000 MHz")).toBeNull();
  expect(native.worker).not.toHaveBeenCalled();
});

it("does not refresh the age of cached source or Hamlib fields when a native projection is recent", async () => {
  const stale = fixture("hamlib"); stale.radio.snapshot.field_observed_at_ms.mode -= 20_000;
  native.invoke.mockResolvedValue(stale);
  render(<DetachedStationStatusSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).not.toContain("Observed current"); expect(value("PTT")).toBe("Unavailable");
});

it("keeps failed Dock/Close transitions open and uses only fixed native lifecycle routes", async () => {
  render(<DetachedStationStatusSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  native.invoke.mockImplementation(async command => {
    if (["dock_detached_window", "close_station_status_window"].includes(command)) throw new Error("Window unavailable");
    return command === "station_status_snapshot" ? fixture() : undefined;
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show Desk" })); });
  expect(native.invoke).toHaveBeenCalledWith("show_station_status_desk");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dock back" })); });
  expect(screen.getByRole("alert").textContent).toContain("Station Status remains open");
  expect(screen.getByRole("button", { name: "Close Status" }).hasAttribute("disabled")).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close Status" })); });
  expect(native.invoke).toHaveBeenCalledWith("close_station_status_window"); expect(native.worker).not.toHaveBeenCalled();
});
