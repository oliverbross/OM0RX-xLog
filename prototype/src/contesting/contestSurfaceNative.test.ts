import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeContestSurfaceAction, contestSurfaceContextFromSearch, nextContestSurfaceAction, nextContestSurfaceEscape, onContestSurfaceWake,
  openContestContactEditorWindow, closeContestContactEditorWindow, publishContestSurface, readContestSurfaceSnapshot,
  submitContestSurfaceAction } from "./contestSurfaceNative";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const context = { operatingContext: "00000000-0000-4000-8000-000000000001",
  sessionID: "00000000-0000-4000-8000-000000000002", workspaceGeneration: "00000000-0000-4000-8000-000000000003" };
const action = { ...context, scope: "contesting", panelID: "active-qso", projectionRevision: 4,
  requestID: "00000000-0000-4000-8000-000000000004", action: "entry_set_frequency_text",
  params: { draftID: "draft-1", expectedDraftRevision: 5, value: "14.025A" } } as const;
const projection = { schemaVersion: 1, status: "ready", session: { name: "ARRL DX", ruleName: "ARRL DX CW", mode: "CW" },
  draft: { draftID: "draft-1", revision: 5, callsign: "OM0RX", sentReport: "599", receivedReport: "599", receivedFields: [],
    frequencyHz: null, frequencyText: "14.025A", frequencyError: "Use digits only", band: "20m", mode: "CW",
    dupe: { state: "unchecked", reason: "" }, validation: { errors: [], warnings: [] }, reservedSerial: null },
  busy: false, dirty: true, uncertain: false } as const;

beforeEach(() => { vi.resetAllMocks(); native.tauri = true; });

describe("contest native surface bridge", () => {
  it("requires a single canonical contest context in the detached URL", () => {
    const query = `?view=active-qso&scope=contesting&operatingContext=${context.operatingContext}&sessionID=${context.sessionID}&workspaceGeneration=${context.workspaceGeneration}`;
    expect(contestSurfaceContextFromSearch(query)).toEqual({ ...context, panelID: "active-qso" });
    expect(() => contestSurfaceContextFromSearch(`${query}&sessionID=${context.sessionID}`)).toThrow("could not be verified");
    expect(() => contestSurfaceContextFromSearch(query.replace("000000000001", "00000000000A"))).toThrow("could not be verified");
    expect(contestSurfaceContextFromSearch(query.replace("view=active-qso", "view=edit-contact")))
      .toEqual({ ...context, panelID: "logbook" });
  });

  it("opens and closes the original Edit Contact native window through bounded commands", async () => {
    native.invoke.mockResolvedValue(undefined);
    await openContestContactEditorWindow(context);
    await closeContestContactEditorWindow();
    expect(native.invoke.mock.calls).toEqual([
      ["contest_contact_editor_open", context], ["contest_contact_editor_close"],
    ]);
  });

  it("submits one exact action and rejects a coercible malformed receipt", async () => {
    native.invoke.mockResolvedValue({ requestID: action.requestID, status: "queued" });
    await expect(submitContestSurfaceAction(action)).resolves.toEqual({ requestID: action.requestID, status: "queued" });
    expect(native.invoke).toHaveBeenCalledWith("contest_surface_action", { envelope: action });
    native.invoke.mockResolvedValue({ requestID: action.requestID, status: ["queued"] });
    await expect(submitContestSurfaceAction(action)).rejects.toThrow("receipt could not be verified");
    native.tauri = false;
    await expect(submitContestSurfaceAction(action)).rejects.toThrow("native application");
  });

  it("accepts only a same-context queued action and completes with exact typed data", async () => {
    native.invoke.mockResolvedValueOnce(action).mockResolvedValueOnce(undefined);
    await expect(nextContestSurfaceAction(context)).resolves.toEqual(action);
    await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied", projectionRevision: 5 });
    expect(native.invoke.mock.calls).toEqual([["contest_surface_action_next", context], ["contest_surface_action_complete",
      { ...context, requestID: action.requestID, outcome: "applied", projectionRevision: 5 }]]);
    native.invoke.mockResolvedValue({ ...action, workspaceGeneration: "00000000-0000-4000-8000-000000000009" });
    await expect(nextContestSurfaceAction(context)).rejects.toThrow("could not be verified");
  });

  it("retries the exact native completion once when its acknowledgement is lost", async () => {
    const completion = { ...context, requestID: action.requestID, outcome: "applied" as const, projectionRevision: 5 };
    native.invoke.mockRejectedValueOnce(new Error("completion reply lost")).mockResolvedValueOnce(undefined);
    await expect(completeContestSurfaceAction(completion)).resolves.toBeUndefined();
    expect(native.invoke.mock.calls).toEqual([
      ["contest_surface_action_complete", completion],
      ["contest_surface_action_complete", completion],
    ]);
  });

  it("surfaces a completion failure after one bounded exact retry", async () => {
    const completion = { ...context, requestID: action.requestID, outcome: "rejected" as const,
      message: "Native export save failed.", projectionRevision: 5 };
    native.invoke.mockRejectedValue(new Error("journal unavailable"));
    await expect(completeContestSurfaceAction(completion)).rejects.toThrow("journal unavailable");
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.invoke.mock.calls[0]).toEqual(native.invoke.mock.calls[1]);
  });

  it("accepts only an exact same-context Escape from the dedicated priority take", async () => {
    const escape={...action,action:"entry_operator_key" as const,
      params:{draftID:"draft-1",expectedDraftRevision:4,key:"Escape" as const,focusedField:"callsign" as const}};
    native.invoke.mockResolvedValueOnce(escape);
    await expect(nextContestSurfaceEscape(context)).resolves.toEqual(escape);
    expect(native.invoke).toHaveBeenCalledWith("contest_surface_escape_next",context);
    native.invoke.mockResolvedValue(action);
    await expect(nextContestSurfaceEscape(context)).rejects.toThrow("Escape action could not be verified");
  });

  it("validates a panel projection before publishing", async () => {
    native.invoke.mockResolvedValue(undefined);
    const publication = { ...context, scope: "contesting", panelID: "active-qso", projectionRevision: 5, projection } as const;
    await publishContestSurface(publication);
    expect(native.invoke).toHaveBeenCalledWith("contest_surface_publish", publication);
    await expect(publishContestSurface({ ...publication, projection: { ...projection, unexpected: true } }))
      .rejects.toThrow("publication could not be verified");
    expect(native.invoke).toHaveBeenCalledOnce();
  });

  it("reads only an exact caller-scoped projection and bounded receipts", async () => {
    const snapshot = { ...context, scope: "contesting", panelID: "active-qso", projectionRevision: 5, projection,
      receipts: [{ requestID: action.requestID, status: "uncertain", message: null, projectionRevision: 4 }] };
    native.invoke.mockResolvedValue(snapshot);
    await expect(readContestSurfaceSnapshot(context)).resolves.toEqual(snapshot);
    expect(native.invoke).toHaveBeenCalledWith("contest_surface_snapshot", {
      sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration,
    });
    native.invoke.mockResolvedValue({ ...snapshot, receipts: [{ ...snapshot.receipts[0], status: ["uncertain"] }] });
    await expect(readContestSurfaceSnapshot(context)).rejects.toThrow("snapshot could not be verified");
    native.invoke.mockResolvedValue({ ...snapshot, workspaceGeneration: "00000000-0000-4000-8000-000000000009" });
    await expect(readContestSurfaceSnapshot(context)).rejects.toThrow("snapshot could not be verified");
  });

  it("treats the event as a payload-free wake", async () => {
    const refresh = vi.fn(); let listener!: (event: unknown) => void; const stop = vi.fn();
    native.listen.mockImplementation(async (_event, callback) => { listener = callback; return stop; });
    expect(await onContestSurfaceWake(refresh)).toBe(stop);
    expect(native.listen).toHaveBeenCalledWith("xlog:contest-surface", expect.any(Function));
    listener({ payload: { action: "entry_commit", forged: true } });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
