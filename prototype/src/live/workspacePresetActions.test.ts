import { expect, it } from "vitest";
import { activatePreset, deletePreset, duplicatePreset, maxWorkspacePresets, renamePreset, validatePresetName } from "./workspacePresetActions";
import { changedLayout, panelMinimum, validLayoutDocument, workspacePanelIDs, type LayoutDocument, type LayoutPreset } from "./workspaceLayoutSession";

function fixture(): LayoutDocument {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  return { version: 2, activePresetID: "traditional", presets: ["traditional", "windowed", "custom"].map(id => ({
    id, name: id, width: 1920, height: 1080, locked: id !== "custom", snap: true, panels: structuredClone(panels),
  })) };
}
function saved(change: ReturnType<typeof duplicatePreset>): LayoutPreset {
  if (change.action !== "savePreset") throw new Error("Expected savePreset");
  return change.preset;
}

it("trims names and measures their UTF-8 bytes while rejecting control, format, blank and reserved names", () => {
  expect(validatePresetName("  Evening DX  ")).toBe("Evening DX");
  expect(validatePresetName("é".repeat(50))).toHaveLength(50);
  for (const name of ["é".repeat(51), "a".repeat(101), " ", "desk\n", "de\u200bsk", "Traditional", " WINDOWED "])
    expect(() => validatePresetName(name)).toThrow();
});

it("duplicates Traditional as editable geometry with the selected Cluster tab and supplied map split", () => {
  const document = fixture(), source = document.presets[0];
  const monitor = source.panels.find(panel => panel.id === "monitor")!;
  Object.assign(monitor, { placement: "window", z: 875, rect: { x: 42, y: 66, width: 900, height: 700 } });
  const antenna = source.panels.find(panel => panel.id === "antenna")!;
  Object.assign(antenna, { placement: "canvas", z: 812, rect: { x: 1800, y: 1100, width: 240, height: 240 } });
  source.width = 2040; source.height = 1340;
  const original = structuredClone(document);
  const change = duplicatePreset(document, "traditional", "desk-new", " Contest ", {
    height: 900, equipment: "rotor", preferences: { mapPercent: 65, activeTab: "cluster" },
  });
  const preset = saved(change), map = preset.panels.find(panel => panel.id === "world-map")!;
  const cluster = preset.panels.find(panel => panel.id === "dx-cluster")!;
  expect(preset.id).toBe("desk-new"); expect(preset.name).toBe("Contest"); expect(preset.locked).toBe(false);
  expect(map.placement).toBe("canvas"); expect(map.rect.width).toBeCloseTo(1908 * .65);
  expect(cluster.placement).toBe("canvas"); expect(cluster.rect.x).toBeCloseTo(map.rect.width + 12);
  expect(cluster.rect.width).toBeCloseTo(1908 * .35);
  expect(preset.panels.find(panel => panel.id === "band-maps")!.placement).toBe("hidden");
  expect(preset.panels.find(panel => panel.id === "active-qso")!.placement).toBe("canvas");
  expect(preset.panels.find(panel => panel.id === "rotor")!.placement).toBe("canvas");
  const adapted = new Set(["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster", "rotor"]);
  for (const panel of preset.panels.filter(panel => !adapted.has(panel.id)))
    expect(panel).toEqual(source.panels.find(item => item.id === panel.id));
  expect(preset.width).toBe(2040); expect(preset.height).toBe(1340);
  expect(validLayoutDocument(changedLayout(document, change))).toBe(true);
  expect(document).toEqual(original);
  monitor.rect.x = 200; expect(preset.panels.find(panel => panel.id === "monitor")!.rect.x).toBe(42);
});

it("copies a custom preset without adapting any geometry or sharing nested values", () => {
  const document = fixture(), source = document.presets[2];
  Object.assign(source, { width: 3000, height: 1800, locked: false, snap: false });
  source.panels.forEach((panel, index) => Object.assign(panel, {
    placement: index % 2 ? "window" : "canvas", rect: { x: index * 10, y: index * 12, width: 700, height: 500 }, z: 900 - index,
  }));
  const original = structuredClone(document);
  const duplicate = saved(duplicatePreset(document, "custom", "desk-copy", "Copy", { preferences: { mapPercent: 80, activeTab: "cluster" } }));
  expect({ ...duplicate, id: source.id, name: source.name }).toEqual(source);
  duplicate.panels[0].rect.x = 123; expect(source.panels[0].rect.x).toBe(0); expect(document).toEqual(original);
});

it("requires a unique supplied ID and enforces the twelve-preset limit", () => {
  const document = fixture();
  for (const id of ["custom", "not_valid", "A", "", "x".repeat(65)])
    expect(() => duplicatePreset(document, "custom", id, "Copy")).toThrow("ID");
  for (let index = document.presets.length; index < maxWorkspacePresets; index++)
    document.presets.push({ ...structuredClone(document.presets[2]), id: `desk-${index}` });
  expect(document.presets).toHaveLength(12);
  expect(() => duplicatePreset(document, "custom", "desk-new", "Copy")).toThrow("limit is 12");
});

it("renames only custom presets and preserves every other property", () => {
  const document = fixture(), original = structuredClone(document);
  const renamed = saved(renamePreset(document, "custom", "  VHF desk  "));
  expect(renamed).toEqual({ ...document.presets[2], name: "VHF desk" });
  renamed.panels[0].rect.x = 80; expect(document).toEqual(original);
  for (const id of ["traditional", "windowed"]) expect(() => renamePreset(document, id, "Other")).toThrow("built-in");
  expect(() => renamePreset(document, "custom", "Traditional")).toThrow("reserved");
});

it("removes only inactive custom presets and keeps Windowed activation unavailable", () => {
  const document = fixture(), original = structuredClone(document);
  const next = changedLayout(document, deletePreset(document, "custom"));
  expect(next.presets.map(preset => preset.id)).toEqual(["traditional", "windowed"]);
  expect(document).toEqual(original);
  document.activePresetID = "custom"; expect(() => deletePreset(document, "custom")).toThrow("Activate another");
  for (const id of ["traditional", "windowed"]) expect(() => deletePreset(document, id)).toThrow("built-in");
  expect(activatePreset(document, "traditional")).toEqual({ action: "activatePreset", presetID: "traditional" });
  expect(activatePreset(document, "custom")).toEqual({ action: "activatePreset", presetID: "custom" });
  expect(() => activatePreset(document, "windowed")).toThrow("not available");
});
