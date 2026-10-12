// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceSettings from "./ServiceSettings";
import { DeskAntenna } from "./StationEquipment";
import { defaultEquipment, deskEquipmentKind, equipmentProfile, hasConfiguredRotor } from "./equipmentPreferences";
afterEach(() => { cleanup(); localStorage.clear(); });
describe("station equipment", () => {
  it("hides an unconfigured rotor and preserves owned Stop controls regardless of display preference", () => {
    expect(hasConfiguredRotor(localStorage)).toBe(false);
    expect(deskEquipmentKind(defaultEquipment, null, false)).toBe("none");
    expect(deskEquipmentKind(defaultEquipment, null, true)).toBe("rotor");
    for (const display of ["automatic", "antenna", "hidden"] as const) {
      expect(deskEquipmentKind({ ...defaultEquipment, display }, { owner: "hamlib", generation: 2, state: "uncertain" }, false)).toBe("rotor");
    }
    expect(deskEquipmentKind({ ...defaultEquipment, display: "antenna" }, null, false)).toBe("antenna");
    expect(deskEquipmentKind({ ...defaultEquipment, display: "hidden" }, null, true)).toBe("none");
  });
  it("detects saved rotor setup without treating an empty form or selection alone as configured", () => {
    localStorage.setItem("xlog.rotor.host", "host.example");
    expect(hasConfiguredRotor(localStorage)).toBe(true);
    localStorage.setItem("xlog.integration.rotor", "hamlib");
    expect(hasConfiguredRotor(localStorage)).toBe(false);
    localStorage.setItem("xlog.hamlib.rotor", JSON.stringify({ mode: "managed", model: 1, path: "/dev/test" }));
    expect(hasConfiguredRotor(localStorage)).toBe(true);
    localStorage.setItem("xlog.hamlib.rotor", "malformed");
    expect(hasConfiguredRotor(localStorage)).toBe(false);
  });
  it("shows configured bands and identity without fabricated live state or controls", () => {
    const profile = equipmentProfile({ display: "antenna", antenna: "vertical", name: "Garden vertical", bands: ["20m", "17m", "15m", "12m", "10m", "20m", "invalid"] });
    render(<DeskAntenna profile={profile} />);
    expect(screen.getByText("Garden vertical")).toBeTruthy();
    expect(screen.getByText("Configured · no telemetry")).toBeTruthy();
    expect(screen.getAllByText("20m")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/connected/i)).toBeNull();
    expect(profile.bands).toEqual(["20m", "17m", "15m", "12m", "10m"]);
  });
  it("edits antenna settings without hardware requests and saves only explicitly", async () => {
    const values = { stationCall: "OM0RX", logbookMode: "local" };
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Operator Desk equipment"), { target: { value: "antenna" } });
    fireEvent.change(screen.getByLabelText("Antenna type"), { target: { value: "wire" } });
    fireEvent.change(screen.getByLabelText("Antenna name"), { target: { value: "Garden wire" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "20m" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "10m" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rotator" }));
    fireEvent.click(screen.getByRole("tab", { name: "Station" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith("settings_save", { settings: { ...values, stationEquipment: { display: "antenna", antenna: "wire", name: "Garden wire", bands: ["20m", "10m"] } } }));
  });
});
