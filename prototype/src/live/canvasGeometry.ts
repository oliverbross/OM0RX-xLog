import { panelMinimum, type LayoutPreset, type PanelLayout, type LayoutRect } from "./workspaceLayoutSession";

export const resizeEdges = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeEdge = typeof resizeEdges[number];

/** Resize selected edges while anchoring the opposite edges in canvas units. */
export function resizePanel(panel: PanelLayout, preset: LayoutPreset, edge: ResizeEdge, dx: number, dy: number): PanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  const step = preset.snap ? 8 : 1, snap = (value: number) => Math.round(value / step) * step;
  const [minWidth, minHeight] = panelMinimum(panel.id), r = panel.rect;
  let { x, y, width, height } = r;
  if (edge.includes("w")) { x = Math.max(0, Math.min(r.x + r.width - minWidth, snap(r.x + dx))); width = r.x + r.width - x; }
  if (edge.includes("e")) width = Math.max(minWidth, Math.min(preset.width - r.x, snap(r.width + dx)));
  if (edge.includes("n")) { y = Math.max(0, Math.min(r.y + r.height - minHeight, snap(r.y + dy))); height = r.y + r.height - y; }
  if (edge.includes("s")) height = Math.max(minHeight, Math.min(preset.height - r.y, snap(r.height + dy)));
  return { ...panel, rect: { x, y, width, height }, z: Math.min(10000, Math.max(...preset.panels.map(item => item.z)) + 1) };
}

export function adjustPanel(panel: PanelLayout, preset: LayoutPreset, kind: "move" | "resize", dx: number, dy: number): PanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  const step = preset.snap ? 8 : 1, snap = (value: number) => Math.round(value / step) * step;
  const [minWidth, minHeight] = panelMinimum(panel.id), r = panel.rect;
  const rect: LayoutRect = kind === "move"
    ? { ...r, x: Math.max(0, Math.min(preset.width - r.width, snap(r.x + dx))), y: Math.max(0, Math.min(preset.height - r.height, snap(r.y + dy))) }
    : { ...r, width: Math.max(minWidth, Math.min(preset.width - r.x, snap(r.width + dx))), height: Math.max(minHeight, Math.min(preset.height - r.y, snap(r.height + dy))) };
  return { ...panel, rect, z: Math.min(10000, Math.max(...preset.panels.map(item => item.z)) + 1) };
}

/** Trim unused height only: never move neighbours or create a new overlap. */
export function fitPanelHeight(panel: PanelLayout, preset: LayoutPreset, measuredHeight: number): PanelLayout {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return panel;
  const step = preset.snap ? 8 : 1;
  const height = Math.min(panel.rect.height, Math.max(panelMinimum(panel.id)[1], Math.ceil(measuredHeight / step) * step));
  return { ...panel, rect: { ...panel.rect, height } };
}

export function customDeskPreset(base: LayoutPreset, height: number, equipment?: "rotor" | "antenna"): LayoutPreset {
  const preset = structuredClone(base);
  preset.id = "custom"; preset.name = "Custom"; preset.locked = false; preset.width = 1920; preset.height = Math.max(640, Math.min(2160, height));
  preset.panels.forEach(panel => { panel.placement = "hidden"; });
  const top = Math.min(340, preset.height - 300);
  const place = (id: PanelLayout["id"], rect: LayoutRect) => { const panel = preset.panels.find(item => item.id === id)!; panel.placement = "canvas"; panel.rect = rect; };
  place("active-qso", { x: 0, y: 0, width: equipment ? 980 : 1140, height: top });
  place("callsign-intelligence", { x: equipment ? 992 : 1152, y: 0, width: equipment ? 600 : 768, height: top });
  if (equipment) place(equipment, { x: 1604, y: 0, width: 316, height: top });
  place("world-map", { x: 0, y: top + 12, width: 1100, height: preset.height - top - 12 });
  place("band-maps", { x: 1112, y: top + 12, width: 808, height: preset.height - top - 12 });
  return preset;
}
