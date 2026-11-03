// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AntennaDraftSelector, PortableContextBanner, PortableSettings, applyPortableDefaults } from "./PortableContextPanel";
import { antennaChoice, antennaHeading, rotorTarget } from "./equipmentPreferences";

afterEach(cleanup);
const profile = { id: "a", name: "Beam", antennaType: "yagi" as const, bands: ["20m"], azimuthOffsetDegrees: 20, revision: 1, archived: false };
const settings = { stationCall: "OM0RX", operatorCall: "OM0RX", gridSquare: "JN98", stationLocation: "Slovakia", defaultPower: "100",
  stationEquipment: { profiles: [profile], selectedProfileID: "a", automaticSelection: true, bandPreferences: {} },
  portableOperating: { version: 1, presets: [], activeContext: { sessionID: "session", revision: 0, startedAt: "2026-11-03T00:00:00Z",
    preset: { id: "p", name: "Park", stationCall: "VK8RX/P", operatorCall: "VK8RX", locator: "PH57", location: "Darwin", state: "NT", power: "10", ownDXCC: 150, ownReferences: { POTA: ["AU-0001", "AU-0002"] }, antennaProfileID: "a" } } } };
it("never changes a retained draft until explicit context application", () => {
  const draft = { call: "K1ABC", notes: "retained", extraFields: { APP_KEEP: "yes" } }, onApply = vi.fn(), onEnd = vi.fn();
  render(<PortableContextBanner settings={settings} draft={draft} onApply={onApply} onEnd={onEnd} />);
  expect(onApply).not.toHaveBeenCalled(); expect(onEnd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Apply portable defaults to current draft"));
  expect(onApply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ call: "K1ABC", notes: "retained", myCall: "VK8RX/P", myGrid: "PH57", extraFields: expect.objectContaining({ APP_KEEP: "yes", MY_SIG_INFO: "AU-0001,AU-0002", APP_OM0RXXLOG_ANTENNA_NAME: "Beam" }) }));
  expect(draft.extraFields).toEqual({ APP_KEEP: "yes" });
  fireEvent.click(screen.getByText("End portable context")); expect(onEnd).toHaveBeenCalledOnce();
});
it("returns home defaults only through explicit projection and preserves other metadata", () => {
  const portable = applyPortableDefaults({ call: "K1ABC", extraFields: { APP_KEEP: "yes" } }, settings);
  const home = applyPortableDefaults(portable, { ...settings, portableOperating: { version: 1, presets: [] } });
  expect(home.myCall).toBe("OM0RX"); expect(home.extraFields.MY_SIG_INFO).toBeUndefined(); expect(home.extraFields.APP_KEEP).toBe("yes");
  expect(portable.myCall).toBe("VK8RX/P");
  expect(portable.extraFields.MY_DXCC).toBe("150"); expect(home.extraFields.MY_DXCC).toBeUndefined();
});
it("requires a preference when TX-band profiles overlap and preserves stale/manual choices", () => {
  const equipment = { ...settings.stationEquipment, profiles: [profile, { ...profile, id: "b", name: "Other" }] };
  expect(antennaChoice(equipment, "20m", true).choices).toHaveLength(2);
  expect(antennaChoice({ ...equipment, bandPreferences: { "20m": "b" } }, "20m", true).selected?.id).toBe("b");
  expect(antennaChoice(equipment, "20m", false).selected?.id).toBe("a");
  expect(antennaChoice(equipment, "20m", true, true).selected?.id).toBe("a");
  expect(antennaHeading(350, 20)).toBe(10); expect(rotorTarget(10, 20)).toBe(350);
});
it("manual draft antenna selection records intent without a provider call", () => {
  const onApply = vi.fn(); render(<AntennaDraftSelector settings={settings} draft={{ call: "K1ABC", extraFields: {} }} txBand="20m" fresh onApply={onApply} />);
  expect(onApply).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText("Current draft antenna profile"), { target: { value: "a" } });
  expect(onApply.mock.calls[0][0].extraFields).toMatchObject({ APP_OM0RXXLOG_ANTENNA_ID: "a", APP_OM0RXXLOG_ANTENNA_MANUAL: "Y" });
});
it("maps an explicit antenna target once using its captured offset and observes without motion", () => {
  const onGoto = vi.fn(), onApply = vi.fn();
  const draft = { call: "K1ABC", extraFields: { APP_OM0RXXLOG_ANTENNA_ID: "a", APP_OM0RXXLOG_ANTENNA_NAME: "Beam", APP_OM0RXXLOG_ANTENNA_ROTOR: "workspace-rotor", APP_OM0RXXLOG_ANTENNA_OFFSET: "20" } };
  const rotor = { owner: "native_dcu1" as const, generation: 1, state: "active" as const, backend: { connected: true, azimuth: 350 } };
  const view = render(<AntennaDraftSelector settings={settings} draft={draft} txBand="20m" fresh onApply={onApply} rotor={rotor} onGoto={onGoto} />);
  expect(screen.getByText(/Rotor observed: 350° · Antenna observed: 10°/)).toBeTruthy(); expect(onGoto).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Desired antenna bearing"), { target: { value: "10" } }); expect(onGoto).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Turn antenna to bearing")); expect(onGoto).toHaveBeenCalledExactlyOnceWith(350);
  view.rerender(<AntennaDraftSelector settings={{ ...settings, stationEquipment: { ...settings.stationEquipment, profiles: [{ ...profile, name: "Renamed and archived", archived: true, azimuthOffsetDegrees: -45 }] } }} draft={draft} txBand="20m" fresh onApply={onApply} rotor={rotor} onGoto={onGoto} />);
  expect(onGoto).toHaveBeenCalledOnce(); expect(screen.getByText(/Antenna observed: 10°/)).toBeTruthy();
  expect(screen.getByText(/Captured for current draft: Beam/)).toBeTruthy(); expect(screen.getByText("Beam (retained snapshot)")).toBeTruthy();
});
it("starts a preset with canonical whole-second wire time and a copied snapshot", () => {
  const onChange = vi.fn(), preset = settings.portableOperating.activeContext.preset;
  render(<PortableSettings settings={{ ...settings, portableOperating: { version: 1, presets: [preset] } }} onChange={onChange} />);
  fireEvent.click(screen.getByText("Start context after saving"));
  const active = onChange.mock.calls[0][0].activeContext;
  expect(active.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(active.preset).toEqual(preset); expect(active.preset).not.toBe(preset);
});
