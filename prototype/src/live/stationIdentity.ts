import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export type SavedStationIdentity = { worker_generation: number; workspace_generation: string; settings_revision: number;
  operator_call: string; station_call: string; grid: string; location: string; logbook_mode: "local" | "wavelog" };
export type IdentityProjection = { epoch: string; revision: number; available: boolean; snapshot: SavedStationIdentity | null };
type Adapter = { read: () => Promise<unknown>; listen: (wake: () => void) => Promise<() => void> };
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function checked(input: unknown): IdentityProjection {
  const value = input as IdentityProjection, source = value?.snapshot;
  if (!value || !uuid(value.epoch) || !integer(value.revision) || typeof value.available !== "boolean" ||
    source !== null && (!source || Object.keys(source).length !== 8 || !uuid(source.workspace_generation) ||
      !integer(source.worker_generation) || source.worker_generation < 1 || !integer(source.settings_revision) ||
      !["local", "wavelog"].includes(source.logbook_mode) ||
      (["operator_call", "station_call", "grid", "location"] as const).some(key => typeof source[key] !== "string" || source[key].length > 512)) ||
    value.available && source === null) throw new Error("Saved station identity could not be verified.");
  return value;
}
/** Retained non-secret display only. No Settings request, poller or fallback. */
export function connectStationIdentity(changed: (value: IdentityProjection) => void, failed: (message: string) => void,
  invalidated: () => void, adapter: Adapter = { read: () => invoke("station_identity_snapshot"), listen: wake => listen("xlog:station-identity", wake) }) {
  let active = true, ready = false, reading = false, again = false, epoch = 0, warning = "";
  let stop: (() => void) | undefined, latest: IdentityProjection | null = null;
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
            if (latest && value.epoch === latest.epoch && value.revision === latest.revision && JSON.stringify(value) !== JSON.stringify(latest))
              throw new Error("Saved identity changed without a verified revision.");
            latest = value; changed(value);
          }
          if (warning) failed(warning);
        }
      } catch (cause) { if (active && captured === epoch) failed(cause instanceof Error ? cause.message : "Saved identity unavailable."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; epoch++; invalidated(); void recover(); };
  window.addEventListener("focus", wake);
  void adapter.listen(wake).then(dispose => { if (!active) { dispose(); return; } stop = dispose; ready = true; void recover(); })
    .catch(() => { if (active) { warning = "Saved identity notifications unavailable. Values are retained only; refocus to reload."; ready = true; void recover(); } });
  return () => { active = false; epoch++; stop?.(); window.removeEventListener("focus", wake); };
}
