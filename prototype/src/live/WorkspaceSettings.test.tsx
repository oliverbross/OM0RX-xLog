// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspaceSettings from "./WorkspaceSettings";
import ServiceSettings from "./ServiceSettings";
import { customDeskPreset } from "./canvasGeometry";
import { operatorWorkspaceKey } from "./operatorWorkspacePreferences";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutChange, type LayoutSnapshot, type WorkspacePanelID } from "./workspaceLayoutSession";

const available: WorkspacePanelID[] = ["active-qso", "callsign-intelligence", "rotor", "antenna", "world-map", "band-maps", "dx-cluster", "station-status"];
const copyID = "desk-87654321-1234-1234-1234-123456789abc";
function fixture(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  const traditional = { id: "traditional", name: "Traditional", width: 1920, height: 1080, locked: true, snap: true, panels };
  const custom = customDeskPreset(traditional, 1080);
  Object.assign(custom.panels.find(panel => panel.id === "monitor")!, { placement: "window", z: 801,
    rect: { x: 80, y: 90, width: 900, height: 700 } });
  Object.assign(custom.panels.find(panel => panel.id === "station-status")!, { placement: "window", z: 802,
    rect: { x: 100, y: 110, width: 300, height: 90 } });
  return { generation: "12345678-1234-1234-1234-123456789abc", revision: 7,
    document: { version: 2, activePresetID: "traditional", presets: [traditional,
      { ...structuredClone(traditional), id: "windowed", name: "Windowed" }, custom] } };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("87654321-1234-1234-1234-123456789abc");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function setup(options: { requiredRotor?: boolean; rotorVisible?: boolean; maximum?: boolean } = {}) {
  let snapshot = fixture();
  if (options.rotorVisible) snapshot.document.presets[2].panels.find(panel => panel.id === "rotor")!.placement = "canvas";
  if (options.maximum) for (let index = snapshot.document.presets.length; index < 12; index++)
    snapshot.document.presets.push({ ...structuredClone(snapshot.document.presets[2]), id: `saved-${index}`, name: `Saved ${index}` });
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_apply") {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
      return { status: "applied", layout: structuredClone(snapshot) };
    }
    return { layout: structuredClone(snapshot) };
  });
  const journal = vi.fn(), session = new WorkspaceLayoutSession(request, journal);
  function Workspace() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <WorkspaceSettings state={state} session={session} available={available}
      equipment={options.requiredRotor ? "rotor" : undefined} requiredRotor={options.requiredRotor} />;
  }
  const writes = () => request.mock.calls.filter(([method]) => method === "workspace_layout_apply").map(([, params]) => params as LayoutChange);
  return { request, journal, session, Workspace, writes, current: () => structuredClone(snapshot),
    replace: (change: (snapshot: LayoutSnapshot) => void) => { snapshot = structuredClone(snapshot); change(snapshot); } };
}
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const choose = (id: string) => fireEvent.change(screen.getByLabelText("Saved layout"), { target: { value: id } });

it("saves a named Traditional duplicate without activating it, then switches only with Use layout", async () => {
  localStorage.setItem(operatorWorkspaceKey, JSON.stringify({ version: 1, activeTab: "cluster", mapPercent: 67 }));
  const context = setup(), original = context.current(); await context.session.refresh(); render(<context.Workspace />);
  fireEvent.click(button("Duplicate layout"));
  fireEvent.change(input("Layout name"), { target: { value: "  Evening DX  " } });
  expect(context.writes()).toEqual([]);
  fireEvent.click(button("Save layout")); await screen.findByText("Layout saved. Use layout to switch arrangements.");
  expect(context.writes().map(change => change.action)).toEqual(["savePreset"]);
  expect(context.current().document.activePresetID).toBe("traditional");
  expect(context.current().document.presets[0]).toEqual(original.document.presets[0]);
  const copy = context.current().document.presets.find(preset => preset.id === copyID)!;
  expect(copy.name).toBe("Evening DX"); expect(copy.locked).toBe(false);
  expect(copy.panels.find(panel => panel.id === "dx-cluster")!.placement).toBe("canvas");
  expect(copy.panels.find(panel => panel.id === "band-maps")!.placement).toBe("hidden");
  expect(copy.panels.find(panel => panel.id === "world-map")!.rect.width).toBeCloseTo(1908 * .67);
  fireEvent.click(button("Use layout"));
  await waitFor(() => expect(context.current().document.activePresetID).toBe(copyID));
  expect(context.writes().map(change => change.action)).toEqual(["savePreset", "activatePreset"]);
});

it("inspects and cancels a preset edit without writing shared layout data", async () => {
  const context = setup(); await context.session.refresh(); render(<context.Workspace />);
  choose("custom"); fireEvent.click(button("Edit layout"));
  fireEvent.change(input("Layout name"), { target: { value: "Unsaved desk" } });
  fireEvent.click(button("Cancel editing")); choose("traditional");
  expect(context.writes()).toEqual([]); expect(context.journal).not.toHaveBeenCalled();
  expect(context.current()).toEqual(fixture());
});

it("saves a custom rename, visibility, locking and snapping while preserving unsupported and separate-window roles", async () => {
  const context = setup(), source = context.current().document.presets[2];
  await context.session.refresh(); render(<context.Workspace />); choose("custom"); fireEvent.click(button("Edit layout"));
  const windowRole = screen.getByRole("checkbox", { name: "Station status · separate window retained" }) as HTMLInputElement;
  expect(windowRole.disabled).toBe(true); expect(screen.queryByRole("checkbox", { name: "Monitor" })).toBeNull();
  fireEvent.click(screen.getByText("Other panel placements retained"));
  expect(screen.getByText("Monitor — window; unavailable on this canvas")).toBeTruthy();
  fireEvent.change(input("Layout name"), { target: { value: "Contest desk" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "World map" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "DX Cluster" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Lock panel positions" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Snap to grid" }));
  fireEvent.click(button("Save layout")); await screen.findByText("Layout saved. Use layout to switch arrangements.");
  const saved = context.current().document.presets[2];
  expect(saved).toMatchObject({ name: "Contest desk", locked: true, snap: false });
  expect(saved.panels.find(panel => panel.id === "world-map")!.placement).toBe("hidden");
  expect(saved.panels.find(panel => panel.id === "dx-cluster")!.placement).toBe("canvas");
  for (const id of ["monitor", "station-status", "logbook", "spot-history", "settings"])
    expect(saved.panels.find(panel => panel.id === id)).toEqual(source.panels.find(panel => panel.id === id));
  expect(context.current().document.activePresetID).toBe("traditional");
});

it("protects built-in presets and requires confirmation to delete an inactive custom preset", async () => {
  const context = setup(); await context.session.refresh(); render(<context.Workspace />);
  expect(button("Edit layout").disabled).toBe(true); expect(button("Delete layout").disabled).toBe(true);
  choose("windowed");
  for (const name of ["Edit layout", "Delete layout", "Use layout", "Duplicate layout"]) expect(button(name).disabled).toBe(true);
  choose("custom"); fireEvent.click(button("Delete layout")); expect(context.writes()).toEqual([]);
  fireEvent.click(button("Cancel deletion")); expect(context.writes()).toEqual([]);
  fireEvent.click(button("Delete layout")); fireEvent.click(button("Confirm delete")); await screen.findByText("Layout deleted.");
  expect(context.writes()).toEqual([{ action: "deletePreset", presetID: "custom", expectedRevision: 7, generation: fixture().generation }]);
  expect(context.current().document.activePresetID).toBe("traditional");
});

it("prevents removing the active custom preset and refuses another duplicate at the preset limit", async () => {
  const context = setup({ maximum: true }); await context.session.refresh(); render(<context.Workspace />);
  expect(button("Duplicate layout").disabled).toBe(true);
  choose("custom"); fireEvent.click(button("Use layout"));
  await waitFor(() => expect(context.current().document.activePresetID).toBe("custom"));
  expect(button("Delete layout").disabled).toBe(true); expect(context.writes().map(change => change.action)).toEqual(["activatePreset"]);
});

it("requires the connected rotor to be visible before saving and prevents hiding it once visible", async () => {
  const context = setup({ requiredRotor: true }); await context.session.refresh(); render(<context.Workspace />);
  choose("custom"); fireEvent.click(button("Edit layout")); fireEvent.click(button("Save layout"));
  await screen.findByText("Show the connected rotor before saving this layout."); expect(context.writes()).toEqual([]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Rotor · connected rotor required" }));
  const rotor = screen.getByRole("checkbox", { name: "Rotor · connected rotor required" }) as HTMLInputElement;
  expect(rotor.checked).toBe(true); expect(rotor.disabled).toBe(true);
  fireEvent.click(button("Save layout")); await screen.findByText("Layout saved. Use layout to switch arrangements.");
  expect(context.current().document.presets[2].panels.find(panel => panel.id === "rotor")!.placement).toBe("canvas");
});

it("retains a draft and refuses a stale edit before journal or write after another window changes the layout", async () => {
  const context = setup(); await context.session.refresh(); render(<context.Workspace />);
  choose("custom"); fireEvent.click(button("Edit layout")); fireEvent.change(input("Layout name"), { target: { value: "Draft remains" } });
  context.replace(snapshot => { snapshot.revision++; snapshot.document.presets[2].panels.find(panel => panel.id === "monitor")!.rect.x = 999; });
  await act(() => context.session.refresh());
  fireEvent.click(button("Save layout"));
  await screen.findByText("The workspace changed after editing began. Reload and review it before saving.");
  expect(input("Layout name").value).toBe("Draft remains"); expect(context.writes()).toEqual([]);
  expect(context.journal).not.toHaveBeenCalled(); expect(context.current().document.presets[2].name).toBe("Custom");
  expect(context.current().document.presets[2].panels.find(panel => panel.id === "monitor")!.rect.x).toBe(999);
});

it.each(["retry", "discard"])("retains an unconfirmed draft and recovers only through explicit %s", async recovery => {
  const context = setup(); await context.session.refresh(); render(<context.Workspace />);
  choose("custom"); fireEvent.click(button("Edit layout")); fireEvent.change(input("Layout name"), { target: { value: "Retained intent" } });
  context.request.mockResolvedValueOnce({ status: "applied", layout: fixture() });
  fireEvent.click(button("Save layout"));
  await screen.findByText("The layout acknowledgement did not match the intended change. Reload to reconcile it.");
  expect(context.session.getSnapshot().pending).not.toBeNull(); expect(input("Layout name").value).toBe("Retained intent");
  expect(button("Save layout").disabled).toBe(true); expect(button("Cancel editing").disabled).toBe(true);
  expect(screen.getByLabelText("Layout name").closest("fieldset")!.disabled).toBe(true);
  fireEvent.click(button(recovery === "retry" ? "Retry layout change" : "Use saved layouts"));
  await screen.findByText(recovery === "retry" ? "Layout change confirmed." : "Using saved layouts. Unsaved layout changes discarded.");
  expect(context.session.getSnapshot().pending).toBeNull(); expect(screen.queryByLabelText("Layout name")).toBeNull();
  expect(context.current().document.presets[2].name).toBe(recovery === "retry" ? "Retained intent" : "Custom");
  expect(context.writes()).toHaveLength(recovery === "retry" ? 2 : 1);
});

it("keeps service fields and credentials mounted across Workspace and saves layouts independently of settings", async () => {
  const context = setup(); await context.session.refresh();
  const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "settings_save" ? { settings: params?.settings } : { saved: true });
  render(<ServiceSettings values={{ operatorCall: "OM0RX", stationCall: "OM0RX", wavelogURL: "https://example.invalid", wavelogStationID: 1 }}
    request={request} onSaved={vi.fn()} workspaceSettings={<context.Workspace />} />);
  const operator = input("Operator call"); fireEvent.change(operator, { target: { value: "W1AW" } });
  fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
  const token = input("Wavelog API v2 token"); fireEvent.change(token, { target: { value: "unit-test-draft-token" } });
  fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
  expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  fireEvent.click(button("Duplicate layout")); fireEvent.change(input("Layout name"), { target: { value: "Saved independently" } });
  fireEvent.click(button("Save layout")); await screen.findByText("Layout saved. Use layout to switch arrangements.");
  expect(context.writes()).toHaveLength(1); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
  expect(input("Wavelog API v2 token")).toBe(token); expect(token.value).toBe("unit-test-draft-token");
  fireEvent.click(screen.getByRole("tab", { name: "Station" }));
  expect(input("Operator call")).toBe(operator); expect(operator.value).toBe("W1AW");
  fireEvent.click(button("Save settings"));
  await waitFor(() => expect(request).toHaveBeenCalledWith("settings_save", { settings: {
    operatorCall: "W1AW", stationCall: "OM0RX", wavelogURL: "https://example.invalid", wavelogStationID: 1,
  } }));
  expect(JSON.stringify(context.writes())).not.toContain("unit-test-draft-token");
});
