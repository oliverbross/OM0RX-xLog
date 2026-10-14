import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validMonitorContext, type MonitorContext } from "./monitorContext";

type Adapter = { read: () => Promise<unknown>; listen: (name: string, wake: () => void) => Promise<() => void> };
/** Wakes carry no authority. Only coherent retained native reads update this
 * display; no timer reads, worker fallback, selection or device operation. */
export function connectStationStatus(changed: (value: MonitorContext) => void, failed: (message: string) => void,
  invalidated: () => void, adapter: Adapter = {
    read: () => invoke("station_status_snapshot"), listen: (name, wake) => listen(name, wake),
  }) {
  let active = true, ready = false, reading = false, again = false, epoch = 0;
  let latest: MonitorContext | null = null, subscriptionError = "";
  const stops: (() => void)[] = [];
  const recover = async () => {
    if (!active || !ready) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = epoch;
      try {
        const value = await adapter.read();
        if (active && captured === epoch) {
          if (!validMonitorContext(value) || value.acceptance) throw new Error("Station Status observations could not be verified.");
          if (!latest || value.epoch !== latest.epoch || value.revision > latest.revision) { latest = value; changed(value); }
          if (subscriptionError) failed(subscriptionError);
        }
      } catch (cause) { if (active && captured === epoch) failed(cause instanceof Error ? cause.message : "Station Status is unavailable."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; epoch++; invalidated(); void recover(); };
  window.addEventListener("focus", wake);
  void Promise.allSettled(["xlog:station-selection", "xlog:station-telemetry"].map(name => adapter.listen(name, wake))).then(results => {
    for (const result of results) if (result.status === "fulfilled") { if (active) stops.push(result.value); else result.value(); }
    if (!active) return;
    if (results.some(result => result.status === "rejected")) subscriptionError = "Some Station Status notifications are unavailable. Values are retained only; refocus to reload.";
    ready = true; void recover();
  });
  return () => { active = false; epoch++; stops.forEach(stop => stop()); window.removeEventListener("focus", wake); };
}
