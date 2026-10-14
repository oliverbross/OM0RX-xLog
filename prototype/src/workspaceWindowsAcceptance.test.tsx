// @vitest-environment jsdom
import { createElement as h, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyWorkspaceWindows } from "./workspaceWindowsAcceptance";
import { nativeWorkspaceWindowIDs } from "./live/useWorkspaceWindows";
import { workspaceDraftMarker } from "./logbookLayoutAcceptance";
import WorkspaceSettings from "./live/WorkspaceSettings";
import ServiceSettings from "./live/ServiceSettings";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "./live/workspaceLayoutSession";

const hook = vi.hoisted(() => ({ status: null as any, error: "", retrying: false, retry: vi.fn(async () => {}) }));
vi.mock("./live/useWorkspaceWindows", async importOriginal => ({
  ...await importOriginal<typeof import("./live/useWorkspaceWindows")>(), useWorkspaceWindows: () => hook,
}));

const presetID = "desk-87654321-1234-1234-1234-123456789abc";
const instanceID = "same-logbook-renderer";
const initial = { status: "passed", details: { instanceID } };
const supported = [...nativeWorkspaceWindowIDs];
type Failure = "instance" | "closed" | "dirty" | "contact" | "draft" | "stale" | "phase";
function fixture(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  return { generation: "12345678-1234-1234-1234-123456789abc", revision: 7, document: {
    version: 2, activePresetID: "traditional", presets: ["traditional", "windowed"].map(id => ({
      id, name: id === "traditional" ? "Traditional" : "Windowed", width: 1920, height: 1080,
      locked: true, snap: true, panels: structuredClone(panels),
    })),
  } };
}
beforeEach(() => {
  localStorage.clear(); hook.error = ""; hook.retrying = false; hook.retry.mockClear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("87654321-1234-1234-1234-123456789abc");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest("[hidden]") ? [] : [{ width: 1280, height: 800 }]) as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); hook.status = null; });

async function setup(options: { failure?: Failure; delayedVisibility?: boolean } = {}) {
  let snapshot = fixture(), attempt = 1, phase = 0, managed = false, pendingHiddenReads = 0;
  let rowReads = 0, draftReads = 0;
  const rows = { total: 1, qsos: [{ id: "stored-contact", call: "W1AW", comment: "Stored original comment" }] };
  const operatorDraft = { id: "operator-draft", call: "OM0RX", comment: "Operator buffer" };
  const window = { open: true, visible: true, minimized: false,
    report: { status: "passed", details: { instanceID, phaseRevision: 0, workspaceDraft: null as any } } };
  const trace: string[] = [];
  let observationReady!: () => void;
  const observationWaiting = new Promise<void>(resolve => { observationReady = resolve; });
  let clockStarted = false;
  const beginObservationClock = () => {
    if (clockStarted) return;
    clockStarted = true; vi.useFakeTimers(); observationReady();
  };
  const status = (value: LayoutSnapshot) => {
    const requested = value.document.presets.find(preset => preset.id === value.document.activePresetID)!
      .panels.find(panel => panel.id === "logbook")!.placement === "window";
    return { supported, generation: value.generation, revision: value.revision,
      presetID: value.document.activePresetID, state: "applied", shown: requested ? ["logbook"] : [],
      hidden: managed && !requested ? ["logbook"] : [], error: "", stopped: false, attempt };
  };
  const oldStatus = status(snapshot);
  hook.status = status(snapshot);
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_load") return { layout: structuredClone(snapshot) };
    if (method === "workspace_layout_apply") {
      if (params.expectedRevision !== snapshot.revision || params.generation !== snapshot.generation)
        throw new Error("The test attempted a stale layout mutation.");
      snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
      attempt++; hook.status = status(snapshot);
      trace.push(`layout:${params.action}:${params.presetID}`);
      if (params.action === "activatePreset") {
        const desired = snapshot.document.presets.find(preset => preset.id === snapshot.document.activePresetID)!
          .panels.find(panel => panel.id === "logbook")!.placement === "window";
        if (desired) { managed = true; window.visible = true; trace.push("native:revealed"); }
        else if (managed) {
          if (options.delayedVisibility) pendingHiddenReads = 3;
          else { window.visible = false; trace.push("native:hidden"); }
          if (options.failure === "instance") window.report.details.instanceID = "replacement-renderer";
          if (options.failure === "closed") window.open = false;
        }
      }
      return { status: "applied", layout: structuredClone(snapshot) };
    }
    if (method === "logbook_list") {
      rowReads++;
      return options.failure === "contact" && rowReads > 1
        ? { ...structuredClone(rows), qsos: [{ ...rows.qsos[0], comment: "Changed backend comment" }] } : structuredClone(rows);
    }
    if (method === "logbook_operator_draft") {
      draftReads++;
      return { draft: { qso: options.failure === "draft" && draftReads > 1
        ? { ...operatorDraft, comment: "Changed backend draft" } : structuredClone(operatorDraft) } };
    }
    throw new Error(`Unexpected worker authority ${method}`);
  });
  const native = vi.fn(async (command: string, args?: any) => {
    if (command === "workspace_windows_status") {
      if (options.failure === "stale") beginObservationClock();
      trace.push(`status:${snapshot.revision}:visible=${window.visible}`);
      return structuredClone(options.failure === "stale" ? oldStatus : status(snapshot));
    }
    if (command === "acceptance_window_state") {
      expect(args).toEqual({ kind: "logbook" });
      if (pendingHiddenReads && --pendingHiddenReads === 0) { window.visible = false; trace.push("native:hidden"); }
      return structuredClone(window);
    }
    if (command === "acceptance_window_step") {
      expect(args.kind).toBe("logbook");
      expect(["editor_prepare", "editor_probe", "editor_cancel"]).toContain(args.action);
      phase++; trace.push(`editor:${args.action}:visible=${window.visible}`);
      if (options.failure === "phase" && args.action === "editor_probe") beginObservationClock();
      window.report.details.phaseRevision = options.failure === "phase" && args.action === "editor_probe" ? phase - 1 : phase;
      window.report.details.workspaceDraft = args.action === "editor_cancel" ? { action: args.action, cancelled: true }
        : { action: args.action, dirty: true, draftComment: options.failure === "dirty" && args.action === "editor_probe"
          ? "Lost unsaved text" : workspaceDraftMarker };
      return { revision: phase, action: args.action };
    }
    throw new Error(`Unexpected native authority ${command}`);
  });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return h("main", { "aria-label": "Settings" }, h(ServiceSettings, {
      values: { operatorCall: "TEST" }, request, onChanged: vi.fn(), onSave: vi.fn(async () => {}), workspaceSettings: h(WorkspaceSettings, {
        state, session, available: ["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster", "logbook"],
      }),
    }));
  }
  let mounted = false;
  const controls = {
    worker: async (method: string, params?: Record<string, any>) => ({ result: await request(method, params) }),
    navigate: async (name: string) => {
      expect(name).toBe("Settings");
      if (!mounted) { await act(async () => { render(h(Harness)); }); mounted = true; }
    },
    fill: async (selector: string, value: string) => {
      const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (!element || element.disabled) throw new Error(`Missing enabled Settings control ${selector}`);
      await act(async () => { fireEvent.change(element, { target: { value } }); });
    },
    click: async (name: string, selector = "button") => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(button =>
        button.textContent?.trim() === name && !button.closest("[hidden]"));
      if (!button || button.disabled) throw new Error(`Missing enabled Settings action ${name}`);
      await act(async () => { fireEvent.click(button); });
    },
  };
  return { controls, native, request, trace, current: () => structuredClone(snapshot), window, observationWaiting };
}

it("proves adoption, hiding and revealing of one renderer with phase acknowledgements and unchanged backend data through real Settings", async () => {
  const context = await setup();
  const result = await verifyWorkspaceWindows(context.controls, initial, context.native);
  expect(result).toMatchObject({ presetID, instanceID, unmanagedRevision: 8, adoptedRevision: 9, hiddenRevision: 10,
    restoredRevision: 11, finalRevision: 12, preparedRevision: 1, hiddenProbeRevision: 2, visibleProbeRevision: 3, cancelledRevision: 4,
    manualWindowRetained: true, hiddenWithoutClosing: true, sameRenderer: true, dirtyEditPreserved: true,
    restoredVisible: true, cancelledWithoutSave: true, contactUnchanged: true, operatorDraftUnchanged: true, stationIO: false });
  expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")
    .map(([, params]) => [params.action, params.presetID])).toEqual([
      ["savePreset", presetID], ["activatePreset", presetID], ["activatePreset", "traditional"],
      ["activatePreset", presetID], ["activatePreset", "traditional"],
    ]);
  expect(context.trace.filter(item => item.startsWith("editor:"))).toEqual([
    "editor:editor_prepare:visible=true", "editor:editor_probe:visible=false", "editor:editor_probe:visible=true", "editor:editor_cancel:visible=true",
  ]);
  expect(context.window.open).toBe(true); expect(context.window.visible).toBe(false);
  expect(context.current().document.activePresetID).toBe("traditional");
  expect(context.request.mock.calls.every(([method]) => ["workspace_layout_load", "workspace_layout_apply", "logbook_list", "logbook_operator_draft"].includes(method))).toBe(true);
  expect(context.native.mock.calls.every(([command]) => ["workspace_windows_status", "acceptance_window_state", "acceptance_window_step"].includes(command))).toBe(true);
});

it.each([
  ["instance", "closed or replaced"], ["closed", "closed or replaced"], ["dirty", "unsaved Logbook edit was not preserved"],
  ["contact", "changed stored contacts or the operator draft"], ["draft", "changed stored contacts or the operator draft"],
] as const)("rejects %s evidence rather than claiming native workspace acceptance", async (failure, error) => {
  const context = await setup({ failure });
  await expect(verifyWorkspaceWindows(context.controls, initial, context.native)).rejects.toThrow(error);
});

it("waits for actual visibility after matching native applied metadata before probing the hidden editor", async () => {
  const context = await setup({ delayedVisibility: true });
  await verifyWorkspaceWindows(context.controls, initial, context.native);
  const metadata = context.trace.indexOf("status:10:visible=true");
  const actualHidden = context.trace.indexOf("native:hidden");
  const probe = context.trace.indexOf("editor:editor_probe:visible=false");
  expect(metadata).toBeGreaterThan(-1); expect(actualHidden).toBeGreaterThan(metadata); expect(probe).toBeGreaterThan(actualHidden);
});

it.each(["stale", "phase"] as const)("times out on %s native evidence with a deterministic clock", async failure => {
  const context = await setup({ failure });
  const outcome = verifyWorkspaceWindows(context.controls, initial, context.native).then(
    () => ({ error: null as Error | null }), error => ({ error: error as Error }));
  // Begin fake time only after the production Settings actions have settled;
  // their own act scopes remain independent of this native observation loop.
  await context.observationWaiting;
  await vi.advanceTimersByTimeAsync(20_100);
  expect((await outcome).error?.message).toContain(failure === "stale" ? "native placement" : "editor acknowledgement");
  expect(context.trace).not.toContain("editor:editor_cancel:visible=true");
});

it("requires a passed renderer identity before any UI, worker or native operation", async () => {
  const worker = vi.fn(), navigate = vi.fn(), fill = vi.fn(), click = vi.fn(), native = vi.fn();
  for (const report of [{}, { status: "failed", details: { instanceID } }, { status: "passed", details: { instanceID: "" } }])
    await expect(verifyWorkspaceWindows({ worker, navigate, fill, click }, report, native)).rejects.toThrow("renderer was not ready");
  for (const operation of [worker, navigate, fill, click, native]) expect(operation).not.toHaveBeenCalled();
});
