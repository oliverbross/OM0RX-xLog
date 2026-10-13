import { customDeskPreset } from "./canvasGeometry";
import type { WorkspacePreferences } from "./operatorWorkspacePreferences";
import { changedLayout, type LayoutChange, type LayoutDocument, type LayoutPreset, type WorkspacePanelID } from "./workspaceLayoutSession";

export const maxWorkspacePresets = 12;
const reservedIDs = new Set(["traditional", "windowed"]);
const reservedNames = new Set(["traditional", "windowed"]);
export type DuplicatePresetOptions = {
  height?: number;
  equipment?: "rotor" | "antenna";
  preferences?: Pick<WorkspacePreferences, "mapPercent" | "activeTab">;
};

export function validatePresetName(value: string): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Use a workspace name without control characters.");
  const name = value.trim();
  if (!name) throw new Error("Enter a workspace name.");
  if (new TextEncoder().encode(name).length > 100) throw new Error("Workspace names can contain at most 100 UTF-8 bytes.");
  if (reservedNames.has(name.toLowerCase())) throw new Error("Traditional and Windowed are reserved workspace names.");
  return name;
}

function presetIn(document: LayoutDocument, id: string): LayoutPreset {
  const preset = document.presets.find(item => item.id === id);
  if (!preset) throw new Error("That workspace preset is no longer available.");
  return preset;
}
function checkedChange(document: LayoutDocument, change: LayoutChange): LayoutChange {
  changedLayout(document, change);
  return change;
}

function editableTraditional(source: LayoutPreset, options: DuplicatePresetOptions): LayoutPreset {
  const preset = customDeskPreset(source, options.height ?? source.height, options.equipment);
  const adapted = new Set<WorkspacePanelID>(["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster"]);
  if (options.equipment) adapted.add(options.equipment);
  // customDeskPreset intentionally hides its unused roles. Named copies retain
  // every role that this conversion does not deliberately adapt.
  preset.panels = preset.panels.map(panel => adapted.has(panel.id) ? panel
    : structuredClone(source.panels.find(item => item.id === panel.id)!));
  const map = preset.panels.find(panel => panel.id === "world-map")!;
  const tools = preset.panels.find(panel => panel.id === "band-maps")!;
  const usableWidth = map.rect.width + tools.rect.width;
  const percent = options.preferences?.mapPercent ?? 58;
  if (!Number.isFinite(percent)) throw new Error("The workspace map split is invalid.");
  const mapWidth = usableWidth * Math.max(20, Math.min(80, percent)) / 100;
  map.rect.width = mapWidth;
  const tab = options.preferences?.activeTab ?? "band-maps";
  if (tab !== "band-maps" && tab !== "cluster") throw new Error("The workspace tools tab is invalid.");
  for (const id of ["band-maps", "dx-cluster"] as const) {
    const panel = preset.panels.find(item => item.id === id)!;
    panel.rect = { ...tools.rect, x: mapWidth + 12, width: usableWidth - mapWidth };
    panel.placement = (tab === "cluster" ? id === "dx-cluster" : id === "band-maps") ? "canvas" : "hidden";
  }
  // Retained canvas roles can extend beyond the generated desk. Keep their
  // exact coordinates while preserving a valid shared document.
  for (const panel of preset.panels) if (panel.placement === "canvas") {
    preset.width = Math.max(preset.width, panel.rect.x + panel.rect.width);
    preset.height = Math.max(preset.height, panel.rect.y + panel.rect.height);
  }
  return preset;
}

/** Callers supply a fresh ID (for example `desk-${crypto.randomUUID()}`). */
export function duplicatePreset(document: LayoutDocument, sourceID: string, newID: string, name: string,
  options: DuplicatePresetOptions = {}): LayoutChange {
  const source = presetIn(document, sourceID);
  if (document.presets.length >= maxWorkspacePresets) throw new Error("Remove an unused preset before adding another. The limit is 12.");
  if (!/^[a-z0-9-]{1,64}$/.test(newID) || reservedIDs.has(newID) || document.presets.some(item => item.id === newID))
    throw new Error("Use a new, unique workspace preset ID.");
  const preset = sourceID === "traditional" ? editableTraditional(source, options) : structuredClone(source);
  preset.id = newID; preset.name = validatePresetName(name);
  return checkedChange(document, { action: "savePreset", presetID: newID, preset });
}

export function renamePreset(document: LayoutDocument, presetID: string, name: string): LayoutChange {
  const preset = presetIn(document, presetID);
  if (reservedIDs.has(presetID)) throw new Error("The built-in workspace names cannot be changed.");
  return checkedChange(document, { action: "savePreset", presetID,
    preset: { ...structuredClone(preset), name: validatePresetName(name) } });
}

export function deletePreset(document: LayoutDocument, presetID: string): LayoutChange {
  presetIn(document, presetID);
  if (reservedIDs.has(presetID)) throw new Error("The built-in workspaces cannot be removed.");
  if (document.activePresetID === presetID) throw new Error("Activate another workspace before removing this preset.");
  return checkedChange(document, { action: "deletePreset", presetID });
}

export function activatePreset(document: LayoutDocument, presetID: string): LayoutChange {
  presetIn(document, presetID);
  if (presetID === "windowed") throw new Error("Windowed workspace activation is not available here.");
  return checkedChange(document, { action: "activatePreset", presetID });
}
