import { waitForAcceptance } from "./acceptance";
import { checkedLayout } from "./live/workspaceLayoutSession";

type Json = Record<string, any>;
type Controls = {
  worker: (method: string, params?: Json) => Promise<Json>;
  navigate: (name: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
const savedSelector = '.workspace-settings [aria-label="Saved layout"]';
const deskSelector = '[aria-label="Desk layout"]';
const ready = () => document.querySelector('.workspace-settings[aria-busy="false"]') !== null &&
  document.querySelector<HTMLSelectElement>(savedSelector)?.disabled === false;
const activeSelection = (id: string) => {
  const select = document.querySelector<HTMLSelectElement>(savedSelector);
  return ready() && select?.value === id && select.selectedOptions[0]?.textContent?.endsWith(" · active") === true;
};

/** Isolated native acceptance only. All changes use rendered controls and
 * read back through the packaged worker; no station or radio commands run. */
export async function verifyWorkspaceSettings({ worker, navigate, fill, click }: Controls) {
  const layout = async () => checkedLayout((await worker("workspace_layout_load")).result?.layout);
  const draft = async () => {
    const qso = (await worker("logbook_operator_draft")).result?.draft?.qso;
    if (!qso || typeof qso.id !== "string" || !qso.id || typeof qso.call !== "string")
      throw new Error("Missing operator draft for workspace settings acceptance.");
    return { id: qso.id as string, call: qso.call as string };
  };
  const original = await layout(), before = await draft();
  if (original.document.activePresetID !== "traditional" || !original.document.presets.some(preset => preset.id === "traditional"))
    throw new Error("Expected Traditional before workspace settings acceptance.");
  const openWorkspace = async () => {
    await navigate("Settings");
    await click("Workspace", '[role="tab"]');
    await waitForAcceptance("workspace settings loaded", ready);
  };
  await openWorkspace();
  await fill(savedSelector, "traditional");
  await click("Duplicate layout", ".workspace-settings button");
  await waitForAcceptance("workspace duplicate editor", () => !!document.querySelector(".workspace-name input"));
  await fill(".workspace-name input", "Acceptance layout");
  await click("Save layout", ".workspace-settings button");
  await waitForAcceptance("named layout saved without activation", () => ready() && !document.querySelector(".workspace-preset-editor"));
  const saved = await layout(), oldIDs = new Set(original.document.presets.map(preset => preset.id));
  const copies = saved.document.presets.filter(preset => !oldIDs.has(preset.id) && preset.name === "Acceptance layout");
  if (copies.length !== 1 || saved.document.activePresetID !== "traditional" || saved.generation !== original.generation || saved.revision !== original.revision + 1)
    throw new Error(`The named workspace was not saved independently of activation. ${JSON.stringify({
      originalRevision: original.revision, savedRevision: saved.revision, activePresetID: saved.document.activePresetID,
      generationMatches: saved.generation === original.generation, copyCount: copies.length,
    })}`);
  const presetID = copies[0].id;
  await fill(savedSelector, presetID);
  await click("Use layout", ".workspace-settings button");
  await waitForAcceptance("named workspace activated", () => activeSelection(presetID));
  const activated = await layout();
  if (activated.document.activePresetID !== presetID) throw new Error("The named workspace activation did not persist.");
  await navigate("Operator Desk");
  await waitForAcceptance("named layout on operator desk", () => {
    const select = document.querySelector<HTMLSelectElement>(deskSelector);
    return select?.value === presetID && !select.disabled;
  });
  await openWorkspace();
  await fill(savedSelector, presetID);
  await click("Edit layout", ".workspace-settings button");
  await waitForAcceptance("named workspace editor", () => document.querySelector<HTMLInputElement>(".workspace-name input")?.value === "Acceptance layout");
  await fill(".workspace-name input", "Acceptance layout renamed");
  await click("Save layout", ".workspace-settings button");
  await waitForAcceptance("renamed workspace saved", () => ready() && !document.querySelector(".workspace-preset-editor"));
  const renamed = await layout();
  if (renamed.document.presets.find(preset => preset.id === presetID)?.name !== "Acceptance layout renamed" || renamed.document.activePresetID !== presetID)
    throw new Error("The workspace rename did not persist.");
  await navigate("Operator Desk");
  await openWorkspace();
  const readback = await layout();
  const reopened = document.querySelector<HTMLSelectElement>(savedSelector);
  if (readback.document.presets.find(preset => preset.id === presetID)?.name !== "Acceptance layout renamed" ||
      ![...(reopened?.options ?? [])].some(option => option.value === presetID && option.textContent === "Acceptance layout renamed · active"))
    throw new Error("The saved workspace name was not restored after reopening Settings.");
  await fill(savedSelector, "traditional");
  await click("Use layout", ".workspace-settings button");
  await waitForAcceptance("Traditional restored through workspace settings", () => activeSelection("traditional"));
  const restored = await layout();
  if (restored.document.activePresetID !== "traditional") throw new Error("Workspace settings did not restore Traditional.");
  await navigate("Operator Desk");
  await waitForAcceptance("Traditional operator desk ready", () => {
    const select = document.querySelector<HTMLSelectElement>(deskSelector);
    return select?.value === "traditional" && !select.disabled;
  });
  const after = await draft();
  if (before.id !== after.id || before.call !== after.call) throw new Error("Workspace settings changed the operator draft.");
  return { presetID, initialRevision: original.revision, savedRevision: saved.revision, renamedRevision: renamed.revision,
    restoredRevision: restored.revision, activePreset: restored.document.activePresetID, savedInactive: true, activated: true,
    deskMatches: true, renamed: true, remount: true, sameDraft: true, stationIO: false };
}
