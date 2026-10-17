// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import QSOEditor from "./live/QSOEditor";
import { verifyEditorFocus } from "./editorFocusAcceptance";

const draft = { generation: "00000000-0000-4000-8000-000000000001", revision: 0,
  qso: { id: "canonical-draft", call: "", start: "2026-10-14T00:00:00Z", frequencyHz: 14240000, band: "20m", mode: "SSB", comment: "Retained text" } };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(locked = false, refuseRoute = false) {
  const write = vi.fn(), save = vi.fn(), clear = vi.fn();
  const view = render(<main aria-label="Logbook"><button>Previously focused control</button></main>);
  (document.querySelector("button") as HTMLButtonElement).focus();
  const navigate = vi.fn(async (title: string) => {
    expect(title).toBe("Log QSO");
    if (!refuseRoute) await act(async () => { view.rerender(<main aria-label="Log QSO"><QSOEditor draft={draft.qso} setDraft={write}
      save={save} clear={clear} busy={false} draftLocked={locked} follow={false} setFollow={vi.fn()} lookup={null} previous={[]} /></main>); });
  });
  const worker = vi.fn(async (_method: string) => ({ result: { draft: structuredClone(draft) } }));
  return { navigate, worker, write, save, clear };
}
it("uses the main native route and the actual editor Escape focus without a duplicate Ctrl+L handler or draft writes", async () => {
  const context = fixture(), keys: KeyboardEvent[] = [];
  const record = (event: KeyboardEvent) => keys.push(event);
  window.addEventListener("keydown", record);
  try {
    const result = await verifyEditorFocus(context);
    expect(result).toEqual({ entry: "native-menu-route", screen: "log-qso", focusAction: "Escape", physicalAccelerator: false, sameDraft: true });
    expect(context.navigate).toHaveBeenCalledExactlyOnceWith("Log QSO");
    expect(document.activeElement).toBe(document.querySelector(".qso-call input"));
    expect(keys.map(event => [event.key, event.ctrlKey, event.metaKey])).toEqual([["Escape", false, false]]);
    expect(context.worker.mock.calls.map(([method]) => method)).toEqual(["logbook_operator_draft", "logbook_operator_draft"]);
    for (const mutation of [context.write, context.save, context.clear]) expect(mutation).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", record); }
});
it.each(["locked", "refused route"])("does not bypass a %s or fake keyboard focus", async reason => {
  vi.useFakeTimers();
  const context = fixture(reason === "locked", reason === "refused route");
  const rejected = expect(verifyEditorFocus(context)).rejects.toThrow("Timed out: editable full editor");
  await vi.advanceTimersByTimeAsync(0);
  await act(async () => {});
  vi.setSystemTime(Date.now() + 20_000);
  await vi.advanceTimersToNextTimerAsync(); await rejected;
  expect(document.activeElement).not.toBe(document.querySelector(".qso-call input"));
  expect(context.worker).toHaveBeenCalledOnce();
  for (const mutation of [context.write, context.save, context.clear]) expect(mutation).not.toHaveBeenCalled();
});
it("rejects changed canonical evidence even when the rendered keyboard focus works", async () => {
  const context = fixture();
  context.worker.mockResolvedValueOnce({ result: { draft: structuredClone(draft) } }).mockResolvedValueOnce({ result: { draft: { ...draft, revision: 1 } } });
  await expect(verifyEditorFocus(context)).rejects.toThrow("changed the shared draft");
});
