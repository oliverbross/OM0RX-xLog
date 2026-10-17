export const operatorWorkspaceKey = "xlog.integration.operator-workspace.v1";
export const compactClusterColumns = [
  ["time", "For", 62], ["score", "Score", 52], ["band", "Band", 58], ["frequency", "MHz", 94],
  ["callsign", "Callsign", 96], ["mode", "Mode", 58], ["country", "Country", 120], ["cq", "CQ", 48],
  ["spotter", "Spotter", 100], ["callStatus", "Call status", 68], ["dxccStatus", "DXCC status", 78],
  ["special", "Special", 100], ["workedBefore", "Worked before", 160], ["comment", "Comment", 150],
] as const;
export type CompactColumn = typeof compactClusterColumns[number][0];
export const compactClusterHeader = (column: CompactColumn) =>
  column === "callStatus" ? "CS" : column === "dxccStatus" ? "DS" : compactClusterColumns.find(([id]) => id === column)![1];
export type WorkspacePreferences = { version: 1; mapPercent: number; activeTab: "band-maps" | "cluster";
  columns: CompactColumn[]; widths: Record<CompactColumn, number> };
export const boundColumnWidth = (value: number) => Math.round(Math.max(48, Math.min(480, value)));
export function defaultWorkspacePreferences(): WorkspacePreferences {
  return { version: 1, mapPercent: 58, activeTab: "band-maps", columns: ["score", "band", "frequency", "callsign", "mode", "comment"],
    widths: Object.fromEntries(compactClusterColumns.map(([id, , width]) => [id, width])) as Record<CompactColumn, number> };
}
export function readWorkspacePreferences(raw: string | null): WorkspacePreferences {
  const result = defaultWorkspacePreferences();
  if (!raw || raw.length > 4096) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return result;
    if (typeof value.mapPercent === "number" && Number.isFinite(value.mapPercent)) result.mapPercent = Math.max(20, Math.min(80, value.mapPercent));
    if (value.activeTab === "cluster") result.activeTab = "cluster";
    if (Array.isArray(value.columns)) {
      const chosen = compactClusterColumns.map(([id]) => id).filter(id => value.columns.includes(id));
      if (chosen.length) result.columns = chosen;
    }
    for (const [id] of compactClusterColumns) {
      const width = value.widths?.[id];
      if (typeof width === "number" && Number.isFinite(width)) {
        const legacyStatusDefault = (id === "callStatus" || id === "dxccStatus") && width === 120;
        if (!legacyStatusDefault) result.widths[id] = boundColumnWidth(width);
      }
    }
  } catch { /* Damaged/nonsecret preferences never block the operator. */ }
  return result;
}
export function splitBounds(width: number) {
  // Below this width CSS stacks both panels; no unusably narrow map or table.
  if (width <= 740) return { min: 20, max: 80 };
  const usable = width - 10;
  return { min: Math.max(20, 420 / usable * 100), max: Math.min(80, (usable - 280) / usable * 100) };
}
