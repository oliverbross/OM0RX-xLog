// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import StationPanel from "../src/live/StationPanel";

afterEach(() => cleanup());

it("reads observed state without connecting or commanding radio or rotor", async () => {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    expect(method).toBe("station_snapshot");
    return { source: params?.provider, available: false, radio: null, station: null, rotor: null };
  });
  const publish = vi.fn();
  render(<StationPanel snapshot={null} onRequest={request} onSnapshot={publish} />);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.getByText("No observed radio")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "xCat companion" })).toBeNull();
  await waitFor(() => expect(request).toHaveBeenCalledWith("station_snapshot", { provider: "direct_agent" }));
  expect(request.mock.calls.every(([method]) => method === "station_snapshot")).toBe(true);
});

it("keeps a detached monitor read-only", async () => {
  const request = vi.fn(async () => ({ source: "direct_agent", available: false, radio: null, station: null, rotor: null }));
  render(<StationPanel snapshot={null} onRequest={request} onSnapshot={vi.fn()} monitor />);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "PTT on" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Go to" })).toBeNull();
});

it("keeps explicit safety release available when radio observation becomes stale", async () => {
  const stale = { source: "direct_agent", available: true, allow_transmit: true,
    radio: { connected: true, observed: true, transmitting: true, frequency_hz: 14_074_000 },
    station: { commissioned: true, radio_known: true, radio_stale: true,
      supported_commands: ["set_ptt", "clear_cw"], inhibitors: [] }, rotor: null };
  const request = vi.fn(async (_method: string) => stale);
  render(<StationPanel snapshot={stale} onRequest={request} onSnapshot={vi.fn()} />);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect((screen.getByRole("button", { name: "PTT on" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "PTT off" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Clear CW" }) as HTMLButtonElement).disabled).toBe(false);
  expect(request.mock.calls.every(([method]) => method === "station_snapshot")).toBe(true);
});
