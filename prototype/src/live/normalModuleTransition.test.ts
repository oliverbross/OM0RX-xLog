import { expect, it, vi } from "vitest";
import { normalEditorTransitionBlockReason, normalModuleTransitionController } from "./normalModuleTransition";
import { OperatorDraftSession } from "./operatorDraftSession";
import { LogbookContactSession } from "./logbookContactSession";

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

it("allows ordinary Quit with unregistered editors and no unfinished work", async () => {
  const request = vi.fn(), journal = vi.fn();
  const draft = new OperatorDraftSession(request, journal, null, undefined, true);
  const contact = new LogbookContactSession(request, journal, null, undefined, true);
  expect(draft.getSnapshot().activationFrozen).toBe(true);
  expect(contact.getSnapshot().activationFrozen).toBe(true);
  const state = { radioSettingsBlocked: false, readingRadio: false, working: false,
    pendingMutation: false, bufferedInput: false, dirty: false };
  const reason = () => normalEditorTransitionBlockReason(draft.getSnapshot(), contact.getSnapshot(), state);
  const controller = normalModuleTransitionController(reason, vi.fn());
  controller.freeze(); await expect(controller.prepare()).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled(); expect(journal).not.toHaveBeenCalled();
  state.bufferedInput = true;
  await expect(controller.prepare()).rejects.toThrow("partial frequency");
  state.bufferedInput = false; state.pendingMutation = true;
  await expect(controller.prepare()).rejects.toThrow("receipt and draft are retained");
  state.pendingMutation = false; state.dirty = true;
  await expect(controller.prepare()).rejects.toThrow("unsaved QSO draft");
});
