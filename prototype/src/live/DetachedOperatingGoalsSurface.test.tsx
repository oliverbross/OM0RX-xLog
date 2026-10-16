// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetachedOperatingGoalsSurface, OperatingGoalsSurface } from "./DetachedOperatingGoalsSurface";
import { loadWindowSurface } from "../windowSurface";

afterEach(cleanup);
const result: any = { evaluated_at: 1_800_000_000, station_scope: { profile_id: null, callsign: null, all_stations: true },
  sources: { contacts: { state: "retained", count: 42 }, opportunities: { state: "retained", count: 3 }, cluster_observations: { state: "not_included", count: 0 } },
  evaluations: [{ goal: { id: "call:K1ABC", type: "callsign", callsign: "K1ABC" }, worked: true, worked_count: 2, confirmed: false, confirmed_count: 0,
    evidence_eligible: null, credited: null, reasons: ["Worked locally.", "No confirmation recorded.", "Sponsor status not assessed."],
    evidence: [{ id: "one", source: "Retained source", source_url: "", callsign: "K1ABC", reference: "", band: "20m", mode: "CW",
      observed_at: 1_799_999_970, time_basis: "publisher_observed_at", expires_at: 1_800_000_090, starts_at: null, age_seconds: 30, freshness: "active",
      reason: "Current activity is unverified." }] }], read_only: true, tunes: false, transmits: false };

it("loads as a direct detached route with no redundant page header", async () => {
  expect(await loadWindowSurface("?view=operating-goals")).toBe(DetachedOperatingGoalsSurface);
  render(<OperatingGoalsSurface evaluate={vi.fn()} />);
  expect(screen.getByRole("main", { name: "Operating Goals" })).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByText(/retained local contacts/)).toBeTruthy();
});

it("evaluates explicit targets and explains local, sponsor, freshness and source boundaries", async () => {
  const evaluate = vi.fn(async () => result);
  render(<OperatingGoalsSurface evaluate={evaluate} />);
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "k1abc" } });
  fireEvent.click(screen.getByRole("button", { name: "Add target" }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate selected" }));
  await screen.findByRole("heading", { name: "K1ABC" });
  expect(evaluate).toHaveBeenCalledWith([{ type: "callsign", callsign: "K1ABC" }], { profileID: undefined, stationCall: undefined });
  expect(screen.getByText("Yes · 2")).toBeTruthy();
  expect(screen.getByText("No")).toBeTruthy();
  expect(screen.getAllByText("Unknown")).toHaveLength(2);
  expect(screen.getByText(/Retained source · 30s old/)).toBeTruthy();
  expect(screen.getByText(/Publisher observed time/)).toBeTruthy();
  expect(screen.getAllByText("Not included")).toHaveLength(1);
  expect(screen.getByText(/never refreshes feeds/)).toBeTruthy();
});

it("drops a stale evaluation when scope changes before it completes", async () => {
  let resolve!: (value: any) => void; const evaluate = vi.fn(() => new Promise<any>(done => { resolve = done; }));
  render(<OperatingGoalsSurface evaluate={evaluate} />);
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "K1ABC" } }); fireEvent.click(screen.getByRole("button", { name: "Add target" }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate selected" }));
  fireEvent.change(screen.getByLabelText("Station callsign"), { target: { value: "OM0RX" } });
  await act(async () => { resolve(result); });
  expect(screen.queryByRole("heading", { name: "K1ABC" })).toBeNull();
});
