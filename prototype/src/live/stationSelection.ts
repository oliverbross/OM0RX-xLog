import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StationProvider } from "../worker";
import type { RadioID } from "./stationSession";
export type StationSelection = { radio_id: RadioID; provider: StationProvider; generation: number; selection_id?: string | null; control_revision?: number };
export type StationSlotSelection = Omit<StationSelection, "provider"> & { provider: StationProvider | null };
export const nativeStationSelection = () => isTauri() && new URLSearchParams(location.search).get("acceptance") !== "local";
function checked(value: any, radioId: RadioID): StationSlotSelection {
  if (!value || value.radio_id !== radioId || value.provider !== null && !["direct_agent", "direct_flex_lan", "direct_tci", "hamlib"].includes(value.provider) || !Number.isSafeInteger(value.generation) || value.generation < 0)
    throw new Error("Native radio selection was not confirmed.");
  return value;
}
/** Browser storage is a one-time migration hint, never a native authority. */
export function connectStationSelection(radioId: RadioID, legacy: string | null, changed: (value: StationSlotSelection) => void, failed: (message: string) => void) {
  if (!nativeStationSelection()) return null;
  let active = true, reading = false, again = false, revision = -1;
  let stop: (() => void) | undefined;
  const recover = async () => {
    if (!active) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false;
      try {
        const value = checked(await invoke("station_selection_snapshot", { radioId, legacy }), radioId);
        if (active && value.generation >= revision) { revision = value.generation; changed(value); }
      } catch (cause) { if (active) failed(cause instanceof Error ? cause.message : "Native radio selection is unavailable."); }
    } while (active && again);
    reading = false;
  };
  const focus = () => { if (stop) void recover(); };
  window.addEventListener("focus", focus);
  void listen("xlog:station-selection", () => { void recover(); }).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; void recover();
  }).catch(cause => { if (active) failed(cause instanceof Error ? cause.message : "Native radio selection is unavailable."); });
  return () => { active = false; stop?.(); window.removeEventListener("focus", focus); };
}
