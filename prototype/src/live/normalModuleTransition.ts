import type { OperatingModuleTransitionController } from "../operatingModulePreparation";
import type { DraftSessionState } from "./operatorDraftSession";
import type { ContactEditState } from "./logbookContactSession";

/** Registration/activation status alone is not unfinished work. Actual draft,
 * operation and buffered-input state are checked here; native owners separately
 * retire active station operations. A failed registration must not trap Quit. */
export function normalEditorTransitionBlockReason(current: DraftSessionState, contact: ContactEditState,
  state: { radioSettingsBlocked: boolean; readingRadio: boolean; working: boolean;
    pendingMutation: boolean; bufferedInput: boolean; dirty: boolean }): string | false {
  if (state.radioSettingsBlocked) return "Save or Revert the normal window's radio setup and check its pending connection operation.";
  if (state.readingRadio) return "Check the retained Read radio operation in the normal logging window.";
  if (state.working) return "Wait for the normal window's logbook or workspace action to finish.";
  if (current.pending || contact.pending || state.pendingMutation || current.locked || contact.locked) return "Check the pending normal QSO, contact edit or Delete/Undo operation. Its receipt and draft are retained.";
  if (current.conflict || contact.conflict || current.workspaceChanged || contact.workspaceChanged) return "Resolve the normal window's editor conflict or changed workspace. Its draft is retained.";
  if (state.bufferedInput) return "Finish the partial frequency, time or other buffered field in the normal logging window.";
  if (state.dirty) return "Save or resolve the unsaved QSO draft in the normal logging window. Its text is retained.";
  if (contact.draft) return "Finish or cancel the logged-contact edit in the normal logging window.";
  return false;
}

/** Normal Logging keeps incomplete field text in the renderer. A restart is
 * allowed only when the existing editor/draft guard says nothing is buffered. */
export function normalModuleTransitionController(
  blocked: () => boolean | string,
  setFrozen: (frozen: boolean) => void,
): OperatingModuleTransitionController {
  return {
    freeze: () => setFrozen(true),
    prepare: async () => {
      const reason = blocked();
      if (reason) throw new Error(typeof reason === "string" ? reason
        : "Finish the buffered draft fields and resolve unsaved or pending QSO changes before changing operating module.");
    },
    resume: () => setFrozen(false),
  };
}
