import { boundColumnWidth } from "./operatorWorkspacePreferences";

export const logbookColumns = [
  ["utc", "UTC", 154], ["call", "Callsign", 150], ["bandMode", "Band / Mode", 105],
  ["frequency", "Frequency", 105], ["rst", "RST", 92], ["country", "Country", 150],
  ["qsl", "QSL", 60], ["lotw", "LoTW", 60], ["clublog", "Club Log", 82], ["comment", "Comment", 230],
] as const;
export type LogbookColumn = typeof logbookColumns[number][0];
export type LogbookColumnContext = "docked" | "detached" | "desk";
export type LogbookColumnPreferences = { version: 1; columns: LogbookColumn[]; order?: LogbookColumn[]; widths: Record<LogbookColumn, number> };
export const legacyDeskLogbookColumnsKey = "xlog.integration.logbook-columns.desk.v1";
export const logbookColumnsKey = (context: LogbookColumnContext) =>
  `xlog.integration.logbook-columns.${context}.${context === "desk" ? "v2" : "v1"}`;
export const minimumLogbookColumnWidth = (id: LogbookColumn) => id === "call" ? 96 : 48;
export const boundLogbookColumnWidth = (id: LogbookColumn, value: number) => Math.max(minimumLogbookColumnWidth(id), boundColumnWidth(value));

/** Older preferences have visibility only. Unknown/duplicate entries never remove a known column. */
export function orderedLogbookColumns(preferences: Pick<LogbookColumnPreferences, "order">) {
  const ids = [...new Set([...(Array.isArray(preferences.order) ? preferences.order : []), ...logbookColumns.map(([id]) => id)])];
  return ids.flatMap(id => logbookColumns.filter(([known]) => known === id));
}

export function defaultLogbookColumnPreferences(_context: LogbookColumnContext = "docked"): LogbookColumnPreferences {
  return { version: 1, columns: logbookColumns.map(([id]) => id),
    widths: Object.fromEntries(logbookColumns.map(([id, , width]) => [id, width])) as Record<LogbookColumn, number> };
}

const legacyDeskDefaults = (): LogbookColumnPreferences => ({ ...defaultLogbookColumnPreferences("desk"),
  columns: ["utc", "call", "bandMode", "frequency", "country"] });

/** Preserve a customized v1 Desk layout, but promote its automatically persisted old default to the normal full table. */
export function migrateLegacyDeskLogbookColumnPreferences(raw: string | null): LogbookColumnPreferences {
  if (!raw) return defaultLogbookColumnPreferences("desk");
  const migrated = readLogbookColumnPreferences(raw, "desk"), legacy = legacyDeskDefaults();
  const untouched = migrated.columns.length === legacy.columns.length
    && migrated.columns.every((column, index) => column === legacy.columns[index])
    && logbookColumns.every(([column]) => migrated.widths[column] === legacy.widths[column]);
  return untouched ? defaultLogbookColumnPreferences("desk") : migrated;
}

export function readLogbookColumnPreferences(raw: string | null, context: LogbookColumnContext = "docked"): LogbookColumnPreferences {
  const result = defaultLogbookColumnPreferences(context);
  if (!raw || raw.length > 4096) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return result;
    if (Array.isArray(value.order)) result.order = orderedLogbookColumns(value).map(([id]) => id);
    if (Array.isArray(value.columns)) {
      const chosen = logbookColumns.map(([id]) => id).filter(id => id === "call" || value.columns.includes(id));
      // A damaged or unknown-only list falls back to this context's defaults.
      if (value.columns.some((id: unknown) => logbookColumns.some(([known]) => known === id))) result.columns = chosen;
    }
    for (const [id] of logbookColumns) {
      const width = value.widths?.[id];
      if (typeof width === "number" && Number.isFinite(width)) result.widths[id] = boundLogbookColumnWidth(id, width);
    }
  } catch { /* Presentation preferences must never block the logbook. */ }
  return result;
}
