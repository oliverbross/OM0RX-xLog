import type { RotorSnapshot } from "./rotorControl";

export const antennaTypes = { vertical: "Vertical", wire: "Long wire / end-fed", dipole: "Dipole", yagi: "Yagi / beam", loop: "Loop", other: "Other antenna" } as const;
export const antennaBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
export type StationEquipment = { display: "automatic" | "antenna" | "hidden"; antenna: keyof typeof antennaTypes; name: string; bands: string[] };
export const defaultEquipment: StationEquipment = { display: "automatic", antenna: "vertical", name: "", bands: [] };
export function equipmentProfile(value: unknown): StationEquipment {
  const v = value as Partial<StationEquipment> | null;
  return { display: v?.display === "antenna" || v?.display === "hidden" ? v.display : "automatic",
    antenna: v?.antenna && Object.hasOwn(antennaTypes, v.antenna) ? v.antenna : "vertical",
    name: typeof v?.name === "string" ? v.name.slice(0, 64) : "",
    bands: Array.isArray(v?.bands) ? antennaBands.filter(band => v.bands!.includes(band)) : [] };
}
export function hasConfiguredRotor(storage: Pick<Storage, "getItem">): boolean {
  try {
    const selected = storage.getItem("xlog.integration.rotor");
    if (selected !== "hamlib") return !!storage.getItem("xlog.rotor.host")?.trim();
    const config = JSON.parse(storage.getItem("xlog.hamlib.rotor") || "null");
    return !!config && (config.mode === "external" ? !!config.host && Number(config.port) > 0 : Number(config.model) === 1 || Number(config.model) > 1 && !!config.path);
  } catch { return false; }
}
export function deskEquipmentKind(profile: StationEquipment, rotor: RotorSnapshot | null, configured: boolean): "rotor" | "antenna" | "none" {
  // A live or uncertain owner always retains its Stop controls. Display settings
  // cannot silently hide, disconnect, or relinquish an owned rotor session.
  if (rotor?.owner) return "rotor";
  return profile.display === "antenna" ? "antenna" : profile.display === "automatic" && configured ? "rotor" : "none";
}
