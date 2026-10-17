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
  if (!isTauri()) return;
  try { await invoke("workspace_mode_present", { generation: snapshot.generation, revision: snapshot.revision, hideMain }); }
  catch (cause) {
    throw cause instanceof Error ? cause : new Error(typeof cause === "string" && cause.trim()
      ? cause : "Workspace mode presentation failed.");
  }
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
  try {
    await present(saved.snapshot, canChange());
  } catch (cause) {
    // Native preflight can reject an unsaved detached editor, a reservation,
    // or uncertain CW. Restore the previous persisted mode at the exact saved
    // revision; never overwrite another window's intervening layout change.
    if (document.activePresetID !== presetID) {
      try {
        await session.applyAtBase({ action: "activatePreset", presetID: document.activePresetID }, saved.snapshot);
        const restored = session.getSnapshot();
        if (restored.pending || restored.error || restored.snapshot?.document.activePresetID !== document.activePresetID)
          throw new Error(restored.error || "The previous workspace mode could not be confirmed.");
      } catch (rollback) {
        throw new Error(`${cause instanceof Error ? cause.message : "Workspace presentation failed."} The previous mode could not be restored: ${rollback instanceof Error ? rollback.message : "reload Workspace settings before retrying."}`);
      }
    }
    throw cause;
  }
  return true;
}
