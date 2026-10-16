export const alertColumns = [
  ["select", "Select"], ["call", "Call"], ["source", "Source"], ["frequency", "Frequency"],
  ["mode", "Mode"], ["why", "Why"], ["comment", "Comment"], ["history", "History"],
] as const;
export type AlertColumn = typeof alertColumns[number][0];
export type AlertColumnPreferences = { version: 1; columns: AlertColumn[] };
export const alertColumnsKey = "xlog.integration.alert-columns.v1";
export const mandatoryAlertColumn = (column: AlertColumn) => column === "select" || column === "call";
export const defaultAlertColumns = (): AlertColumnPreferences => ({ version: 1, columns: alertColumns.map(([column]) => column) });

export function readAlertColumns(raw: string | null): AlertColumnPreferences {
  const defaults = defaultAlertColumns();
  if (!raw || raw.length > 4096) return defaults;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.columns)
      || !value.columns.some((id: unknown) => alertColumns.some(([known]) => known === id))) return defaults;
    return { version: 1, columns: alertColumns.map(([id]) => id).filter(id => mandatoryAlertColumn(id) || value.columns.includes(id)) };
  } catch { return defaults; }
}
