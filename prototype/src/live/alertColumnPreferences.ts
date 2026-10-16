import { boundColumnWidth } from "./operatorWorkspacePreferences";

export const alertColumns = [
  ["select", "Select", 64], ["call", "Call", 110], ["source", "Source", 110], ["frequency", "Frequency", 110],
  ["mode", "Mode", 70], ["why", "Why", 240], ["comment", "Comment", 230], ["history", "History", 180],
] as const;
export type AlertColumn = typeof alertColumns[number][0];
export type AlertColumnPreferences = { version: 1; columns: AlertColumn[]; order: AlertColumn[]; widths: Record<AlertColumn, number> };
export const alertColumnsKey = "xlog.integration.alert-columns.v1";
export const mandatoryAlertColumn = (column: AlertColumn) => column === "select" || column === "call";
export const minimumAlertColumnWidth = (column: AlertColumn) => column === "call" ? 96 : column === "select" ? 60 : 48;
export const boundAlertColumnWidth = (column: AlertColumn, width: number) => Math.max(minimumAlertColumnWidth(column), boundColumnWidth(width));
/** Select and Call anchor every table; optional columns retain validated saved order. */
export function orderedAlertColumns(order: unknown) {
  const ids = [...new Set(["select", "call", ...(Array.isArray(order) ? order : []), ...alertColumns.map(([id]) => id)])];
  return ids.flatMap(id => alertColumns.filter(([known]) => known === id));
}
export const defaultAlertColumns = (): AlertColumnPreferences => ({ version: 1, columns: alertColumns.map(([column]) => column),
  order: alertColumns.map(([column]) => column), widths: Object.fromEntries(alertColumns.map(([id, , width]) => [id, width])) as Record<AlertColumn, number> });

export function readAlertColumns(raw: string | null): AlertColumnPreferences {
  const defaults = defaultAlertColumns();
  if (!raw || raw.length > 4096) return defaults;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.columns)
      || !value.columns.some((id: unknown) => alertColumns.some(([known]) => known === id))) return defaults;
    defaults.columns = alertColumns.map(([id]) => id).filter(id => mandatoryAlertColumn(id) || value.columns.includes(id));
    defaults.order = orderedAlertColumns(value.order).map(([id]) => id);
    for (const [id] of alertColumns) {
      const width = value.widths?.[id];
      if (typeof width === "number" && Number.isFinite(width)) defaults.widths[id] = boundAlertColumnWidth(id, width);
    }
    return defaults;
  } catch { return defaults; }
}
