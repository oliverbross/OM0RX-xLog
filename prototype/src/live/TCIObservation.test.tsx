// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TCIObservation } from "./TCIObservation";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const snapshot = { source: "direct_tci", available: true, generated_at: 1000, radio: { connected: true, observed: true, observed_at: 1000, frequency_hz: 14025000, mode: "CW" }, station: { radio_stale: false } };
it("observes split independently and never infers TX frequency from receive or split", () => {
  const split = { ...snapshot, radio: { ...snapshot.radio, split: true }, tci: { trx: 0, channel: 1, split_observed_at: 1000 } };
  const view = render(<TCIObservation snapshot={split} now={1000000} />);
  expect(screen.getByText("Observed split: On")).toBeTruthy();
  expect(screen.getByText(/Saved TRX 0 · receive channel 1/)).toBeTruthy();
  expect(screen.getByText(/TX VFO and transmit frequency: Unavailable/)).toBeTruthy();
  view.rerender(<TCIObservation snapshot={{ ...split, generated_at: 1010, radio: { ...split.radio, observed_at: 1010 } }} now={1010000} />);
  expect(screen.getByText("Retained split: On · stale or unverified")).toBeTruthy();
  expect(screen.queryByText(/Observed split:/)).toBeNull();
  view.rerender(<TCIObservation snapshot={{ ...split, tci: { ...split.tci, split_observed_at: null } }} now={1000000} />);
  expect(screen.getByText("Retained split: On · stale or unverified")).toBeTruthy();
});
it("labels absent split unknown and stale false split retained", () => {
  const view = render(<TCIObservation snapshot={snapshot} now={1000000} />);
  expect(screen.getByText("Split: Unknown · no authoritative report")).toBeTruthy();
  view.rerender(<TCIObservation snapshot={{ ...snapshot, available: false, radio: { ...snapshot.radio, split: false }, tci: { split_observed_at: 1000 } }} now={1000000} />);
  expect(screen.getByText("Retained split: Off · stale or unverified")).toBeTruthy();
});
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
  expect((screen.getByRole("button", { name: "Apply receive filter" }) as HTMLButtonElement).disabled).toBe(true);
});
