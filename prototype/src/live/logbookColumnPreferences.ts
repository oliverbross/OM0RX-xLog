import { boundColumnWidth } from "./operatorWorkspacePreferences";

export const logbookColumns = [
  ["utc", "UTC", 154], ["call", "Callsign", 150], ["bandMode", "Band / Mode", 105],
  ["frequency", "Frequency", 105], ["rst", "RST", 92], ["country", "Country", 150],
  ["qsl", "QSL", 60], ["lotw", "LoTW", 60], ["clublog", "Club Log", 82], ["comment", "Comment", 230],
] as const;
export type LogbookColumn = typeof logbookColumns[number][0];
export type LogbookColumnContext = "docked" | "detached";
export type LogbookColumnPreferences = { version: 1; columns: LogbookColumn[]; widths: Record<LogbookColumn, number> };
export const logbookColumnsKey = (context: LogbookColumnContext) => `xlog.integration.logbook-columns.${context}.v1`;
export const minimumLogbookColumnWidth = (id: LogbookColumn) => id === "call" ? 96 : 48;
export const boundLogbookColumnWidth = (id: LogbookColumn, value: number) => Math.max(minimumLogbookColumnWidth(id), boundColumnWidth(value));

export function defaultLogbookColumnPreferences(): LogbookColumnPreferences {
  return { version: 1, columns: logbookColumns.map(([id]) => id),
    widths: Object.fromEntries(logbookColumns.map(([id, , width]) => [id, width])) as Record<LogbookColumn, number> };
}

export function readLogbookColumnPreferences(raw: string | null): LogbookColumnPreferences {
  const result = defaultLogbookColumnPreferences();
  if (!raw || raw.length > 4096) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return result;
    if (Array.isArray(value.columns)) {
      const chosen = logbookColumns.map(([id]) => id).filter(id => id === "call" || value.columns.includes(id));
      // A damaged or unknown-only list falls back to the full default table.
      if (value.columns.some((id: unknown) => logbookColumns.some(([known]) => known === id))) result.columns = chosen;
    }
    for (const [id] of logbookColumns) {
      const width = value.widths?.[id];
      if (typeof width === "number" && Number.isFinite(width)) result.widths[id] = boundLogbookColumnWidth(id, width);
    }
  } catch { /* Presentation preferences must never block the logbook. */ }
  return result;
}
