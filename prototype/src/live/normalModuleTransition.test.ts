import { expect, it, vi } from "vitest";
import { normalModuleTransitionController } from "./normalModuleTransition";

it("vetoes restart while a partial frequency or time field is still renderer-buffered", async () => {
  let bufferedPartialField = true;
  const setFrozen = vi.fn();
  const controller = normalModuleTransitionController(() => bufferedPartialField, setFrozen);

  controller.freeze();
  await expect(controller.prepare()).rejects.toThrow("buffered draft fields");
  controller.resume();
  expect(setFrozen.mock.calls).toEqual([[true], [false]]);

  bufferedPartialField = false;
  controller.freeze();
  await expect(controller.prepare()).resolves.toBeUndefined();
  expect(setFrozen).toHaveBeenLastCalledWith(true);
});

it("reports the specific retained normal-editor blocker without assuming a switch direction", async () => {
  const reason = "Check the pending normal QSO operation. Its receipt and draft are retained.";
  const controller = normalModuleTransitionController(() => reason, vi.fn());
  controller.freeze();
  await expect(controller.prepare()).rejects.toThrow(reason);
});
