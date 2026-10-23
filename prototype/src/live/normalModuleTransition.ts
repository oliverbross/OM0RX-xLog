import type { OperatingModuleTransitionController } from "../operatingModulePreparation";

/** Normal Logging keeps incomplete field text in the renderer. A restart is
 * allowed only when the existing editor/draft guard says nothing is buffered. */
export function normalModuleTransitionController(
  blocked: () => boolean,
  setFrozen: (frozen: boolean) => void,
): OperatingModuleTransitionController {
  return {
    freeze: () => setFrozen(true),
    prepare: async () => {
      if (blocked()) throw new Error("Finish the buffered draft fields and resolve unsaved or pending QSO changes before switching to Contesting.");
    },
    resume: () => setFrozen(false),
  };
}
