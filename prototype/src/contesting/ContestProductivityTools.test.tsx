// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestNotesPanel, ContestSubmissionPanel, type NoteTarget } from "./ContestProductivityTools";
import { ContestServerError } from "./client";
import type { ContestRequest, ContestWorkerResponse } from "./types";

const scope = { sessionID: "source-session", workspaceGeneration: "workspace", revision: 7, draftID: "draft-original" };
const journalKey = `xlog.contest.note-editor.v1/${scope.sessionID}/${scope.workspaceGeneration}`;
const emptyNotes = vi.fn(async () => ({ id: "notes", ok: true as const, result: { rows: [], total: 0 } })) as unknown as ContestRequest;
const last = vi.fn(async () => ({ qsoID: "last-qso", callsign: "K1ABC" }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function noteProps(onSave: (target: NoteTarget, text: string, noteID: string) => Promise<void>) {
  return { scope, request: emptyNotes, disabled: false, onSave, onLast: last };
}
function startNote(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Note current" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Operator note" }), { target: { value: text } });
}
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it("journals before sending and recovers the same uncertain note identity after remount", async () => {
  const onSave = vi.fn(async (target: NoteTarget, text: string, noteID: string) => {
    expect(JSON.parse(localStorage.getItem(journalKey)!)).toEqual({ target, text, noteID });
    throw new Error("Reply lost after save");
  });
  const props = noteProps(onSave), mounted = render(<ContestNotesPanel {...props}/>);
  startNote("Signal faded during this caller");
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByRole("button", { name: "Reconcile same note" });
  const original = onSave.mock.calls[0];
  expect(original[0]).toEqual({ draftID: scope.draftID });
  expect(original[2]).toMatch(/^[0-9a-f-]{36}$/);
  expect((screen.getByRole("textbox", { name: "Operator note" }) as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Note current" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Note last QSO" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Cancel note" })).toBeNull();
  mounted.unmount();
  const reconciled = vi.fn(async (_target: NoteTarget, _text: string, _noteID: string) => {});
  render(<ContestNotesPanel {...noteProps(reconciled)} scope={{ ...scope, revision: 8, draftID: "new-draft" }}/>);
  expect((screen.getByRole("textbox", { name: "Operator note" }) as HTMLTextAreaElement).value).toBe(original[1]);
  fireEvent.click(screen.getByRole("button", { name: "Reconcile same note" }));
  await waitFor(() => expect(reconciled).toHaveBeenCalledOnce());
  expect(reconciled.mock.calls[0]).toEqual(original);
  await waitFor(() => expect(localStorage.getItem(journalKey)).toBeNull());
  expect(screen.queryByRole("textbox", { name: "Operator note" })).toBeNull();
});

it("keeps Note-current bound to its original draft when the entry advances before a delayed save", async () => {
  const saved = deferred<void>();
  const onSave = vi.fn((_target: NoteTarget, _text: string, _noteID: string) => saved.promise);
  const props = noteProps(onSave), mounted = render(<ContestNotesPanel {...props}/>);
  startNote("Observation for the original caller");
  mounted.rerender(<ContestNotesPanel {...props} scope={{ ...scope, draftID: "next-caller", revision: 8 }}/>);
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave.mock.calls[0][0]).toEqual({ draftID: "draft-original" });
  mounted.rerender(<ContestNotesPanel {...props} scope={{ ...scope, draftID: "third-caller", revision: 9 }}/>);
  expect(JSON.parse(localStorage.getItem(journalKey)!).target).toEqual({ draftID: "draft-original" });
  await act(async () => { saved.resolve(); await saved.promise; });
  expect(onSave).toHaveBeenCalledOnce();
  expect(localStorage.getItem(journalKey)).toBeNull();
});

it("allows editing after a confirmed rejection and assigns a fresh note identity to the corrected save", async () => {
  const onSave = vi.fn(async (_target: NoteTarget, _text: string, _noteID: string) => {});
  onSave.mockRejectedValueOnce(new ContestServerError("invalid_request", "Please correct this note", "confirmed"));
  render(<ContestNotesPanel {...noteProps(onSave)}/>);
  startNote("Original note");
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText("Please correct this note");
  expect(localStorage.getItem(journalKey)).toBeNull();
  const editor = screen.getByRole("textbox", { name: "Operator note" }) as HTMLTextAreaElement;
  expect(editor.disabled).toBe(false);
  fireEvent.change(editor, { target: { value: "Corrected operator observation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
  expect(onSave.mock.calls[1][1]).toBe("Corrected operator observation");
  expect(onSave.mock.calls[1][2]).not.toBe(onSave.mock.calls[0][2]);
  expect(localStorage.getItem(journalKey)).toBeNull();
});

it("drops submission preflight replies after the log revision advances and exports only the new reviewed digest", async () => {
  type Review = { revision: number; checks: { id: string; status: string; message: string }[]; manifest: { sha256: string; byteLength: number } };
  const oldReply = deferred<ContestWorkerResponse<Review>>(), newReply = deferred<ContestWorkerResponse<Review>>();
  const requestMock = vi.fn().mockReturnValueOnce(oldReply.promise).mockReturnValueOnce(newReply.promise);
  const onExport = vi.fn(async (_format: "cabrillo" | "adif" | "edi", _revision: number, _sha256: string) => {});
  const props = { scope, request: requestMock as ContestRequest, formats: ["cabrillo", "adif"], disabled: false, onExport };
  const mounted = render(<ContestSubmissionPanel {...props}/>);
  fireEvent.click(screen.getByRole("button", { name: "Review submission" }));
  mounted.rerender(<ContestSubmissionPanel {...props} scope={{ ...scope, revision: 8 }}/>);
  await act(async () => { oldReply.resolve({ id: "old", ok: true, result: { revision: 7, checks: [{ id: "old", status: "pass", message: "Old review" }], manifest: { sha256: "a".repeat(64), byteLength: 100 } } }); await oldReply.promise; });
  expect(screen.queryByText("Old review")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save reviewed export" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review submission" }));
  expect(requestMock.mock.calls[1][1].expectedRevision).toBe(8);
  await act(async () => { newReply.resolve({ id: "new", ok: true, result: { revision: 8, checks: [{ id: "new", status: "pass", message: "Current review" }], manifest: { sha256: "b".repeat(64), byteLength: 120 } } }); await newReply.promise; });
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed export" }));
  expect(onExport).toHaveBeenCalledWith("cabrillo", 8, "b".repeat(64));
});
