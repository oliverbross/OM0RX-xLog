// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Monitor from "./Monitor";
afterEach(cleanup);
const station = { kpa_operate: true, kpa_detail_primary: "Fixture amplifier", kat_detail_primary: "Fixture tuner", allowed_actions: ["standby"] };
it.each([null, "none", "hamlib", "direct_flex_lan", "direct_tci"])("hides agent hardware for %s", source => {
  render(<Monitor snapshot={{ source, station }} map={<div>Map</div>} onRequest={async () => ({})} />);
  expect(screen.queryByText(/KPA500/)).toBeNull(); expect(screen.queryByText(/KAT500/)).toBeNull();
  expect(screen.queryByText("Fixture amplifier")).toBeNull(); expect(screen.queryByRole("button", { name: "Standby" })).toBeNull();
});
it("shows amplifier and tuner observations only for the selected Remote Station Agent source", () => {
  render(<Monitor snapshot={{ source: "direct_agent", station }} map={<div>Map</div>} />);
  expect(screen.getByText(/KPA500/)).toBeTruthy(); expect(screen.getByText(/KAT500/)).toBeTruthy();
});
