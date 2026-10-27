// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestNotesPanel, ContestSubmissionPanel, type NoteTarget } from "./ContestProductivityTools";
import { ContestServerError } from "./client";
import type { ContestRequest, ContestWorkerResponse } from "./types";
import { flushUnfinishedEditors } from "./unfinishedEditors";

const scope = { sessionID: "source-session", workspaceGeneration: "workspace", revision: 7, draftID: "draft-original" };
const journalKey = `xlog.contest.note-editor.v1/${scope.sessionID}/${scope.workspaceGeneration}`;
const operationRaw=()=>localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith(`${journalKey}/operation/`))??journalKey);
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
afterEach(() => { vi.restoreAllMocks();flushUnfinishedEditors();cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it("freezes a note's original lane and binding while the selected entry moves to another lane", async () => {
  const save = vi.fn(async (_target: NoteTarget, _text: string, _noteID: string) => {});
  const a = { ...scope, laneID: "laneA" as const, bindingVersion: 3, bindingGeneration: 9 };
  const b = { ...scope, laneID: "laneB" as const, bindingVersion: 8, bindingGeneration: "receiver-b", draftID: "draft-b", revision: 8 };
  const mounted = render(<ContestNotesPanel {...noteProps(save)} scope={a}/>);
  startNote("Heard on receiver A");
  mounted.rerender(<ContestNotesPanel {...noteProps(save)} scope={b}/>);
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toEqual({ draftID: scope.draftID, laneID: "laneA", bindingVersion: 3, bindingGeneration: 9 });
  expect(emptyNotes).toHaveBeenCalledWith("contest_notes", expect.objectContaining({ laneID: "laneB", bindingVersion: 8, bindingGeneration: "receiver-b" }));
});

it("preserves malformed note recovery and blocks overwrite until explicitly archived despite successful notes reads", async () => {
  const raw = '{"text":"original recovery fragment"';
  localStorage.setItem(journalKey, raw);
  const notes = deferred<ContestWorkerResponse<{rows:never[];total:number}>>();
  const request = vi.fn(() => notes.promise) as unknown as ContestRequest;
  const onSave = vi.fn(async () => {}), props = {...noteProps(onSave),request};
  const mounted = render(<ContestNotesPanel {...props}/>);
  await act(async () => { notes.resolve({id:"notes",ok:true,result:{rows:[],total:0}});await notes.promise; });
  mounted.rerender(<ContestNotesPanel {...props} scope={{...scope,revision:8,draftID:"later-draft"}}/>);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Saved note recovery data is unreadable"));
  for(const name of ["Note current","Note last QSO"]) {
    const button=screen.getByRole("button",{name}) as HTMLButtonElement;
    expect(button.disabled).toBe(true);fireEvent.click(button);
  }
  expect(screen.queryByRole("textbox",{name:"Operator note"})).toBeNull();
  expect(onSave).not.toHaveBeenCalled();expect(localStorage.getItem(journalKey)).toBe(raw);
  mounted.unmount();render(<ContestNotesPanel {...props}/>);
  expect((screen.getByRole("button",{name:"Note current"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Archive unreadable recovery record"}));
  const archive=Object.keys(localStorage).find(key=>key.startsWith(`${journalKey}/unreadable/`));
  expect(archive).toBeTruthy();expect(localStorage.getItem(archive!)).toBe(raw);
  expect(localStorage.getItem(journalKey)).toBeNull();
  expect((screen.getByRole("button",{name:"Note current"}) as HTMLButtonElement).disabled).toBe(false);
});

it("journals before sending and recovers the same uncertain note identity after remount", async () => {
  const onSave = vi.fn(async (target: NoteTarget, text: string, noteID: string) => {
    expect(JSON.parse(operationRaw()!)).toMatchObject({ target, text, noteID, editorID:expect.any(String) });
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

it("reconciles a valid recovered journal without rewriting its whitespace or Unicode escapes",async()=>{
 const operation={target:{draftID:scope.draftID},text:"Lost reply Ω",noteID:"original-operation"};
 const raw=JSON.stringify(operation,null,2).replace("Ω","\\u03a9");localStorage.setItem(journalKey,raw);
 const save=vi.fn(async()=>{expect(localStorage.getItem(journalKey)).toBe(raw);});
 render(<ContestNotesPanel {...noteProps(save)}/>);fireEvent.click(screen.getByRole("button",{name:"Reconcile same note"}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(operation.target,operation.text,operation.noteID));await waitFor(()=>expect(localStorage.getItem(journalKey)).toBeNull());
});

it("keeps an uncertain save read-only if its retained journal changes or cannot be read",async()=>{
 const operation={target:{draftID:scope.draftID},text:"Keep original uncertain bytes",noteID:"original-operation"},raw=JSON.stringify(operation);
 localStorage.setItem(journalKey,raw);const save=vi.fn(async()=>{});render(<ContestNotesPanel {...noteProps(save)}/>);
 localStorage.setItem(journalKey,raw+" ");fireEvent.click(screen.getByRole("button",{name:"Reconcile same note"}));
 await screen.findByText(/its bytes changed/);expect(save).not.toHaveBeenCalled();expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).disabled).toBe(true);
 expect(screen.queryByRole("button",{name:"Discard draft"})).toBeNull();expect(localStorage.getItem(journalKey)).toBe(raw+" ");
 localStorage.setItem(journalKey,raw);
});

it("retains exact unsent text and original target across tab unmount, advancing entry and restart",async()=>{
 const save=vi.fn(async()=>{}),props=noteProps(save),mounted=render(<ContestNotesPanel {...props}/>);
 startNote("  First line\nŽluťoučký note, 73!  ");act(()=>flushUnfinishedEditors());
 expect(screen.getByText(/Draft retained locally/)).toBeTruthy();expect(localStorage.getItem(journalKey)).toBeNull();
 mounted.unmount();render(<ContestNotesPanel {...props} scope={{...scope,draftID:"next",revision:9}}/>);
 expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).value).toBe("  First line\nŽluťoučký note, 73!  ");
 fireEvent.click(screen.getByRole("button",{name:"Save note"}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0]).toEqual([{draftID:"draft-original"},"  First line\nŽluťoučký note, 73!  ",expect.any(String)]);
 expect(Object.keys(localStorage).filter(key=>key.includes("unsent-notes"))).toHaveLength(0);
});

it("Cancel retains a draft while deliberate Discard removes only that editor record",()=>{
 render(<ContestNotesPanel {...noteProps(vi.fn(async()=>{}))}/>);startNote("keep me");
 fireEvent.click(screen.getByRole("button",{name:"Cancel note (retain draft)"}));
 expect(screen.queryByLabelText("Operator note")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Resume retained note"}));
 expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).value).toBe("keep me");
 localStorage.setItem("unrelated-recovery","retain");fireEvent.click(screen.getByRole("button",{name:"Discard draft"}));
 expect(screen.queryByLabelText("Operator note")).toBeNull();expect(localStorage.getItem("unrelated-recovery")).toBe("retain");
});

it("a delayed Last-QSO selection cannot erase an editor opened while it was reading",async()=>{
 const lastReply=deferred<{qsoID:string;callsign:string}>();
 render(<ContestNotesPanel {...noteProps(vi.fn(async()=>{}))} onLast={()=>lastReply.promise}/>);
 fireEvent.click(screen.getByRole("button",{name:"Note last QSO"}));startNote("newly typed original bytes");
 await act(async()=>{lastReply.resolve({qsoID:"last",callsign:"K1ABC"});await lastReply.promise;});
 expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).value).toBe("newly typed original bytes");
 expect(screen.getByText(/Keep or discard the existing draft/)).toBeTruthy();
});

it("switching sessions recovers each original note without assigning it to the other session",()=>{
 const props=noteProps(vi.fn(async()=>{})),mounted=render(<ContestNotesPanel {...props}/>);startNote("session A");
 mounted.rerender(<ContestNotesPanel {...props} scope={{...scope,sessionID:"other-session",draftID:"other-draft"}}/>);
 expect(screen.queryByLabelText("Operator note")).toBeNull();startNote("session B");
 mounted.rerender(<ContestNotesPanel {...props}/>);
 expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).value).toBe("session A");expect(screen.getByText(/Bound to Current draft draft-or/)).toBeTruthy();
});

it("failed draft writes stay visible, block controlled navigation and never send a note",()=>{
 const save=vi.fn(async()=>{});render(<ContestNotesPanel {...noteProps(save)}/>);startNote("recover these bytes");
 const write=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("quota full");});
 expect(()=>flushUnfinishedEditors()).toThrow(/quota full/);expect(screen.getByLabelText("Operator note")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Save note"}));expect(save).not.toHaveBeenCalled();
 write.mockRestore();flushUnfinishedEditors();expect(Object.values(localStorage).join()).toContain("recover these bytes");
});

it("keeps simultaneous attempted operations separate, including the legacy uncertain journal",async()=>{
 const save=vi.fn(async()=>{});render(<ContestNotesPanel {...noteProps(save)}/>);startNote("second editor");
 const raw=JSON.stringify({target:{draftID:"original"},text:"first editor",noteID:"retained-operation"});localStorage.setItem(journalKey,raw);
 fireEvent.click(screen.getByRole("button",{name:"Save note"}));await screen.findByRole("button",{name:"Reconcile same note"});expect(save).not.toHaveBeenCalled();
 expect(localStorage.getItem(journalKey)).toBe(raw);
 expect((screen.getByLabelText("Operator note") as HTMLTextAreaElement).value).toBe("first editor");
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
  expect(JSON.parse(operationRaw()!).target).toEqual({ draftID: "draft-original" });
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

it("saves the frozen reviewed archive receipt and releases an obsolete archive without publishing it",async()=>{
  const prepared={artifactID:"archive-id",sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,revision:7,byteLength:900,sha256:"c".repeat(64),format:"archive" as const,filename:"review.zip"};
  const request=vi.fn(async()=>({id:"archive",ok:true,result:{revision:7,checks:[],manifest:{sha256:"a".repeat(64),byteLength:100},prepared,archiveManifest:{submissionStatus:"not-submitted"}}})) as unknown as ContestRequest;
  const onArchive=vi.fn(async()=>{}),onExport=vi.fn(async()=>{}),onRecordingIndex=vi.fn(async()=>({audioIncluded:false,status:"unavailable"}));
  const mounted=render(<ContestSubmissionPanel scope={scope} request={request} formats={["adif"]} disabled={false} onArchive={onArchive} onExport={onExport} onRecordingIndex={onRecordingIndex}/>);
  fireEvent.click(screen.getByRole("button",{name:"Review immutable archive"}));
  await screen.findByRole("button",{name:"Save reviewed immutable archive"});
  expect(request).toHaveBeenCalledWith("contest_submission_preflight",expect.objectContaining({archive:true,recordingIndex:{audioIncluded:false,status:"unavailable"}}));
  fireEvent.click(screen.getByRole("button",{name:"Save reviewed immutable archive"}));
  await waitFor(()=>expect(onArchive).toHaveBeenCalledWith(prepared));expect(onExport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Review immutable archive"}));
  await screen.findByRole("button",{name:"Save reviewed immutable archive"});
  mounted.rerender(<ContestSubmissionPanel scope={{...scope,revision:8}} request={request} formats={["adif"]} disabled={false} onArchive={onArchive} onExport={onExport}/>);
  expect(screen.queryByRole("button",{name:"Save reviewed immutable archive"})).toBeNull();
  expect(request).toHaveBeenCalledWith("contest_export_release",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,exportID:"archive-id"});
});
