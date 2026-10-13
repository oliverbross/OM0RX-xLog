import { bandMapView, validBandMapView, type WorkspacePreferences } from "./workspacePreferences";
import type { BandMapViewPreferences } from "./BandMaps";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PreferenceSnapshot = { generation: string; revision: number; preferences: WorkspacePreferences; stored: boolean };
export type PreferenceReply = PreferenceSnapshot & { status: "applied" | "conflict" | "workspace_changed" };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function validPreferenceSnapshot(value: any): value is PreferenceSnapshot {
  return value && typeof value.generation === "string" && /^[0-9a-f-]{36}$/i.test(value.generation) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.stored === "boolean" &&
    value.preferences && validBandMapView(bandMapView(value.preferences, true)) && validBandMapView(bandMapView(value.preferences, false));
}
export function bandMapPatch(base: PreferenceSnapshot, compact: boolean, rendered: BandMapViewPreferences, requested: BandMapViewPreferences, latest = rendered) {
  if (!validPreferenceSnapshot(base) || !validBandMapView(rendered) || !validBandMapView(requested) || !validBandMapView(latest)) throw new Error("Band-map preferences could not be verified. Reload before changing them.");
  const keys = compact ? ["bands", "followRadio", "fontScale"] as const : ["bands", "followRadio", "fontScale", "layout", "modes"] as const;
  const expected: Record<string, unknown> = {}, patch: Record<string, unknown> = {};
  for (const key of keys) {
    const old = key === "modes" ? rendered[key] ?? ["cw", "data", "phone"] : rendered[key];
    const next = key === "modes" ? requested[key] ?? ["cw", "data", "phone"] : requested[key];
    if (!same(old, next)) { expected[key] = key === "modes" ? latest[key] ?? ["cw", "data", "phone"] : latest[key]; patch[key] = next; }
  }
  return { generation: base.generation, scope: compact ? "desk" : "detached", expected, patch };
}
export function checkedPreferenceReply(value: unknown): PreferenceReply {
  if (!validPreferenceSnapshot(value) || !["applied", "conflict", "workspace_changed"].includes((value as any).status))
    throw new Error("Band-map preference acknowledgement could not be verified. Reload before retrying.");
  return value as PreferenceReply;
}
export function connectPreferenceInvalidation(wake: () => void): (() => void) | null {
  if (!isTauri()) return null;
  let active = true, stop: (() => void) | undefined;
  window.addEventListener("focus", wake);
  void listen("xlog:map-context", () => { if (active) wake(); }).then(dispose => {
    if (active) stop = dispose; else dispose();
  }).catch(() => {
    // Registration failure is not a preference-write failure. Keep the focus
    // fallback installed; never create an unhandled rejection or replay a save.
  });
  return () => { active = false; stop?.(); window.removeEventListener("focus", wake); };
}
