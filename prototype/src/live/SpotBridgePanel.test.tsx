// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SpotBridgePanel, { spotCategories, validSpotConfiguration } from "./SpotBridgePanel";

const configuration = () => ({ enabled: false, logbookPort: 12062, contestPort: 12063,
  styles: Object.fromEntries(spotCategories.map(([key]) => [key, { priority: 3, colorHex: "#0A84FF", lifetimeSeconds: 600 }])) });
const snapshot = () => ({ configuration: configuration(), running: false, received_count: 0, accepted_count: 0,
  rejected_count: 0, duplicate_count: 0, status: "Off", display_confirmed: false });
afterEach(cleanup);
describe("integrated RUMlog spot settings", () => {
  it("loads all native categories without opening a listener or forwarding a spot", async () => {
    const request = vi.fn(async () => snapshot()); render(<SpotBridgePanel request={request} />);
    await screen.findByLabelText("Unknown Contest priority");
    expect(screen.getAllByRole("combobox")).toHaveLength(11);
    expect(request.mock.calls).toEqual([["spot_bridge_snapshot"]]);
    expect(screen.getByText(/not that its marker has been visually inspected/)).toBeTruthy();
  });
  it("saves the exact styles object before explicitly starting", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "spot_bridge_configure"
      ? { ...snapshot(), configuration: params!.configuration } : { ...snapshot(), running: method === "spot_bridge_start" });
    render(<SpotBridgePanel request={request} />);
    const lifetime = await screen.findByLabelText("DXCC not confirmed Logbook lifetime seconds");
    fireEvent.change(lifetime, { target: { value: "1800" } });
    fireEvent.change(screen.getByLabelText("DXCC not confirmed Logbook colour"), { target: { value: "#ff453a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and start listeners" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("spot_bridge_start"));
    const saved = request.mock.calls.find(([method]) => method === "spot_bridge_configure")![1]!.configuration;
    expect(saved.enabled).toBe(true); expect(Object.keys(saved.styles)).toHaveLength(11);
    expect(saved.styles.dxccNotConfirmed).toEqual({ priority: 3, colorHex: "#FF453A", lifetimeSeconds: 1800 });
    expect(request.mock.calls.map(([method]) => method)).toEqual(["spot_bridge_snapshot", "spot_bridge_configure", "spot_bridge_start"]);
  });
  it("never starts after a rejected settings save", async () => {
    const request = vi.fn(async (method: string) => { if (method === "spot_bridge_configure") throw new Error("Port settings rejected"); return snapshot(); });
    render(<SpotBridgePanel request={request} />); await screen.findByLabelText("Logbook UDP port");
    fireEvent.click(screen.getByRole("button", { name: "Save and start listeners" }));
    await screen.findByText("Port settings rejected");
    expect(request).not.toHaveBeenCalledWith("spot_bridge_start");
  });
  it("blocks invalid or colliding ports and incomplete style values", async () => {
    expect(validSpotConfiguration(configuration())).toBe(true);
    expect(validSpotConfiguration({ ...configuration(), contestPort: 12062 })).toBe(false);
    expect(validSpotConfiguration({ ...configuration(), logbookPort: 1023 })).toBe(false);
    expect(validSpotConfiguration({ ...configuration(), logbookPort: 1024 })).toBe(true);
    expect(validSpotConfiguration({ ...configuration(), styles: {} })).toBe(false);
    const invalid = configuration(); invalid.styles.other.lifetimeSeconds = 0;
    expect(validSpotConfiguration(invalid)).toBe(false);
    render(<SpotBridgePanel request={vi.fn(async () => snapshot())} />);
    fireEvent.change(await screen.findByLabelText("Contest UDP port"), { target: { value: "12062" } });
    expect(screen.getByRole("button", { name: "Save and start listeners" }).hasAttribute("disabled")).toBe(true);
  });
  it("only starts with the embedded Remote Agent provider and does not stop an existing listener on handover", async () => {
    const request = vi.fn(async (_method: string) => ({ ...snapshot(), running: true }));
    const view = render(<SpotBridgePanel request={request} provider="direct_flex_lan" />);
    await screen.findByLabelText("Logbook UDP port");
    expect(screen.getByText(/Direct FLEX LAN and Hamlib do not receive these UDP spots/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and start listeners" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Stop listeners" }).hasAttribute("disabled")).toBe(false);
    expect(request.mock.calls.map(([method]) => method)).toEqual(["spot_bridge_snapshot"]);
    view.rerender(<SpotBridgePanel request={request} provider="direct_agent" />);
    expect(screen.getByRole("button", { name: "Save and start listeners" }).hasAttribute("disabled")).toBe(false);
    expect(request.mock.calls.map(([method]) => method)).toEqual(["spot_bridge_snapshot"]);
  });
});
