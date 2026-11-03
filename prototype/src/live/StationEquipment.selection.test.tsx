// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ServiceSettings from "./ServiceSettings";
import { EquipmentSettings } from "./StationEquipment";
import { antennaCollection, type StationEquipment } from "./equipmentPreferences";

afterEach(() => { cleanup(); localStorage.clear(); });
const equipment = (): StationEquipment => ({ display: "antenna", antenna: "yagi", name: "Home beam", bands: ["20m"],
  version: 1, selectedProfileID: "beam", automaticSelection: true, bandPreferences: { "20m": "beam" },
  profiles: [
    { id: "beam", name: "Home beam", antennaType: "yagi", bands: ["20m"], azimuthOffsetDegrees: 15, revision: 2, archived: false },
    { id: "wire", name: "Portable wire", antennaType: "wire", bands: ["40m"], azimuthOffsetDegrees: 0, revision: 1, archived: false },
  ],
});
it("persists No selected profile through the actual settings dropdown/save/reload without changing definitions or invoking contact mutations", async () => {
  const original = equipment();
  let persisted = { stationCall: "OM0RX", logbookMode: "local", wavelogStationID: 1, stationEquipment: original };
  const request = vi.fn(async (method: string, params?: Record<string, any>) => {
    if (method !== "settings_save") throw Error("Unexpected request: " + method);
    persisted = structuredClone(params!.settings);
    return { settings: persisted };
  });
  function Editor() {
    const [draft, setDraft] = useState<Record<string, any>>(() => structuredClone(persisted));
    return <ServiceSettings values={draft} request={request} onChanged={setDraft}
      onSave={settings => request("settings_save", { settings }).then(() => {})} />;
  }
  let panel = render(<Editor />);
  const dropdown = screen.getByLabelText("Antenna profile") as HTMLSelectElement;
  expect(dropdown.value).toBe("beam");
  fireEvent.change(dropdown, { target: { value: "" } });
  expect(dropdown.value).toBe("");
  expect(screen.queryByLabelText("Profile name")).toBeNull();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(persisted.stationEquipment).toEqual({ ...original, selectedProfileID: null });
  panel.unmount(); panel = render(<Editor />);
  expect((screen.getByLabelText("Antenna profile") as HTMLSelectElement).value).toBe("");
  expect(antennaCollection(persisted.stationEquipment).selectedProfileID).toBeNull();
  expect((screen.getByRole("button", { name: "Duplicate profile" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Antenna profile"), { target: { value: "wire" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(persisted.stationEquipment).toMatchObject({ selectedProfileID: "wire", name: "Portable wire", antenna: "wire", bands: ["40m"] });
  expect(persisted.stationEquipment.profiles).toEqual(original.profiles);
  expect(request.mock.calls.map(([method]) => method)).toEqual(["settings_save", "settings_save"]);
  panel.unmount(); render(<Editor />);
  expect((screen.getByLabelText("Antenna profile") as HTMLSelectElement).value).toBe("wire");
});
it.each(["missing-profile", "archived-profile"])("shows a stale %s selection explicitly and allows a deliberate null selection", id => {
  const value = equipment();
  value.selectedProfileID = id;
  value.profiles!.push({ ...value.profiles![0], id: "archived-profile", archived: true });
  const definitions = structuredClone(value.profiles);
  const changed = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState(value);
    return <EquipmentSettings value={draft} onChange={next => { changed(next); setDraft(next); }} />;
  }
  render(<Editor />);
  const dropdown = screen.getByLabelText("Antenna profile") as HTMLSelectElement;
  expect(dropdown.value).toBe(id);
  expect((screen.getByRole("option", { name: `Unavailable profile (${id})` }) as HTMLOptionElement).disabled).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Profile name")).toBeNull();
  fireEvent.change(dropdown, { target: { value: "" } });
  expect(changed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedProfileID: null, profiles: definitions }));
  expect(dropdown.value).toBe("");
  expect(value.profiles).toEqual(definitions);
});
