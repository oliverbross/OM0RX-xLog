import { beforeEach, expect, it, vi } from "vitest";
import { changedLayout, panelMinimum, WorkspaceLayoutSession, workspacePanelIDs, type LayoutSnapshot } from "./workspaceLayoutSession";
import { orderedWorkspacePresenter, presentWorkspaceMode, protectWorkspaceModeEditor, switchWorkspaceMode, workspaceMode, workspaceModeEditorBusy } from "./workspaceMode";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
beforeEach(() => { vi.resetAllMocks(); native.isTauri.mockReturnValue(false); });
function fixture() {
  return { revision: 4, generation: "12345678-1234-1234-1234-123456789abc", document: { version: 2, activePresetID: "my-desk", presets:
    ["traditional", "windowed", "my-desk"].map(id => ({ id, name: id, width: 1920, height: 1080, locked: true, snap: true,
      panels: workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id); return { id, z, placement: "hidden", rect: { x: 16, y: 24, width, height } }; }) })) } } as LayoutSnapshot;
}
async function setup() {
  let saved = fixture();
  const request = vi.fn(async (method: string, params?: any) => {
    if (method.endsWith("load")) return { layout: structuredClone(saved) };
    saved = { ...saved, revision: saved.revision + 1, document: changedLayout(saved.document, params) };
    return { status: "applied", layout: structuredClone(saved) };
  });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  return { session, request, restart: async () => { const next = new WorkspaceLayoutSession(request); await next.refresh(); return next; } };
}
it("persists separate mode through restart and returns to the exact custom Canvas without changing any panel", async () => {
  const f = await setup(), before = structuredClone(f.session.getSnapshot().snapshot!.document.presets), present = vi.fn(async () => {});
  await switchWorkspaceMode(f.session, "windows", () => true, present);
  expect(f.session.getSnapshot().snapshot!.document.lastCanvasPresetID).toBe("my-desk");
  expect(workspaceMode(f.session.getSnapshot().snapshot)).toBe("windows");
  const restarted = await f.restart(); expect(workspaceMode(restarted.getSnapshot().snapshot)).toBe("windows");
  await switchWorkspaceMode(restarted, "canvas", () => true, present);
  expect(restarted.getSnapshot().snapshot!.document.activePresetID).toBe("my-desk");
  expect(restarted.getSnapshot().snapshot!.document.presets).toEqual(before);
  expect(f.request.mock.calls.map(([method]) => method)).toEqual(["workspace_layout_load", "workspace_layout_apply", "workspace_layout_load", "workspace_layout_apply"]);
  expect(present).toHaveBeenCalledTimes(2);
});
it("vetoes dirty or invalid editor text without writing or hiding the main surface", async () => {
  const f = await setup(), present = vi.fn(async () => {});
  await expect(switchWorkspaceMode(f.session, "windows", () => false, present)).rejects.toThrow("Your work is retained");
  expect(f.request).toHaveBeenCalledTimes(1); expect(present).not.toHaveBeenCalled();
});
it("keeps an unacknowledged activation pending and does not hide the main surface or replay the write", async () => {
  const f = await setup(), present = vi.fn(async () => {});
  f.request.mockRejectedValueOnce(new Error("ack lost"));
  await expect(switchWorkspaceMode(f.session, "windows", () => true, present)).rejects.toThrow("ack lost");
  await expect(switchWorkspaceMode(f.session, "canvas", () => true, present)).rejects.toThrow("pending");
  expect(present).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(2);
});
it("holds the mode guard for a layout editor until cleanup", () => {
  const release = protectWorkspaceModeEditor(); expect(workspaceModeEditorBusy()).toBe(true);
  release(); expect(workspaceModeEditorBusy()).toBe(false);
});
it("restores the saved Separate Windows preset after a detached editor veto or preflight timeout", async () => {
  for (const reason of ["Unsaved Logbook changes", "Editor preparation timed out", "Stop shared CW first"]) {
    const f = await setup();
    await switchWorkspaceMode(f.session, "windows", () => true, vi.fn(async () => {}));
    const before = structuredClone(f.session.getSnapshot().snapshot!.document);
    const present = vi.fn(async () => { throw new Error(reason); });
    await expect(switchWorkspaceMode(f.session, "canvas", () => true, present)).rejects.toThrow(reason);
    expect(f.session.getSnapshot().snapshot!.document).toEqual(before);
    expect(workspaceMode((await f.restart()).getSnapshot().snapshot)).toBe("windows");
    expect(present).toHaveBeenCalledOnce();
  }
});
it("reconciles a committed switch after acknowledgement loss without replaying mode activation", async () => {
  let saved = fixture(), loseAck = true;
  const request = vi.fn(async (method: string, params?: any) => {
    if (method.endsWith("load")) return { layout: structuredClone(saved) };
    saved = { ...saved, revision: saved.revision + 1, document: changedLayout(saved.document, params) };
    if (loseAck) { loseAck = false; throw new Error("reply lost"); }
    return { status: "applied", layout: saved };
  });
  const session = new WorkspaceLayoutSession(request), present = vi.fn(async () => {});
  await session.refresh();
  await expect(switchWorkspaceMode(session, "windows", () => true, present)).rejects.toThrow("reply lost");
  await session.refresh();
  expect(session.getSnapshot().pending).toBeNull(); expect(workspaceMode(session.getSnapshot().snapshot)).toBe("windows");
  await switchWorkspaceMode(session, "windows", () => true, present);
  expect(request.mock.calls.filter(([method]) => method.endsWith("apply"))).toHaveLength(1);
  expect(present).toHaveBeenCalledOnce();
});

it("shows recovery after an older delayed hide completes and continues after presentation failure", async () => {
  let finishHide!: () => void;
  const send = vi.fn(async (_snapshot: LayoutSnapshot, hide: boolean) => {
    if (hide) await new Promise<void>(resolve => { finishHide = resolve; });
  });
  const present = orderedWorkspacePresenter(send), snapshot = fixture();
  const hide = present(snapshot, true), recovery = present(snapshot, false);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0][1]).toBe(true);
  finishHide(); await Promise.all([hide, recovery]);
  expect(send.mock.calls.map(([, hide]) => hide)).toEqual([true, false]);
  send.mockRejectedValueOnce(new Error("Old revision"));
  await expect(present(snapshot, false)).rejects.toThrow("Old revision");
  await expect(present(snapshot, false)).resolves.toBeUndefined();
});

it("preserves native presentation rejection details so a retry can recover", async () => {
  native.isTauri.mockReturnValue(true);
  native.invoke.mockRejectedValue("Separate windows did not finish opening");
  await expect(presentWorkspaceMode(fixture(), true)).rejects.toThrow("Separate windows did not finish opening");
});

it("marks automatic presentation passive and preserves a separate explicit retry at the same layout identity", async () => {
  native.isTauri.mockReturnValue(true);
  native.invoke.mockResolvedValue(undefined);
  const snapshot = fixture();
  await presentWorkspaceMode(snapshot, true);
  await presentWorkspaceMode(snapshot, true, 7);
  expect(native.invoke.mock.calls).toEqual([
    ["workspace_mode_present", { generation: snapshot.generation, revision: snapshot.revision, hideMain: true }],
    ["workspace_mode_present", { generation: snapshot.generation, revision: snapshot.revision, hideMain: true, presentationTicket: 7 }],
  ]);
});

it("keeps explicit user intent with its queued presentation while a passive request is pending", async () => {
  let release!: () => void;
  let calls = 0;
  const send = vi.fn(async (_snapshot: LayoutSnapshot, _hide: boolean, _ticket?: number) => {
    if (++calls === 1) await new Promise<void>(resolve => { release = resolve; });
  });
  const present = orderedWorkspacePresenter(send), snapshot = fixture();
  const passive = present(snapshot, true), explicit = present(snapshot, true, 7);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0][2]).toBeUndefined();
  release(); await Promise.all([passive, explicit]);
  expect(send.mock.calls.map(([, , ticket]) => ticket)).toEqual([undefined, 7]);
});

it("marks an explicit same-mode request without replaying the persisted layout activation", async () => {
  native.isTauri.mockReturnValue(true); native.invoke.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
  const f = await setup(), present = vi.fn(async (_snapshot: LayoutSnapshot, _hide: boolean, _ticket?: number) => {});
  await switchWorkspaceMode(f.session, "windows", () => true, present);
  const writes = f.request.mock.calls.filter(([method]) => method === "workspace_layout_apply").length;
  await switchWorkspaceMode(f.session, "windows", () => true, present);
  expect(f.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(writes);
  expect(present.mock.calls.map(([, hide, ticket]) => [hide, ticket])).toEqual([[true, 7], [true, 8]]);
});

it("reserves before layout persistence and never reclaims an older switch after Main opens", async () => {
  native.isTauri.mockReturnValue(true);
  let latestIntent = 7, hidden = false, release!: () => void, saved = fixture();
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "workspace_presentation_begin") return latestIntent;
    if (command === "workspace_mode_present") { if (args.presentationTicket === latestIntent) hidden = args.hideMain; return; }
    throw new Error(command);
  });
  const journals: unknown[] = [];
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_load") return { layout: structuredClone(saved) };
    expect(native.invoke.mock.calls[0]).toEqual(["workspace_presentation_begin", { kind: "mode" }]);
    expect(params.presentationTicket).toBe(7);
    await new Promise<void>(resolve => { release = resolve; });
    saved = { ...saved, revision: saved.revision + 1, document: changedLayout(saved.document, params) };
    return { status: "applied", layout: structuredClone(saved) };
  });
  const session = new WorkspaceLayoutSession(request, journal => journals.push(journal));
  await session.refresh();
  const operation = switchWorkspaceMode(session, "windows", () => true);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  latestIntent = 8; // A later native Window -> Open Main admission.
  release(); await operation;
  expect(hidden).toBe(false);
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_presentation_begin")).toHaveLength(1);
  expect(native.invoke.mock.calls.at(-1)?.[1]).toMatchObject({ presentationTicket: 7 });
  expect(JSON.stringify(journals)).not.toContain("presentationTicket");
});
