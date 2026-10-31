// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarStation } from "../LiveApp";

vi.mock("./stationSelection", () => ({ nativeStationSelection: () => true }));

afterEach(cleanup);

it("keeps an allowed native Operate transition independent of unrelated app work", () => {
  const onAction = vi.fn();
  render(<SidebarStation busy snapshot={{ source: "direct_agent", station: { kpa_operate: false, allowed_actions: ["operate", "standby"] } }} provider="direct_agent" onAction={onAction} />);

  const operate = screen.getByRole("button", { name: "Switch to operate" });
  expect(operate.hasAttribute("disabled")).toBe(false);
  fireEvent.click(operate);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("operate");
});

it("still follows the Remote Agent's authoritative Operate permission", () => {
  render(<SidebarStation busy={false} snapshot={{ source: "direct_agent", station: { kpa_operate: false, allowed_actions: ["standby"] } }} provider="direct_agent" onAction={() => {}} />);

  expect(screen.getByRole("button", { name: "Switch to operate" }).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Standby" })).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("shows one context-sensitive action when the amplifier is operating", () => {
  const onAction = vi.fn();
  render(<SidebarStation busy snapshot={{ source: "direct_agent", station: { kpa_operate: true, allowed_actions: ["standby"] } }} provider="direct_agent" onAction={onAction} />);

  expect(screen.getAllByRole("button")).toHaveLength(1);
  const standby = screen.getByRole("button", { name: "Switch to standby" });
  expect(standby.hasAttribute("disabled")).toBe(false);
  fireEvent.click(standby);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("standby");
});

it.each([null, "none", "hamlib", "direct_flex_lan", "direct_tci"])("requires matching Agent evidence before showing amplifier details or controls (source=%s)", source => {
  render(<SidebarStation busy={false} snapshot={{ source, station: { kpa_operate: true, kpa_detail_primary: "Fixture amplifier", allowed_actions: ["operate", "standby"] } }} provider="direct_agent" onAction={() => {}} />);
  expect(screen.queryByText(/KPA500/)).toBeNull();
  expect(screen.queryByText("Fixture amplifier")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
