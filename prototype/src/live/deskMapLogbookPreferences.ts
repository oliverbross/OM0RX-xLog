export const deskMapLogbookKey = "xlog.integration.desk-map-logbook.v1";
export const deskMapLogbookViews = [
  ["map", "Map"], ["logbook", "Logbook"],
  ["logbook-previous", "Logbook + Previous QSO's"],
  ["logbook-above", "Logbook above map"], ["logbook-below", "Logbook below map"],
] as const;
export type DeskMapLogbookView = typeof deskMapLogbookViews[number][0];
export type DeskMapLogbookPreferences = { version: 1; view: DeskMapLogbookView; logbookPercent: number };
export const minimumDeskMapHeight = 180;
export const minimumDeskLogbookHeight = 220;
export const deskMapLogbookDividerHeight = 10;
export const defaultDeskMapLogbookPreferences = (): DeskMapLogbookPreferences => ({ version: 1, view: "map", logbookPercent: 50 });
export function validDeskMapLogbookView(value: unknown): value is DeskMapLogbookView {
  return deskMapLogbookViews.some(([view]) => view === value);
}
export function boundDeskLogbookPercent(value: number) {
  return Number.isFinite(value) ? Math.max(20, Math.min(80, value)) : 50;
}
export function readDeskMapLogbookPreferences(raw: string | null): DeskMapLogbookPreferences {
  const result = defaultDeskMapLogbookPreferences();
  if (!raw || raw.length > 1024) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return result;
    if (validDeskMapLogbookView(value.view)) result.view = value.view;
    if (typeof value.logbookPercent === "number") result.logbookPercent = boundDeskLogbookPercent(value.logbookPercent);
  } catch { /* Presentation preferences never prevent logging. */ }
  return result;
}
/** Short containers scroll the two usable minimum panes instead of clipping
 * controls. Percent is always the Logbook share, independent of visual order. */
export function deskMapLogbookBounds(height: number) {
  const minimum = minimumDeskMapHeight + minimumDeskLogbookHeight + deskMapLogbookDividerHeight;
  const measured = Number.isFinite(height) && height > 0 ? height : 0;
  const contentHeight = Math.max(minimum, measured);
  const usable = contentHeight - deskMapLogbookDividerHeight;
  return { min: Math.max(20, minimumDeskLogbookHeight * 100 / usable),
    max: Math.min(80, (usable - minimumDeskMapHeight) * 100 / usable),
    usable, contentHeight, scrolling: measured < minimum };
}
