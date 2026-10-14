import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BandMapViewPreferences } from "./live/BandMaps";
export const desktop = isTauri();
export type DetachedMapKind = "world-map" | "band-maps";
export type DetachedSpotKind = DetachedMapKind | "dx-cluster";
export type StationProvider = "direct_agent" | "direct_flex_lan" | "hamlib";
export type DetachedMapProjection = {
  revision?: number;
  spots: Record<string, any>[]; palette?: Record<string, unknown>;
  home?: { call?: string; lat: number; lon: number; grid?: string; country?: string } | null;
  dxccStatuses?: Record<number, "needed" | "worked" | "confirmed"> | null;
  radioFrequencyHz?: number; selected?: string | null;
  target?: { call: string; lat: number; lon: number; country?: string; locationSource?: string };
  bandMapPreferences?: BandMapViewPreferences;
};
export type MonitorProjection = DetachedMapProjection & {
  station: Record<string, any> | null;
  provider: StationProvider;
  controlsEnabled: boolean;
};
export function validMonitorProjection(value: unknown): value is MonitorProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.spots) && item.spots.length <= 500 &&
    (item.station === null || typeof item.station === "object" && !Array.isArray(item.station)) &&
    (item.provider === "direct_agent" || item.provider === "direct_flex_lan" || item.provider === "hamlib") &&
    typeof item.controlsEnabled === "boolean" &&
    (item.station === null || (item.station as Record<string, unknown>).source === item.provider);
}
const detachedKinds: DetachedMapKind[] = ["world-map", "band-maps"];
export function detachedMapKind(value: unknown): DetachedMapKind | null {
  return typeof value === "string" && detachedKinds.includes(value as DetachedMapKind) ? value as DetachedMapKind : null;
}
export function findDetachedSpot(payload: unknown, spots: Record<string, any>[]): Record<string, any> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { spotId, kind } = payload as Record<string, unknown>;
  if (!(detachedMapKind(kind) || kind === "dx-cluster") || typeof spotId !== "string" || !spotId || spotId.length > 128) return null;
  return spots.find((spot) => spot.id === spotId) ?? null;
}
export async function openDetachedMap(kind: DetachedMapKind): Promise<void> {
  if (!detachedMapKind(kind)) throw new Error("Unknown map window.");
  if (!desktop) throw new Error("Detached maps require the desktop app.");
  await invoke("open_detached_map", { kind });
}
export async function onDetachedSpot(handler: (payload: unknown) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-spot", (event) => handler(event.payload)) : () => {};
}
export async function onDetachedReady(handler: (kind: DetachedMapKind) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-ready", (event) => { const kind = detachedMapKind(event.payload); if (kind) handler(kind); }) : () => {};
}
export async function onDetachedProjection(handler: (value: DetachedMapProjection) => void): Promise<UnlistenFn> {
  return desktop ? listen<DetachedMapProjection>("xlog:detached-projection", (event) => handler(event.payload)) : () => {};
}
export async function announceDetachedReady(kind: DetachedMapKind): Promise<void> {
  if (desktop) await emitTo("main", "xlog:detached-ready", kind);
}
export async function publishDetachedProjection(kind: DetachedMapKind, projection: DetachedMapProjection): Promise<void> {
  if (desktop) await emitTo(kind, "xlog:detached-projection", projection);
}
export async function requestDetachedSpot(kind: DetachedSpotKind, spotId: string): Promise<void> {
  if (!(detachedMapKind(kind) || kind === "dx-cluster") || typeof spotId !== "string" || !spotId || spotId.length > 128) return;
  if (desktop) await emitTo("main", "xlog:detached-spot", { kind, spotId });
}
export async function onDetachedBandMapPreferences(handler: (value: unknown) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-band-map-preferences", event => handler(event.payload)) : () => {};
}
export async function requestDetachedBandMapPreferences(preferences: BandMapViewPreferences): Promise<void> {
  if (desktop) await emitTo("main", "xlog:detached-band-map-preferences", preferences);
}
export async function onMonitorProjection(handler: (value: MonitorProjection) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:monitor-projection", (event) => {
    if (validMonitorProjection(event.payload)) handler(event.payload);
  }) : () => {};
}
export async function onMonitorReady(handler: () => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:monitor-ready", () => handler()) : () => {};
}
export async function announceMonitorReady(): Promise<void> {
  if (desktop) await emitTo("main", "xlog:monitor-ready", null);
}
export async function publishMonitorProjection(projection: MonitorProjection): Promise<void> {
  if (desktop) await emitTo("monitor", "xlog:monitor-projection", projection);
}
export async function workerRequest(
  method: string,
  params: Record<string, unknown> = {},
) {
  if (!desktop)
    throw new Error(
      "The browser cannot connect to station services. Launch OM0RX-xLog on your desktop.",
    );
  const response = await invoke<{
    id: string;
    ok: boolean;
    result?: unknown;
    error?: { code?: string; message?: string };
  }>("worker_request", {
    request: { id: crypto.randomUUID(), method, params },
  });
  if (!response.ok)
    throw new Error(
      response.error?.message || "The operation failed; no successful outcome was confirmed.",
    );
  return response;
}
export async function openMonitor() {
  if (desktop) {
    await invoke("open_monitor");
    return "Detached station monitor opened";
  }
  const w = window.open(
    `${window.location.pathname}?view=monitor`,
    "xlog-p1-monitor",
    "width=760,height=660",
  );
  if (!w)
    throw new Error("Monitor preview was blocked. Allow popups and try again.");
  return "Browser monitor preview opened";
}
