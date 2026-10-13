// Isolated packaged acceptance only; uses production Settings and native owners.
import { invoke } from "@tauri-apps/api/core";
import { waitForAcceptance } from "./acceptance";
import { checkedLayout, type LayoutSnapshot } from "./live/workspaceLayoutSession";
import { readWorkspaceWindowsStatus } from "./live/useWorkspaceWindows";
import { workspaceDraftMarker } from "./logbookLayoutAcceptance";

type Json = Record<string, any>;
type Controls = {
  worker: (method: string, params?: Json) => Promise<Json>;
  navigate: (name: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
type Native = (command: string, args?: Json) => Promise<any>;
const savedSelector = '.workspace-settings [aria-label="Saved layout"]';
const ready = () => document.querySelector('.workspace-settings[aria-busy="false"]') !== null
  && document.querySelector<HTMLSelectElement>(savedSelector)?.disabled === false;
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

async function observe<T>(label: string, read: () => Promise<T>, accepts: (value: T) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: saved workspace ${label}`);
}

export async function verifyWorkspaceWindows({ worker, navigate, fill, click }: Controls, initial: Json, native: Native = invoke) {
  const instanceID = initial?.details?.instanceID;
  if (initial?.status !== "passed" || typeof instanceID !== "string" || !instanceID)
    throw new Error("The Logbook renderer was not ready for saved-window acceptance.");
  const layout = async () => checkedLayout((await worker("workspace_layout_load")).result?.layout);
  const windowState = async () => {
    const state = await native("acceptance_window_state", { kind: "logbook" });
    if (!state || typeof state.open !== "boolean" || typeof state.visible !== "boolean" || typeof state.minimized !== "boolean")
      throw new Error("Native window visibility was not observed.");
    if (!state.open || state.report?.details?.instanceID !== instanceID)
      throw new Error("A saved layout closed or replaced the Logbook renderer.");
    if (state.report?.status !== "passed") throw new Error(state.report?.error || "The Logbook renderer failed.");
    return state as Json;
  };
  const applied = async (expected: LayoutSnapshot) => observe("native placement", async () => {
    const status = readWorkspaceWindowsStatus(await native("workspace_windows_status"));
    const current = status.generation === expected.generation && status.revision === expected.revision
      && status.presetID === expected.document.activePresetID;
    if (current && status.state === "error") throw new Error(status.error || "Native placement failed.");
    return current && status.state === "applied" && !status.stopped;
  }, Boolean);
  const visible = (wanted: boolean) => observe("Logbook visibility", windowState,
    state => state.visible === wanted && (!wanted || state.minimized === false));
  const editor = async (action: "editor_prepare" | "editor_probe" | "editor_cancel") => {
    const step = await native("acceptance_window_step", { kind: "logbook", action });
    if (!Number.isSafeInteger(step?.revision) || step.revision < 1) throw new Error("Invalid native editor step.");
    const response = await observe("Logbook editor acknowledgement", windowState, state =>
      state.report.details.phaseRevision === step.revision && state.report.details.workspaceDraft?.action === action);
    const draft = response.report.details.workspaceDraft;
    if (action === "editor_cancel" ? draft.cancelled !== true : draft.dirty !== true || draft.draftComment !== workspaceDraftMarker)
      throw new Error("The unsaved Logbook edit was not preserved.");
    return step.revision as number;
  };
  const original = await layout();
  if (original.document.activePresetID !== "traditional") throw new Error("Expected Traditional before saved-window acceptance.");
  const originalRows = (await worker("logbook_list")).result;
  const originalDraft = (await worker("logbook_operator_draft")).result?.draft?.qso;
  if (!originalDraft?.id || originalRows?.total !== 1) throw new Error("Missing isolated contact/draft fixture.");
  await visible(true);
  const preparedRevision = await editor("editor_prepare");

  await navigate("Settings"); await click("Workspace", '[role="tab"]');
  await waitForAcceptance("window layout settings ready", ready);
  await fill(savedSelector, "traditional"); await click("Duplicate layout", ".workspace-settings button");
  await waitForAcceptance("Logbook placement choice", () => !!document.querySelector('[aria-label="Logbook placement"]'));
  await fill(".workspace-name input", "Native window acceptance");
  await fill('[aria-label="Logbook placement"]', "window");
  await click("Save layout", ".workspace-settings button");
  await waitForAcceptance("inactive window layout saved", () => ready() && !document.querySelector(".workspace-preset-editor"));
  const saved = await layout(), oldIDs = new Set(original.document.presets.map(preset => preset.id));
  const added = saved.document.presets.filter(preset => !oldIDs.has(preset.id));
  if (saved.generation !== original.generation || saved.revision !== original.revision + 1
    || saved.document.activePresetID !== "traditional" || added.length !== 1
    || added[0].panels.find(panel => panel.id === "logbook")?.placement !== "window")
    throw new Error("Saving an inactive window layout changed its activation or placement.");
  // A new persisted revision fences this observation; a cached same-revision
  // 'applied' after a queued retry would not prove that reconciliation ran.
  await applied(saved); await visible(true);
  const unmanagedRevision = saved.revision;
  const activate = async (id: string) => {
    await fill(savedSelector, id); await click("Use layout", ".workspace-settings button");
    await waitForAcceptance("saved window layout activated", () => ready()
      && document.querySelector<HTMLSelectElement>(savedSelector)?.selectedOptions[0]?.textContent?.endsWith(" · active") === true);
    const snapshot = await layout();
    if (snapshot.document.activePresetID !== id) throw new Error("Saved window activation did not persist.");
    await applied(snapshot); return snapshot;
  };
  const adopted = await activate(added[0].id); await visible(true);
  const hidden = await activate("traditional"); await visible(false);
  const hiddenProbeRevision = await editor("editor_probe");
  const restored = await activate(added[0].id); await visible(true);
  const visibleProbeRevision = await editor("editor_probe");
  const cancelledRevision = await editor("editor_cancel");
  const final = await activate("traditional"); await visible(false);
  const finalRows = (await worker("logbook_list")).result;
  const finalDraft = (await worker("logbook_operator_draft")).result?.draft?.qso;
  if (!same(originalRows, finalRows) || !same(originalDraft, finalDraft))
    throw new Error("Window placement changed stored contacts or the operator draft.");
  return { presetID: added[0].id, instanceID, unmanagedRevision, adoptedRevision: adopted.revision,
    hiddenRevision: hidden.revision, restoredRevision: restored.revision, finalRevision: final.revision,
    preparedRevision, hiddenProbeRevision, visibleProbeRevision, cancelledRevision,
    manualWindowRetained: true, hiddenWithoutClosing: true, sameRenderer: true, dirtyEditPreserved: true,
    restoredVisible: true, cancelledWithoutSave: true, contactUnchanged: true, operatorDraftUnchanged: true, stationIO: false };
}
