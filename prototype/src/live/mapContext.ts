import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validClusterProjection, type ClusterProjection } from "./DetachedClusterBridge";
import { validPreferenceSnapshot, type PreferenceSnapshot } from "./bandMapPreferenceTransport";
import { hamlibProjection } from "./hamlibStation";
import type { Spot } from "../model";

export type MapContext = { epoch: string; revision: number; metadata: PreferenceSnapshot & {
  home: { call?: string; grid?: string; lat: number; lon: number } | null;
  dxccStatuses: Record<number, "needed" | "worked" | "confirmed">;
}; cluster: Omit<ClusterProjection, "response"> & { response: Record<string, any> | null; received_at_ms: number }; selection: Record<string, any>; radio: Record<string, any> };
const object = (value: any) => !!value && typeof value === "object" && !Array.isArray(value);
export function validMapContext(value: any): value is MapContext {
  const home = value?.metadata?.home;
  return object(value) && typeof value.epoch === "string" && /^[0-9a-f-]{36}$/i.test(value.epoch) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && validPreferenceSnapshot(value.metadata) &&
    (home === null || object(home) && Number.isFinite(home.lat) && Math.abs(home.lat) <= 90 && Number.isFinite(home.lon) && Math.abs(home.lon) <= 180) &&
    object(value.metadata.dxccStatuses) && Object.values(value.metadata.dxccStatuses).every(status => ["needed", "worked", "confirmed"].includes(String(status))) &&
    validClusterProjection(value.cluster) && Number.isSafeInteger(value.cluster.received_at_ms) && value.cluster.received_at_ms >= 0 &&
    object(value.selection) && object(value.radio);
}
export function mapClusterFresh(context: MapContext | null, now = Date.now()): boolean {
  const source = context?.cluster;
  return !!source?.available && source.received_at_ms > 0 && now - source.received_at_ms >= -1000 && now - source.received_at_ms <= 5000;
}
export function mapRadioFrequency(context: MapContext | null, now = Date.now()): number | undefined {
  if (!context) return;
  const radio = context.radio, provider = context.selection.provider;
  if (radio.available !== true || radio.provider !== provider || !Number.isSafeInteger(radio.received_at_ms) ||
    now - radio.received_at_ms > 5000 || now - radio.received_at_ms < -1000) return;
  const projected = provider === "hamlib" ? hamlibProjection(radio.snapshot, null) : radio.snapshot;
  const observation = projected?.radio;
  if (projected?.source !== provider || observation?.connected !== true || observation?.observed !== true || projected?.station?.radio_stale === true) return;
  const hz = observation.receive_frequency_hz ?? observation.frequency_hz;
  return typeof hz === "number" && Number.isFinite(hz) && hz > 0 ? hz : undefined;
}
export function mapSpots(spots: Record<string, any>[]): Spot[] {
  return spots.filter(s => Number.isFinite(s.latitude) && Math.abs(s.latitude) <= 90 && Number.isFinite(s.longitude) && Math.abs(s.longitude) <= 180).map(s => ({
    id: s.id, call: s.callsign, receivedAt: s.receivedAt, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  }));
}

/** Wake events carry no authority. Read retained native state; serialize reads
 * and discard a response overtaken by a workspace/source wake or disposal. */
export function connectMapContext(changed: (value: MapContext) => void, failed: (message: string) => void) {
  let active = true, reading = false, again = false, wakeEpoch = 0;
  let latest: MapContext | null = null;
  const stops: (() => void)[] = [];
  const recover = async () => {
    if (!active) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = wakeEpoch;
      try {
        const value = await invoke("map_context_snapshot");
        if (active && captured === wakeEpoch) {
          if (!validMapContext(value)) throw new Error("Map context could not be verified. Refresh to retry.");
          if (!latest || latest.epoch !== value.epoch || value.revision > latest.revision) { latest = value; changed(value); }
        }
      } catch (cause) { if (active && captured === wakeEpoch) failed(cause instanceof Error ? cause.message : "Map context is unavailable. Refresh to retry."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { wakeEpoch++; void recover(); };
  window.addEventListener("focus", wake);
  const timer = window.setInterval(() => void recover(), 1500);
  void Promise.allSettled(["xlog:map-context", "xlog:cluster-projection", "xlog:station-telemetry"].map(name => listen(name, wake))).then(results => {
    for (const result of results) if (result.status === "fulfilled") { if (active) stops.push(result.value); else result.value(); }
    if (active) void recover();
  });
  return { refresh: wake, dispose: () => { active = false; wakeEpoch++; stops.forEach(stop => stop()); clearInterval(timer); window.removeEventListener("focus", wake); } };
}
