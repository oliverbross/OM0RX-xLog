import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { antennaBands, antennaTypes, type StationEquipment } from "./equipmentPreferences";
export type SavedAntenna = StationEquipment & { worker_generation: number; workspace_generation: string; settings_revision: number };
export type AntennaSnapshot = { epoch: string; revision: number; available: boolean; snapshot: SavedAntenna | null };
type Adapter = { read: () => Promise<unknown>; listen: (wake: () => void) => Promise<() => void> };
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function checked(input: unknown): AntennaSnapshot {
  const value = input as AntennaSnapshot, profile = value?.snapshot;
  if (!value || Object.keys(value).length !== 4 || !uuid(value.epoch) || !integer(value.revision) || typeof value.available !== "boolean" ||
    profile !== null && (!profile || Object.keys(profile).length !== 7 || !uuid(profile.workspace_generation) || !integer(profile.worker_generation) || profile.worker_generation < 1 ||
      !integer(profile.settings_revision) || !["automatic", "antenna", "hidden"].includes(profile.display) || !Object.hasOwn(antennaTypes, profile.antenna) ||
      typeof profile.name !== "string" || [...profile.name].length > 64 || profile.name.includes("\0") || !Array.isArray(profile.bands) ||
      profile.bands.length > antennaBands.length || new Set(profile.bands).size !== profile.bands.length || profile.bands.some(band => !antennaBands.includes(band))) ||
    value.available && profile === null) throw new Error("Saved antenna profile could not be verified.");
  return value;
}
/** Same canonical Settings projection as Station Identity; retained reads only. */
export function connectAntenna(changed: (value: AntennaSnapshot) => void, failed: (message: string) => void, invalidated: () => void,
  adapter: Adapter = { read: () => invoke("antenna_snapshot"), listen: wake => listen("xlog:antenna", wake) }) {
  let active = true, ready = false, reading = false, again = false, epoch = 0, warning = "";
  let stop: (() => void) | undefined, latest: AntennaSnapshot | null = null;
  const recover = async () => {
    if (!active || !ready) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = epoch;
      try {
        const value = checked(await adapter.read());
        if (active && captured === epoch) {
          if (!latest || value.epoch !== latest.epoch || value.revision >= latest.revision) {
            if (latest && value.epoch === latest.epoch && value.revision === latest.revision && JSON.stringify(value) !== JSON.stringify(latest)) throw new Error("Antenna changed without a verified revision.");
            latest = value; changed(value);
          }
          if (warning) failed(warning);
        }
      } catch (cause) { if (active && captured === epoch) failed(cause instanceof Error ? cause.message : "Saved antenna unavailable."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; epoch++; invalidated(); void recover(); };
  window.addEventListener("focus", wake);
  void adapter.listen(wake).then(dispose => { if (!active) { dispose(); return; } stop = dispose; ready = true; void recover(); })
    .catch(() => { if (active) { warning = "Antenna notifications unavailable. Refocus to reload retained settings."; ready = true; void recover(); } });
  return () => { active = false; epoch++; stop?.(); window.removeEventListener("focus", wake); };
}
