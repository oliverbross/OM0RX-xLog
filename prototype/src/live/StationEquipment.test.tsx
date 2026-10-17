// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceSettings from "./ServiceSettings";
import { DeskAntenna } from "./StationEquipment";
import { defaultEquipment, deskEquipmentKind, equipmentProfile, hasConfiguredRotor } from "./equipmentPreferences";
import { defaultRotorConfiguration } from "./rotorConfigurationSession";
afterEach(() => { cleanup(); localStorage.clear(); });
describe("station equipment", () => {
  it("hides an unconfigured rotor and preserves owned Stop controls regardless of display preference", () => {
    expect(hasConfiguredRotor(defaultRotorConfiguration())).toBe(false);
    expect(deskEquipmentKind(defaultEquipment, null, false)).toBe("none");
    expect(deskEquipmentKind(defaultEquipment, null, true)).toBe("rotor");
    for (const display of ["automatic", "antenna", "hidden"] as const) {
      expect(deskEquipmentKind({ ...defaultEquipment, display }, { owner: "hamlib", generation: 2, state: "uncertain" }, false)).toBe("rotor");
    }
    expect(deskEquipmentKind({ ...defaultEquipment, display: "antenna" }, null, false)).toBe("antenna");
    expect(deskEquipmentKind({ ...defaultEquipment, display: "hidden" }, null, true)).toBe("none");
  });
  it("detects shared rotor setup without treating an empty form or selection alone as configured", () => {
    const native = defaultRotorConfiguration(); native.native_dcu1.host = "host.example";
    expect(hasConfiguredRotor(native)).toBe(true);
    const hamlib = defaultRotorConfiguration(); hamlib.owner = "hamlib";
    expect(hasConfiguredRotor(hamlib)).toBe(false);
    hamlib.hamlib.model = 1; hamlib.hamlib.path = "/dev/test";
    expect(hasConfiguredRotor(hamlib)).toBe(true);
    expect(hasConfiguredRotor(null)).toBe(false);
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
    const values = { stationCall: "OM0RX", logbookMode: "local", wavelogStationID: 1 };
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    function Editor() {
      const [draft, setDraft] = useState<Record<string, any>>(values);
      return <ServiceSettings values={draft} request={request} onChanged={setDraft}
        onSave={settings => request("settings_save", { settings }).then(() => {})} />;
    }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Operator Desk equipment"), { target: { value: "antenna" } });
    fireEvent.change(screen.getByLabelText("Antenna type"), { target: { value: "wire" } });
    fireEvent.change(screen.getByLabelText("Antenna name"), { target: { value: "Garden wire" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "20m" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "10m" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rotator" }));
  fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith("settings_save", { settings: { ...values, stationEquipment: { display: "antenna", antenna: "wire", name: "Garden wire", bands: ["20m", "10m"] } } }));
  });
});
