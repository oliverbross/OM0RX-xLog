import { BAND_ORDER } from "./BandMaps";
import type { BandMapViewPreferences } from "./BandMaps";

export type WorkspacePreferences = {
  deskBandMapBands: string[];
  detachedBandMapBands: string[];
  deskBandMapFollowsRadio: boolean;
  detachedBandMapFollowsRadio: boolean;
  detachedBandMapLayout: "Single row" | "Adaptive grid";
  bandMapFontScale: number;
  intelligenceBands: string[];
  clusterSpotOpensFullEditor: boolean;
};

export function validBandMapView(value: unknown): value is BandMapViewPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const view = value as Record<string, unknown>;
  return Array.isArray(view.bands) && view.bands.length > 0 && view.bands.length <= BAND_ORDER.length &&
    view.bands.every(band => typeof band === "string" && BAND_ORDER.includes(band)) &&
    new Set(view.bands).size === view.bands.length &&
    typeof view.followRadio === "boolean" && (view.layout === "row" || view.layout === "grid") &&
    typeof view.fontScale === "number" && Number.isFinite(view.fontScale) && view.fontScale >= 0.8 && view.fontScale <= 2;
}

export function bandMapView(preferences: WorkspacePreferences, compact: boolean): BandMapViewPreferences {
  return {
    bands: compact ? preferences.deskBandMapBands : preferences.detachedBandMapBands,
    followRadio: compact ? preferences.deskBandMapFollowsRadio : preferences.detachedBandMapFollowsRadio,
    layout: compact ? "row" : preferences.detachedBandMapLayout === "Single row" ? "row" : "grid",
    fontScale: preferences.bandMapFontScale,
  };
}

export function withBandMapView(preferences: WorkspacePreferences, compact: boolean, view: BandMapViewPreferences): WorkspacePreferences {
  if (!validBandMapView(view)) throw new Error("Invalid band-map preferences.");
  return compact ? { ...preferences, deskBandMapBands: view.bands, deskBandMapFollowsRadio: view.followRadio,
    bandMapFontScale: view.fontScale }
    : { ...preferences, detachedBandMapBands: view.bands, detachedBandMapFollowsRadio: view.followRadio,
      detachedBandMapLayout: view.layout === "row" ? "Single row" : "Adaptive grid", bandMapFontScale: view.fontScale };
}

export function migrateLegacyBandMaps(preferences: WorkspacePreferences, storage: Pick<Storage, "getItem">): WorkspacePreferences | null {
  const read = (scope: "desk" | "workspace", field: string) => {
    try { return storage.getItem(`xlog.integration.bandMaps.${scope}.${field}`); }
    catch { return null; }
  };
  const legacy = ["desk", "workspace"].some(scope => ["bands", "followRadio", "layout", "fontScale"].some(field => read(scope as "desk" | "workspace", field) !== null));
  if (!legacy) return null;
  let migrated = { ...preferences };
  for (const [scope, compact] of [["desk", true], ["workspace", false]] as const) {
    const prior = bandMapView(migrated, compact);
    let bands = prior.bands;
    try {
      const parsed: unknown = JSON.parse(read(scope, "bands") || "null");
      if (Array.isArray(parsed)) {
        const known = [...new Set(parsed.filter((band): band is string => typeof band === "string" && BAND_ORDER.includes(band)))];
        if (known.length) bands = known;
      }
    } catch { /* Preserve native defaults for invalid browser storage. */ }
    const followValue = read(scope, "followRadio");
    const followRadio = followValue === "true" ? true : followValue === "false" ? false : prior.followRadio;
    const layout = read(scope, "layout") === "row" ? "row" : read(scope, "layout") === "grid" ? "grid" : prior.layout;
    const scale = Number(read(scope, "fontScale"));
    const fontScale = read(scope, "fontScale") !== null && Number.isFinite(scale) && scale >= 0.8 && scale <= 2 ? scale : prior.fontScale;
    migrated = withBandMapView(migrated, compact, { bands, followRadio, layout, fontScale });
  }
  return migrated;
}
