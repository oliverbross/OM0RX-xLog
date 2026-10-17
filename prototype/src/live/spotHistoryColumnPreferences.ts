import { boundColumnWidth } from "./operatorWorkspacePreferences";

export const spotHistoryColumns = [
  ["utc", "Received UTC", 165], ["call", "Callsign", 110], ["frequency", "kHz", 88],
  ["band", "Band", 78], ["mode", "Mode", 88], ["spotter", "Spotter", 110],
  ["source", "Source / Cluster", 160], ["country", "Country", 140], ["comment", "Comment", 230],
] as const;
export type SpotHistoryColumn = typeof spotHistoryColumns[number][0];
export type SpotHistoryColumnPreferences = { version: 1; columns: SpotHistoryColumn[]; order?: SpotHistoryColumn[]; widths: Record<SpotHistoryColumn, number> };
export const spotHistoryColumnsKey = "xlog.integration.spot-history-columns.v1";
export const minimumHistoryColumnWidth = (column: SpotHistoryColumn) => column === "call" ? 96 : 48;
export const boundHistoryColumnWidth = (column: SpotHistoryColumn, width: number) => Math.max(minimumHistoryColumnWidth(column), boundColumnWidth(width));
/** Preserve legacy layouts; discard unknown/duplicate IDs and append every missing known column. */
export function orderedSpotHistoryColumns(preferences: Pick<SpotHistoryColumnPreferences, "order">) {
  const saved = Array.isArray(preferences.order) ? preferences.order : [];
  const expanded = saved.flatMap(id => id === ("bandMode" as SpotHistoryColumn) ? ["band", "mode"] as SpotHistoryColumn[] : [id]);
  const ids = [...new Set([...expanded, ...spotHistoryColumns.map(([id]) => id)])];
  return ids.flatMap(id => spotHistoryColumns.filter(([known]) => known === id));
}
export function defaultSpotHistoryColumns(): SpotHistoryColumnPreferences {
  return { version: 1, columns: spotHistoryColumns.map(([column]) => column),
    widths: Object.fromEntries(spotHistoryColumns.map(([column, , width]) => [column, width])) as Record<SpotHistoryColumn, number> };
}
export function readSpotHistoryColumns(raw: string | null): SpotHistoryColumnPreferences {
  const result = defaultSpotHistoryColumns();
  if (!raw || raw.length > 4096) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return result;
    if (Array.isArray(value.order)) result.order = orderedSpotHistoryColumns(value).map(([id]) => id);
    if (Array.isArray(value.columns)) {
      const legacyBandMode = value.columns.includes("bandMode");
      const chosen = spotHistoryColumns.map(([id]) => id).filter(id => id === "call" || value.columns.includes(id)
        || (legacyBandMode && (id === "band" || id === "mode")));
      if (value.columns.some((id: unknown) => id === "bandMode" || spotHistoryColumns.some(([known]) => known === id))) result.columns = chosen;
    }
    for (const [column] of spotHistoryColumns) {
      const width = value.widths?.[column] ?? ((column === "band" || column === "mode") ? value.widths?.bandMode : undefined);
      if (typeof width === "number" && Number.isFinite(width)) result.widths[column] = boundHistoryColumnWidth(column, width);
    }
  } catch { /* Presentation preferences cannot block archive reads. */ }
  return result;
}
