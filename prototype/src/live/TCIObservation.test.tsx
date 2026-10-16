// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TCIObservation } from "./TCIObservation";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const snapshot = { source: "direct_tci", available: true, generated_at: 1000, radio: { connected: true, observed: true, observed_at: 1000, frequency_hz: 14025000, mode: "CW" }, station: { radio_stale: false } };
it("labels current versus retained data and ages without new native messages", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  render(<TCIObservation snapshot={snapshot} />);
  expect(screen.getByText(/Observed receive: 14.025000 MHz/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.getByRole("status").textContent).toContain("unavailable or stale");
  expect(screen.getByText(/Retained receive: 14.025000 MHz/)).toBeTruthy();
  expect(screen.queryByText(/Observed receive:/)).toBeNull();
});
it.each([null, { ...snapshot, available: false }, { ...snapshot, station: { radio_stale: true } }, { ...snapshot, generated_at: null }])("never labels unavailable or unverified TCI values current", value => {
  render(<TCIObservation snapshot={value} now={1000000} />);
  expect(screen.getByRole("status").textContent).toContain("unavailable or stale");
  expect(screen.queryByText(/Observed receive:/)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
