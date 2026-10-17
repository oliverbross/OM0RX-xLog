// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarStation } from "../LiveApp";

vi.mock("./stationSelection", () => ({ nativeStationSelection: () => true }));

afterEach(cleanup);

it("keeps an allowed native Operate transition independent of unrelated app work", () => {
  const onAction = vi.fn();
  render(<SidebarStation busy snapshot={{ station: { kpa_operate: false, allowed_actions: ["operate", "standby"] } }} provider="direct_agent" onAction={onAction} />);

  const operate = screen.getByRole("button", { name: "Switch to operate" });
  expect(operate.hasAttribute("disabled")).toBe(false);
  fireEvent.click(operate);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("operate");
});

it("still follows the Remote Agent's authoritative Operate permission", () => {
  render(<SidebarStation busy={false} snapshot={{ station: { kpa_operate: false, allowed_actions: ["standby"] } }} provider="direct_agent" onAction={() => {}} />);

  expect(screen.getByRole("button", { name: "Switch to operate" }).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Standby" })).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("shows one context-sensitive action when the amplifier is operating", () => {
  const onAction = vi.fn();
  render(<SidebarStation busy snapshot={{ station: { kpa_operate: true, allowed_actions: ["standby"] } }} provider="direct_agent" onAction={onAction} />);

  expect(screen.getAllByRole("button")).toHaveLength(1);
  const standby = screen.getByRole("button", { name: "Switch to standby" });
  expect(standby.hasAttribute("disabled")).toBe(false);
  fireEvent.click(standby);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("standby");
});
