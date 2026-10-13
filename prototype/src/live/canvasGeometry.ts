import { panelMinimum, type LayoutPreset, type PanelLayout, type LayoutRect } from "./workspaceLayoutSession";

export function adjustPanel(panel: PanelLayout, preset: LayoutPreset, kind: "move" | "resize", dx: number, dy: number): PanelLayout {
  if (![dx, dy].every(Number.isFinite)) return panel;
  const step = preset.snap ? 8 : 1, snap = (value: number) => Math.round(value / step) * step;
  const [minWidth, minHeight] = panelMinimum(panel.id), r = panel.rect;
  const rect: LayoutRect = kind === "move"
    ? { ...r, x: Math.max(0, Math.min(preset.width - r.width, snap(r.x + dx))), y: Math.max(0, Math.min(preset.height - r.height, snap(r.y + dy))) }
    : { ...r, width: Math.max(minWidth, Math.min(preset.width - r.x, snap(r.width + dx))), height: Math.max(minHeight, Math.min(preset.height - r.y, snap(r.height + dy))) };
  return { ...panel, rect, z: Math.min(10000, Math.max(...preset.panels.map(item => item.z)) + 1) };
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
