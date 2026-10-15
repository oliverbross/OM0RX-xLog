// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceLayout, workspaceLayoutJournalKey } from "./useWorkspaceLayout";
import { changedLayout, panelMinimum, workspacePanelIDs, type LayoutChange, type LayoutSnapshot } from "./workspaceLayoutSession";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./workspaceLayoutTransport", () => ({ requestWorkspaceLayout: transport.request, connectWorkspaceLayout: () => () => {} }));
const fixture = (): LayoutSnapshot => ({ revision: 4, generation: "12345678-1234-1234-1234-123456789abc",
  document: { version: 2, activePresetID: "traditional", presets: [{ id: "traditional", name: "Desk", width: 1920, height: 1080,
    locked: true, snap: true, panels: workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
      return { id, z, placement: "hidden", rect: { x: 0, y: 0, width, height } }; }) }] } });
const change = (base: LayoutSnapshot, name: string): LayoutChange => ({ action: "savePreset", presetID: "traditional",
  preset: { ...structuredClone(base.document.presets[0]), name } });
beforeEach(() => { localStorage.clear(); transport.request.mockReset(); });
afterEach(cleanup);

it("keeps another window's unknown layout write recoverable after a concurrent save completes", async () => {
  const base = fixture();
  const writes: { params: any; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  transport.request.mockImplementation((method, params) => method.endsWith("load") ? Promise.resolve({ layout: structuredClone(base) })
    : new Promise((resolve, reject) => writes.push({ params, resolve, reject })));
  const main = renderHook(() => useWorkspaceLayout(false)), settings = renderHook(() => useWorkspaceLayout(false, "settings"));
  await act(async () => { await Promise.all([main.result.current.session.refresh(), settings.result.current.session.refresh()]); });
  let mainSave!: Promise<void>, settingsSave!: Promise<void>;
  act(() => {
    mainSave = main.result.current.session.apply(change(base, "Main intent"));
    settingsSave = settings.result.current.session.apply(change(base, "Settings intent"));
  });
  const settingsKey = workspaceLayoutJournalKey("settings"), retained = localStorage.getItem(settingsKey);
  expect(JSON.parse(retained!).change.preset.name).toBe("Settings intent");
  await act(async () => {
    writes[0].resolve({ status: "applied", layout: { ...base, revision: 5, document: changedLayout(base.document, writes[0].params) } });
    await mainSave;
    writes[1].reject(new Error("Acknowledgement unavailable"));
    await settingsSave;
  });
  expect(localStorage.getItem(workspaceLayoutJournalKey("main"))).toBeNull();
  expect(localStorage.getItem(settingsKey)).toBe(retained);
  main.unmount(); settings.unmount();
  const reopenedMain = renderHook(() => useWorkspaceLayout(false)), reopenedSettings = renderHook(() => useWorkspaceLayout(false, "settings"));
  expect(reopenedMain.result.current.state.pending).toBeNull();
  expect(reopenedSettings.result.current.state.pending?.change).toEqual(change(base, "Settings intent"));
  expect(writes).toHaveLength(2);
});

it("retains the legacy journal in main without importing the same intent into detached Settings", () => {
  const base = fixture(), pending = { base, change: change(base, "Recovered legacy intent") };
  localStorage.setItem("xlog.workspace.layout.pending.v1", JSON.stringify(pending));
  const settings = renderHook(() => useWorkspaceLayout(false, "settings")), main = renderHook(() => useWorkspaceLayout(false));
  expect(settings.result.current.state.pending).toBeNull();
  expect(main.result.current.state.pending).toEqual(pending);
  expect(localStorage.getItem("xlog.workspace.layout.pending.v1")).toBe(JSON.stringify(pending));
  expect(transport.request).not.toHaveBeenCalled();
});
