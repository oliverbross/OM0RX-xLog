import { moveCanvasRect, resizeCanvasRect, resizeEdges, type ResizeEdge } from "./canvasGeometry";

export const hfPropagationPanelIDs = [
  "solar-conditions", "band-continent", "noaa-outlook", "wspr-activity", "wspr-paths",
  "band-activity", "modes-per-band", "rbn-pickups", "data-sources",
] as const;
export type HFPropagationPanelID = typeof hfPropagationPanelIDs[number];
export type HFPropagationDensity = "compact" | "comfortable" | "large";
export type HFPropagationCanvasRect = { x: number; y: number; width: number; height: number };
export type HFPropagationPanelLayout = { id: HFPropagationPanelID; rect: HFPropagationCanvasRect; z: number };
export type HFPropagationCanvasLayout = {
  version: 1;
  width: number;
  height: number;
  density: HFPropagationDensity;
  panels: HFPropagationPanelLayout[];
};

export const hfPropagationCanvasLayoutKey = "xlog.hf-propagation.canvas-layout.v1";
export const hfPropagationLegacyLayoutKey = "xlog.hf-propagation.layout.v1";
export const hfPropagationCanvasWidth = 1600;
export const hfPropagationCanvasHeight = 1940;
export const hfPropagationResizeEdges = resizeEdges;
export type HFPropagationResizeEdge = ResizeEdge;

const minimums: Record<HFPropagationPanelID, [number, number]> = {
  "solar-conditions": [600, 90],
  "band-continent": [520, 240],
  "noaa-outlook": [360, 260],
  "wspr-activity": [420, 210],
  "wspr-paths": [360, 210],
  "band-activity": [420, 240],
  "modes-per-band": [500, 220],
  "rbn-pickups": [500, 180],
  "data-sources": [500, 76],
};

export function defaultHFPropagationCanvasLayout(density: HFPropagationDensity = "comfortable"): HFPropagationCanvasLayout {
  return { version: 1, width: hfPropagationCanvasWidth, height: hfPropagationCanvasHeight, density, panels: [
    { id: "solar-conditions", rect: { x: 0, y: 0, width: 1600, height: 100 }, z: 1 },
    { id: "band-continent", rect: { x: 0, y: 120, width: 950, height: 460 }, z: 2 },
    { id: "noaa-outlook", rect: { x: 970, y: 120, width: 630, height: 460 }, z: 3 },
    { id: "wspr-activity", rect: { x: 0, y: 600, width: 950, height: 320 }, z: 4 },
    { id: "wspr-paths", rect: { x: 970, y: 600, width: 630, height: 660 }, z: 5 },
    { id: "band-activity", rect: { x: 0, y: 940, width: 950, height: 320 }, z: 6 },
    { id: "modes-per-band", rect: { x: 0, y: 1280, width: 1600, height: 320 }, z: 7 },
    { id: "rbn-pickups", rect: { x: 0, y: 1620, width: 1600, height: 220 }, z: 8 },
    { id: "data-sources", rect: { x: 0, y: 1860, width: 1600, height: 80 }, z: 9 },
  ] };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validDensity = (value: unknown): value is HFPropagationDensity => ["compact", "comfortable", "large"].includes(String(value));

function clampRect(id: HFPropagationPanelID, rect: HFPropagationCanvasRect): HFPropagationCanvasRect {
  const [minimumWidth, minimumHeight] = minimums[id];
  const width = Math.max(minimumWidth, Math.min(hfPropagationCanvasWidth, rect.width));
  const height = Math.max(minimumHeight, Math.min(hfPropagationCanvasHeight, rect.height));
  return {
    x: Math.max(0, Math.min(hfPropagationCanvasWidth - width, rect.x)),
    y: Math.max(0, Math.min(hfPropagationCanvasHeight - height, rect.y)),
    width,
    height,
  };
}

export function readHFPropagationCanvasLayout(raw: string | null, legacyRaw: string | null = null): HFPropagationCanvasLayout {
  let legacyDensity: HFPropagationDensity = "comfortable";
  try { const value = JSON.parse(legacyRaw || "null"); if (validDensity(value?.density)) legacyDensity = value.density; } catch { /* Use the default density. */ }
  const fallback = defaultHFPropagationCanvasLayout(legacyDensity);
  if (!raw || raw.length > 16_384) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.panels)) return fallback;
    const panels = fallback.panels.map(defaultPanel => {
      const panel = value.panels.find((candidate: unknown) => candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === defaultPanel.id);
      const rect = panel && typeof panel === "object" ? (panel as { rect?: HFPropagationCanvasRect }).rect : null;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)) return defaultPanel;
      const zValue = (panel as { z?: unknown }).z;
      const z = Number.isSafeInteger(zValue) ? Math.max(0, Math.min(10_000, Number(zValue))) : defaultPanel.z;
      return { id: defaultPanel.id, rect: clampRect(defaultPanel.id, rect), z };
    });
    return { ...fallback, density: validDensity(value.density) ? value.density : fallback.density, panels };
  } catch { return fallback; }
}

export function moveHFPropagationPanel(panel: HFPropagationPanelLayout, dx: number, dy: number): HFPropagationPanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  return { ...panel, rect: moveCanvasRect(panel.rect, { width: hfPropagationCanvasWidth, height: hfPropagationCanvasHeight, snap: true }, dx, dy) };
}

export function resizeHFPropagationPanel(panel: HFPropagationPanelLayout, edge: HFPropagationResizeEdge, dx: number, dy: number): HFPropagationPanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  return { ...panel, rect: resizeCanvasRect(panel.rect, { width: hfPropagationCanvasWidth, height: hfPropagationCanvasHeight, snap: true }, minimums[panel.id], edge, dx, dy) };
}
