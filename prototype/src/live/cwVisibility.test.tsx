// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CWDesk from "./CWDesk";
import { defaultCWProfile } from "./cwMacros";
import type { CWState } from "./cwController";
import { providerAllowsCWDesk } from "./cwVisibility";
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const idle: CWState & { lease?: string | null } = { armed: false, pending: false, owner: null, message: "", error: "", winkeyer: null };
const radioOwner = { output: "radio" as const, provider: "direct_agent", generation: 1, limit: 128 };
const controller = () => ({ arm: vi.fn(async () => {}), send: vi.fn(async () => {}), stop: vi.fn(async () => {}), acknowledgeStopped: vi.fn() });
it("TCI hides idle radio CW, not independent WinKeyer", () => {
  expect(providerAllowsCWDesk("direct_tci", "radio", idle)).toBe(false);
  expect(providerAllowsCWDesk("direct_tci", "winkeyer", idle)).toBe(true);
  expect(providerAllowsCWDesk("direct_agent", "radio", idle)).toBe(true);
  const actions = controller();
  render(<CWDesk profile={{ ...defaultCWProfile, output: "winkeyer", showOnDesk: true }} context={{}} controller={actions} state={idle} radioProvider="direct_tci" />);
  fireEvent.click(screen.getByRole("button", { name: "Arm CW" })); expect(actions.arm).toHaveBeenCalledTimes(1);
});
it.each([{ armed: true }, { owner: radioOwner }, { lease: "retained-lease" }, { pending: true }])("TCI preserves existing CW Stop duty %j without radio acquisition", obligation => {
  const state = { ...idle, ...obligation }, actions = controller();
  expect(providerAllowsCWDesk("direct_tci", "radio", state)).toBe(true);
  render(<CWDesk profile={{ ...defaultCWProfile, showOnDesk: true }} context={{}} controller={actions} state={state} radioProvider="direct_tci" releaseOnly />);
  const stop = screen.getByRole("button", { name: "Stop" }); expect(stop.hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  const arm = screen.queryByRole("button", { name: "Arm CW" }); if (arm) { expect(arm.hasAttribute("disabled")).toBe(true); fireEvent.click(arm); }
  fireEvent.click(stop); expect(actions.stop).toHaveBeenCalledTimes(1); expect(actions.arm).not.toHaveBeenCalled(); expect(actions.send).not.toHaveBeenCalled();
});
it("retained CW review remains visible in release-only TCI mode", () => {
  render(<CWDesk profile={defaultCWProfile} context={{}} controller={controller()} state={{ ...idle, owner: radioOwner, error: "Stop unconfirmed" }} radioProvider="direct_tci" releaseOnly />);
  expect(screen.getByText("Stop unconfirmed")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Release CW guard" })).toBeTruthy();
});
