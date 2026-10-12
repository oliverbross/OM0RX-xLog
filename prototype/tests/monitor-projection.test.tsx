// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const bridge = vi.hoisted(() => ({
  request: vi.fn(), ready: vi.fn(),
  receive: null as null | ((value: unknown) => void),
  stop: vi.fn(),
}));
vi.mock("../src/worker", async importOriginal => ({
  ...await importOriginal<typeof import("../src/worker")>(),
  workerRequest: bridge.request,
  onMonitorProjection: vi.fn(async (receive: (value: unknown) => void) => { bridge.receive = receive; return bridge.stop; }),
  announceMonitorReady: bridge.ready,
}));
vi.mock("../src/Map", () => ({ default: (props: any) => <div data-testid="projected-map">
  {props.data.length} spots · {props.home?.call} · {props.target?.call} · {props.selected} · {props.palette?.status?.Worked}
</div> }));

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); bridge.receive = null; bridge.request.mockReset(); bridge.ready.mockReset(); bridge.stop.mockReset(); });

it("monitor consumes main projection without starting station, cluster, or logbook polling", async () => {
  window.history.replaceState({}, "", "/?view=monitor");
  bridge.ready.mockResolvedValue(undefined);
  bridge.request.mockResolvedValue({ result: { accepted: true, confirmed: false } });
  const { default: LiveApp } = await import("../src/LiveApp");
  render(<LiveApp />);
  await waitFor(() => expect(bridge.ready).toHaveBeenCalledOnce());
  await new Promise(resolve => setTimeout(resolve, 1_100));
  expect(bridge.request).not.toHaveBeenCalled();
  act(() => bridge.receive?.({ spots: [{ id: "spot-1", callsign: "EA7EU", frequencyKHz: 14025, latitude: 37, longitude: -6 }],
    station: { source: "direct_agent", radio: { connected: true, observed: true, mode: "CW", frequency_hz: 14025000 },
      station: { allowed_actions: ["operate"], kpa_operate: false }, rotor: { connected: false } },
    provider: "direct_agent", controlsEnabled: true, selected: "spot-1",
    home: { call: "OM0RX", lat: -12.4, lon: 130.8 }, target: { call: "EA7EU", lat: 37, lon: -6 },
    palette: { status: { Worked: "#123456" } } }));
  expect(screen.getByTestId("projected-map").textContent).toContain("1 spots · OM0RX · EA7EU · spot-1 · #123456");
  expect(screen.getByText("A: —")).toBeTruthy();
  expect(screen.getByText("PTT UNKNOWN")).toBeTruthy();
  expect(bridge.request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Operate" }));
  expect(bridge.request).toHaveBeenCalledWith("station_action", { provider: "direct_agent", action: "operate" });
  expect(bridge.request).toHaveBeenCalledTimes(1);
  act(() => bridge.receive?.({ spots: [], station: null, provider: "hamlib", controlsEnabled: false }));
  expect(screen.queryByRole("button", { name: "Operate" })).toBeNull();
  bridge.request.mockResolvedValue({ result: { state: "accepted" } });
  act(() => bridge.receive?.({ spots: [], provider: "hamlib", controlsEnabled: true,
    station: { source: "hamlib", radio: { connected: true, observed: true, mode: "CW", frequency_hz: 14025000 },
      station: { allowed_actions: [] }, rotor: { connected: true, azimuth: 90 } } }));
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(bridge.request).toHaveBeenLastCalledWith("hamlib_control", { device: "rotor", action: "stop" });
  expect(bridge.request.mock.calls.some(([method]) => method === "hamlib_snapshot" || method === "station_snapshot")).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 6_100));
  expect(screen.getByText(/Main station observation is stale/)).toBeTruthy();
  expect(screen.getByText("OFFLINE")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(bridge.request).toHaveBeenCalledTimes(2);
}, 12_000);
