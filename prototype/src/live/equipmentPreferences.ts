import type { RotorSnapshot } from "./rotorControl";
import type { RotorConfiguration } from "./rotorConfigurationSession";

export const antennaTypes = { vertical: "Vertical", wire: "Long wire / end-fed", dipole: "Dipole", yagi: "Yagi / beam", loop: "Loop", other: "Other antenna" } as const;
export const antennaBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
export type AntennaProfile = { id: string; name: string; antennaType: keyof typeof antennaTypes; bands: string[]; rotorConfigurationID?: string | null; azimuthOffsetDegrees: number; revision: number; archived: boolean };
export type StationEquipment = { display: "automatic" | "antenna" | "hidden"; antenna: keyof typeof antennaTypes; name: string; bands: string[];
  version?: number; profiles?: AntennaProfile[]; selectedProfileID?: string | null; automaticSelection?: boolean; bandPreferences?: Record<string, string> };
export const defaultEquipment: StationEquipment = { display: "automatic", antenna: "vertical", name: "", bands: [] };
export function equipmentProfile(value: unknown): StationEquipment {
  const v = value as Partial<StationEquipment> | null;
  return { ...v, display: v?.display === "antenna" || v?.display === "hidden" ? v.display : "automatic",
    antenna: v?.antenna && Object.hasOwn(antennaTypes, v.antenna) ? v.antenna : "vertical",
    name: typeof v?.name === "string" ? v.name.slice(0, 64) : "",
    bands: Array.isArray(v?.bands) ? antennaBands.filter(band => v.bands!.includes(band)) : [] };
}
export function antennaCollection(value: unknown): StationEquipment & { profiles: AntennaProfile[]; bandPreferences: Record<string, string> } {
  const v = equipmentProfile(value);
  return { ...v, version: 1, profiles: v.profiles ?? [{ id: "legacy-antenna", name: v.name || "Station antenna", antennaType: v.antenna, bands: v.bands, azimuthOffsetDegrees: 0, revision: 0, archived: false }],
    selectedProfileID: v.selectedProfileID === undefined ? (v.profiles?.[0]?.id ?? "legacy-antenna") : v.selectedProfileID, automaticSelection: v.automaticSelection ?? false, bandPreferences: v.bandPreferences ?? {} };
}
export function selectedAntenna(value: unknown): AntennaProfile | undefined {
  const v = antennaCollection(value); return v.profiles.find(p => p.id === v.selectedProfileID && !p.archived);
}
export function antennaChoice(value: unknown, txBand: string | null, fresh: boolean, manualOverride = false): { selected?: AntennaProfile; choices: AntennaProfile[]; reason: string } {
  const v = antennaCollection(value), current = selectedAntenna(value);
  if (!v.automaticSelection || manualOverride || !fresh || !txBand) return { selected: current, choices: [], reason: manualOverride ? "Manual override" : "Current profile; transmit band not applied" };
  const eligible = v.profiles.filter(p => !p.archived && p.bands.includes(txBand));
  const preferred = eligible.find(p => p.id === v.bandPreferences[txBand]);
  if (preferred || eligible.length === 1) return { selected: preferred ?? eligible[0], choices: [], reason: `Transmit band ${txBand}` };
  return { selected: current, choices: eligible, reason: eligible.length ? "Choose a profile for the transmit band" : "Current profile; no band match" };
}
export const antennaHeading = (observed: number, offset: number) => ((observed + offset) % 360 + 360) % 360;
export const rotorTarget = (antennaBearing: number, offset: number) => ((antennaBearing - offset) % 360 + 360) % 360;
export function hasConfiguredRotor(configuration: RotorConfiguration | null | undefined): boolean {
  if (!configuration) return false;
  return configuration.owner === "native_dcu1" ? !!configuration.native_dcu1.host.trim()
    : configuration.hamlib.mode === "external" ? !!configuration.hamlib.host.trim() && configuration.hamlib.port > 0
      : configuration.hamlib.model === 1 || !!configuration.hamlib.model && configuration.hamlib.model > 1 && !!configuration.hamlib.path.trim();
}
export function deskEquipmentKind(profile: StationEquipment, rotor: RotorSnapshot | null, configured: boolean): "rotor" | "antenna" | "none" {
  // A live or uncertain owner always retains its Stop controls. Display settings
  // cannot silently hide, disconnect, or relinquish an owned rotor session.
  if (rotor?.owner) return "rotor";
  return profile.display === "antenna" ? "antenna" : profile.display === "automatic" && configured ? "rotor" : "none";
}
