import type { OperatingModuleTransitionController } from "../operatingModulePreparation";

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
