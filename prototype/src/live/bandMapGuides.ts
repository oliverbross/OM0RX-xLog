export type GuideRange = { startHz: number; endHz: number; color: string; label: string };
export type GuideMarker = { frequencyHz: number; label: string; category: string; mode?: "CW" | "USB" | "LSB" | "FM" | "AM" };
export type BandMapGuide = { version: 1; units: "Hz"; id: string; name: string; region: string; origin: "built-in" | "custom"; sourceURL: string; reviewed: string; supportedBands: string[]; ranges: GuideRange[]; markers: GuideMarker[] };
export type GuideSelection = { id: string; visible: boolean; beacons: boolean };
export type GuideDocument = { version: 1; custom: BandMapGuide[]; desk: GuideSelection; detached: GuideSelection };
export const emptyGuideDocument = (): GuideDocument => ({ version: 1, custom: [], desk: { id: "legacy", visible: true, beacons: false }, detached: { id: "legacy", visible: true, beacons: false } });
const boundedText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\u0000-\u001f]/.test(v);
const hz = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 100_000 && Number(v) <= 1_000_000_000;
export function validateGuide(value: unknown): BandMapGuide {
  const g = value as BandMapGuide;
  if (!g || g.version !== 1 || g.units !== "Hz" || !boundedText(g.id, 80) || !/^[A-Za-z0-9._-]+$/.test(g.id) || !boundedText(g.name, 80) || !g.name.trim() || !boundedText(g.region, 80) || !["built-in", "custom"].includes(g.origin) || !boundedText(g.sourceURL, 512) || !boundedText(g.reviewed, 32) || !Array.isArray(g.supportedBands) || g.supportedBands.length > 32 || !g.supportedBands.every(b => boundedText(b, 16)) || !Array.isArray(g.ranges) || g.ranges.length > 128 || !Array.isArray(g.markers) || g.markers.length > 128) throw new Error("Invalid xLog guide: version 1, Hz units and bounded profile fields are required.");
  if (!g.ranges.every(r => r && hz(r.startHz) && hz(r.endHz) && r.startHz < r.endHz && /^#[0-9a-fA-F]{6}$/.test(r.color) && boundedText(r.label, 64)) || !g.markers.every(m => m && hz(m.frequencyHz) && boundedText(m.label, 64) && boundedText(m.category, 32) && (m.mode === undefined || ["CW", "USB", "LSB", "FM", "AM"].includes(m.mode)))) throw new Error("Invalid guide range or marker: use integer Hz, increasing bounds and #RRGGBB colors.");
  return g;
}
export function parseGuide(text: string): BandMapGuide {
  if (new TextEncoder().encode(text).length > 131_072) throw new Error("Guide imports are limited to 128 KiB.");
  try { return validateGuide(JSON.parse(text)); } catch (cause) { throw new Error(cause instanceof SyntaxError ? "Guide file is not valid JSON." : String((cause as Error).message)); }
}
export function readGuideDocument(text?: string): GuideDocument {
  if (!text) return emptyGuideDocument();
  const doc = JSON.parse(text) as GuideDocument;
  if (text.length > 524_288 || doc.version !== 1 || !Array.isArray(doc.custom) || doc.custom.length > 16 || new Set(doc.custom.map(g => g.id)).size !== doc.custom.length) throw new Error("Invalid guide collection.");
  doc.custom.forEach(g => { validateGuide(g); if (g.origin !== "custom" || g.id.startsWith("builtin-")) throw new Error("Only custom guides can be saved."); });
  for (const s of [doc.desk, doc.detached]) if (!s || !boundedText(s.id, 80) || !["legacy", "builtin-r1-hf-2020", "builtin-r3-2024", ...doc.custom.map(g => g.id)].includes(s.id) || typeof s.visible !== "boolean" || typeof s.beacons !== "boolean") throw new Error("Invalid guide selection.");
  return doc;
}
export function clippedGuideRange(range: GuideRange, lowKHz: number, highKHz: number) {
  const start = Math.max(range.startHz, lowKHz * 1000), end = Math.min(range.endHz, highKHz * 1000), span = (highKHz - lowKHz) * 1000;
  return end > start && span > 0 ? { top: (start - lowKHz * 1000) / span * 100, height: (end - start) / span * 100 } : null;
}
export const ibpMarkers: GuideMarker[] = [14_100_000, 18_110_000, 21_150_000, 24_930_000, 28_200_000].map(frequencyHz => ({ frequencyHz, label: "IBP beacon frequency", category: "IBP reference", mode: "CW" }));
