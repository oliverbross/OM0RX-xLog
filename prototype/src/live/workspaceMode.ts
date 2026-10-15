import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LayoutSnapshot, WorkspaceLayoutSession } from "./workspaceLayoutSession";
export type WorkspaceMode = "canvas" | "windows";
const editorGuards = new Set<symbol>();
export const workspaceModeEditorBusy = () => editorGuards.size > 0;
export function protectWorkspaceModeEditor() {
  const token = Symbol(); editorGuards.add(token);
  return () => { editorGuards.delete(token); };
}
export const workspaceMode = (snapshot: LayoutSnapshot | null): WorkspaceMode => snapshot?.document.activePresetID === "windowed" ? "windows" : "canvas";
type Present = (snapshot: LayoutSnapshot, hideMain: boolean) => Promise<void>;
/** Native hide waits for task windows. Serialize requests so an older delayed
 * hide cannot finish after a newer recovery request has shown the main window. */
export function orderedWorkspacePresenter(send: Present): Present {
  let pending = Promise.resolve();
  return (snapshot, hideMain) => {
    const next = pending.catch(() => {}).then(() => send(snapshot, hideMain));
    pending = next;
    return next;
  };
}
export const presentWorkspaceMode = orderedWorkspacePresenter(async (snapshot, hideMain) => {
  if (isTauri()) await invoke("workspace_mode_present", { generation: snapshot.generation, revision: snapshot.revision, hideMain });
});
/** The shared layout revision is the mode authority, including lost-ack recovery. */
export async function switchWorkspaceMode(session: WorkspaceLayoutSession, mode: WorkspaceMode, canChange: () => boolean,
  present = presentWorkspaceMode): Promise<boolean> {
  const state = session.getSnapshot(), snapshot = state.snapshot;
  if (!snapshot) return false;
  if (!canChange() || state.pending || state.saving || state.conflict || state.workspaceChanged)
    throw new Error("Finish the draft fields and resolve unsaved or pending workspace changes before switching modes. Your work is retained.");
  const document = snapshot.document;
  const canvasID = document.presets.find(preset => preset.id === document.lastCanvasPresetID && preset.id !== "windowed")?.id
    ?? document.presets.find(preset => preset.id === "traditional")?.id ?? document.presets.find(preset => preset.id !== "windowed")?.id;
  const presetID = mode === "windows" ? "windowed" : canvasID;
  if (!presetID) throw new Error("The saved Canvas layout is unavailable. Review Workspace settings.");
  if (document.activePresetID !== presetID) await session.applyAtBase({ action: "activatePreset", presetID }, snapshot);
  const saved = session.getSnapshot();
  if (saved.pending || saved.error || !saved.snapshot) throw new Error(saved.error || "The workspace mode is not confirmed. Reload its saved layout.");
  await present(saved.snapshot, canChange());
  return true;
}
