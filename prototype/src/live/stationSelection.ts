import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StationProvider } from "../worker";
export type StationSelection = { provider: StationProvider; generation: number };
export const nativeStationSelection = () => isTauri() && new URLSearchParams(location.search).get("acceptance") !== "local";
function checked(value: any): StationSelection {
  if (!value || !["direct_agent", "direct_flex_lan", "hamlib"].includes(value.provider) || !Number.isSafeInteger(value.generation) || value.generation < 0)
    throw new Error("Native radio selection was not confirmed.");
  return value;
}
/** Browser storage is a one-time migration hint, never a native authority. */
export function connectStationSelection(legacy: string | null, changed: (value: StationSelection) => void, failed: (message: string) => void) {
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
        const value = checked(await invoke("station_selection_snapshot", { legacy }));
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
