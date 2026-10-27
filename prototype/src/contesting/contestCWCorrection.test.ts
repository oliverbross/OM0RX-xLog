import { expect, it } from "vitest";
import { confirmContestCWCall, dispatchContestCWCall, editContestCWCall, newContestCWCallState, previewContestCWCorrection, stopContestCWCall, type ContestCWCallScope } from "./contestCWCorrection";
const scope: ContestCWCallScope = { sessionID: "session", workspaceGeneration: "workspace", laneID: "laneA", draftID: "draft-a", bindingVersion: 2 };
const id = "00000000-0000-4000-8000-000000000001";
it("keeps editable text separate from the exact confirmed dispatched call and literal serial", () => {
  let state = editContestCWCall(newContestCWCallState(scope), scope, "K1ABC/P");
  expect(previewContestCWCorrection(state, scope, true).action).toBe("none");
  state = dispatchContestCWCall(state, scope, id, "00109");
  state = editContestCWCall(state, scope, "K1ABD/P");
  state = confirmContestCWCall(state, scope, id);
  expect(state.confirmed?.call).toBe("K1ABC/P");
  expect(state.unsentCall).toBe("K1ABD/P");
  expect(previewContestCWCorrection(state, scope).action).toBe("none");
  expect(previewContestCWCorrection(state, scope, true)).toMatchObject({ action: "whole-call", text: "K1ABD/P", serial: "00109", earlySend: false, incrementalCancellation: false });
});
it("backspace and Stop retain truthful sent and uncertain unsent evidence", () => {
  let state = editContestCWCall(newContestCWCallState(scope), scope, "K1ABC");
  state = confirmContestCWCall(dispatchContestCWCall(state, scope, id, "009"), scope, id);
  state = editContestCWCall(state, scope, "K1AB");
  state = dispatchContestCWCall(state, scope, "00000000-0000-4000-8000-000000000002", "009");
  state = stopContestCWCall(state, scope);
  expect(state.confirmed?.call).toBe("K1ABC");
  expect(state.unsentCall).toBe("K1AB");
  expect(state.attempt?.phase).toBe("uncertain");
  expect(previewContestCWCorrection(state, scope, true).action).toBe("blocked");
  expect(() => dispatchContestCWCall(state, scope, id, "009")).toThrow("cannot be replayed");
});
it("rejects stale lane, draft, binding and mismatched acceptance without altering another lane", () => {
  const original = editContestCWCall(newContestCWCallState(scope), scope, "W1ONE");
  for (const changed of [{ laneID: "laneB" as const }, { draftID: "next" }, { bindingVersion: 3 }]) {
    expect(() => stopContestCWCall(original, { ...scope, ...changed })).toThrow("another lane");
  }
  const dispatched = dispatchContestCWCall(original, scope, id, "001");
  expect(() => confirmContestCWCall(dispatched, scope, "foreign")).toThrow("does not match");
  expect(original.confirmed).toBeNull();
});
it("partials never dispatch and no per-character or early-send capability can be enabled", () => {
  const partial = editContestCWCall(newContestCWCallState(scope), scope, "W1?AB/P");
  expect(() => dispatchContestCWCall(partial, scope, id, "001")).toThrow("complete call");
  expect(partial.earlySend).toBe(false);
  expect(partial.incrementalCancellation).toBe(false);
});
it("binds the next action to the next draft and its supplied serial without guessing or formatting", () => {
  const sent = confirmContestCWCall(dispatchContestCWCall(editContestCWCall(newContestCWCallState(scope), scope, "K1ABC"), scope, id, "0099"), scope, id);
  const nextScope = { ...scope, draftID: "draft-next" }, nextID = "00000000-0000-4000-8000-000000000003";
  const next = dispatchContestCWCall(editContestCWCall(newContestCWCallState(nextScope), nextScope, "DL1NEXT/P"), nextScope, nextID, "0105");
  expect(next.attempt).toMatchObject({ call: "DL1NEXT/P", serial: "0105" });
  expect(next.confirmed).toBeNull();
  expect(sent.confirmed).toMatchObject({ call: "K1ABC", serial: "0099" });
  expect(() => confirmContestCWCall(next, scope, id)).toThrow("another lane");
});
