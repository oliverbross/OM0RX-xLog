export const qsoCanvasPanelIDs = ["active-contact", "qso-details", "callsign-intelligence", "previous-qsos", "band-mode-matrix"] as const;
export type QSOCanvasPanelID = typeof qsoCanvasPanelIDs[number];
export type QSOCanvasRect = { x: number; y: number; width: number; height: number };
export type QSOCanvasPanelLayout = { id: QSOCanvasPanelID; rect: QSOCanvasRect; z: number };
export type QSOCanvasLayout = { version: 1; width: number; height: number; panels: QSOCanvasPanelLayout[] };

export const qsoCanvasLayoutKey = "xlog.integration.qso-canvas-layout.v1";
export const qsoCanvasWidth = 1440;
export const qsoCanvasHeight = 1120;

const minimums: Record<QSOCanvasPanelID, [number, number]> = {
  "active-contact": [520, 180], "qso-details": [560, 320], "callsign-intelligence": [300, 260],
  "previous-qsos": [300, 200], "band-mode-matrix": [480, 220],
};

export const qsoCanvasResizeEdges = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type QSOCanvasResizeEdge = typeof qsoCanvasResizeEdges[number];

export function defaultQSOCanvasLayout(): QSOCanvasLayout {
  return { version: 1, width: qsoCanvasWidth, height: qsoCanvasHeight, panels: [
    { id: "active-contact", rect: { x: 0, y: 0, width: 1000, height: 210 }, z: 1 },
    { id: "qso-details", rect: { x: 0, y: 226, width: 1000, height: 594 }, z: 2 },
    { id: "band-mode-matrix", rect: { x: 0, y: 836, width: 1000, height: 284 }, z: 3 },
    { id: "callsign-intelligence", rect: { x: 1016, y: 0, width: 424, height: 520 }, z: 4 },
    { id: "previous-qsos", rect: { x: 1016, y: 536, width: 424, height: 300 }, z: 5 },
  ] };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clampRect = (id: QSOCanvasPanelID, rect: QSOCanvasRect): QSOCanvasRect => {
  const [minWidth, minHeight] = minimums[id];
  const width = Math.max(minWidth, Math.min(qsoCanvasWidth, rect.width));
  const height = Math.max(minHeight, Math.min(qsoCanvasHeight, rect.height));
  return { x: Math.max(0, Math.min(qsoCanvasWidth - width, rect.x)), y: Math.max(0, Math.min(qsoCanvasHeight - height, rect.y)), width, height };
};

export function readQSOCanvasLayout(raw: string | null): QSOCanvasLayout {
  const fallback = defaultQSOCanvasLayout();
  if (!raw || raw.length > 8192) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.panels)) return fallback;
    const panels = fallback.panels.map(defaultPanel => {
      const panel = value.panels.find((candidate: any) => candidate?.id === defaultPanel.id);
      const rect = panel?.rect;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)) return defaultPanel;
      const z = Number.isSafeInteger(panel.z) ? Math.max(0, Math.min(10000, panel.z)) : defaultPanel.z;
      return { id: defaultPanel.id, rect: clampRect(defaultPanel.id, rect), z };
    });
    return { ...fallback, panels };
  } catch { return fallback; }
}

export function moveQSOCanvasPanel(panel: QSOCanvasPanelLayout, dx: number, dy: number): QSOCanvasPanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  const snap = (value: number) => Math.round(value / 8) * 8;
  return { ...panel, rect: clampRect(panel.id, { ...panel.rect, x: snap(panel.rect.x + dx), y: snap(panel.rect.y + dy) }) };
}

export function resizeQSOCanvasPanel(panel: QSOCanvasPanelLayout, edge: QSOCanvasResizeEdge, dx: number, dy: number): QSOCanvasPanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  const snap = (value: number) => Math.round(value / 8) * 8, [minWidth, minHeight] = minimums[panel.id], original = panel.rect;
  let { x, y, width, height } = original;
  if (edge.includes("w")) { x = Math.max(0, Math.min(original.x + original.width - minWidth, snap(original.x + dx))); width = original.x + original.width - x; }
  if (edge.includes("e")) width = Math.max(minWidth, Math.min(qsoCanvasWidth - original.x, snap(original.width + dx)));
  if (edge.includes("n")) { y = Math.max(0, Math.min(original.y + original.height - minHeight, snap(original.y + dy))); height = original.y + original.height - y; }
  if (edge.includes("s")) height = Math.max(minHeight, Math.min(qsoCanvasHeight - original.y, snap(original.height + dy)));
  return { ...panel, rect: clampRect(panel.id, { x, y, width, height }) };
}
