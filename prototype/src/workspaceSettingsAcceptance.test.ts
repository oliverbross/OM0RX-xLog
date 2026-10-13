// @vitest-environment jsdom
import { createElement as h, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyWorkspaceSettings } from "./workspaceSettingsAcceptance";
import WorkspaceSettings from "./live/WorkspaceSettings";
import ServiceSettings from "./live/ServiceSettings";
import OperatorCanvas from "./live/OperatorCanvas";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "./live/workspaceLayoutSession";

const presetID = "desk-87654321-1234-1234-1234-123456789abc";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function fixture(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  return { generation: "12345678-1234-1234-1234-123456789abc", revision: 7, document: {
    version: 2, activePresetID: "traditional", presets: ["traditional", "windowed"].map(id => ({
      id, name: id === "traditional" ? "Traditional" : "Windowed", width: 1920, height: 1080, locked: true, snap: true, panels: structuredClone(panels),
    })),
  } };
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("87654321-1234-1234-1234-123456789abc");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest("[hidden]") ? [] : [{ width: 1280, height: 800 }]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800, toJSON() {},
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

async function setup(changedDraft = false) {
  let snapshot = fixture(), draftReads = 0;
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_load") return { layout: structuredClone(snapshot) };
    if (method === "workspace_layout_apply") {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
      return { status: "applied", layout: structuredClone(snapshot) };
    }
    if (method === "logbook_operator_draft") return { draft: { qso: { id: "retained-draft", call: changedDraft && draftReads++ > 0 ? "CHANGED" : "W1AW" } } };
    throw new Error(`Unexpected acceptance worker method ${method}`);
  });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  function Harness({ route }: { route: string }) {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return h("main", { "aria-label": route }, route === "Settings"
      ? h(ServiceSettings, { values: { operatorCall: "OM0RX" }, request, onSaved: vi.fn(),
        workspaceSettings: h(WorkspaceSettings, { state, session, available: ["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster"] }) })
      : h(OperatorCanvas, { state, session, traditional: h("p", null, "Traditional controls"), panels: {
        "active-qso": { title: "Active QSO", content: h("input", { "aria-label": "Draft callsign", defaultValue: "W1AW" }) },
        "world-map": { title: "World map", content: h("p", null, "Map") },
        "band-maps": { title: "Band maps", content: h("p", null, "Bands") },
      } }));
  }
  const rendered = render(h(Harness, { route: "Operator Desk" }));
  let mount = 0;
  const routes: string[] = [];
  const controls = {
    worker: async (method: string, params?: Record<string, any>) => ({ result: await request(method, params) }),
    navigate: async (route: string) => { routes.push(route); await act(async () => {
      rendered.rerender(h(Harness, { route, key: ++mount })); await frame();
    }); },
    fill: async (selector: string, value: string) => {
      const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (!control) throw new Error(`Missing acceptance field ${selector}`);
      await act(async () => { fireEvent.change(control, { target: { value } }); await frame(); });
    },
    click: async (name: string, selector = "button") => {
      let found: HTMLButtonElement | undefined;
      await waitFor(() => {
        found = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(button => button.textContent?.trim() === name && button.getClientRects().length > 0);
        expect(found && !found.disabled).toBe(true);
      });
      await act(async () => { fireEvent.click(found!); await frame(); });
    },
  };
  return { request, controls, routes, current: () => structuredClone(snapshot) };
}

it("runs Settings → Workspace acceptance through production settings and canvas components with worker readbacks", async () => {
  const context = await setup();
  const result = await verifyWorkspaceSettings(context.controls);
  expect(result).toEqual({ presetID, initialRevision: 7, savedRevision: 8, renamedRevision: 10, restoredRevision: 11,
    activePreset: "traditional", savedInactive: true, activated: true, deskMatches: true, renamed: true, remount: true, sameDraft: true, stationIO: false });
  expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply").map(([, params]) => params.action))
    .toEqual(["savePreset", "activatePreset", "savePreset", "activatePreset"]);
  expect(context.request.mock.calls.every(([method]) => ["workspace_layout_load", "workspace_layout_apply", "logbook_operator_draft"].includes(method))).toBe(true);
  expect(context.current().document.presets[0]).toEqual(fixture().document.presets[0]);
  expect(context.current().document.presets.find(preset => preset.id === presetID)?.name).toBe("Acceptance layout renamed");
  expect(context.routes).toEqual(["Settings", "Operator Desk", "Settings", "Operator Desk", "Settings", "Operator Desk"]);
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Desk layout"]')?.value).toBe("traditional");
});

it("rejects changed draft evidence after restoring Traditional", async () => {
  const context = await setup(true);
  await expect(verifyWorkspaceSettings(context.controls)).rejects.toThrow("changed the operator draft");
  expect(context.current().document.activePresetID).toBe("traditional");
});

it("rejects missing layout or draft evidence before driving any UI controls", async () => {
  const navigate = vi.fn(), fill = vi.fn(), click = vi.fn();
  for (const missing of ["layout", "draft"]) {
    const worker = vi.fn(async (method: string) => ({ result: method === "workspace_layout_load"
      ? missing === "layout" ? {} : { layout: fixture() } : {} }));
    await expect(verifyWorkspaceSettings({ worker, navigate, fill, click })).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled(); expect(fill).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  }
});
