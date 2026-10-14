import { expect, it, vi } from "vitest";
import { changedLayout, panelMinimum, WorkspaceLayoutSession, workspacePanelIDs, type LayoutSnapshot } from "./workspaceLayoutSession";
import { protectWorkspaceModeEditor, switchWorkspaceMode, workspaceMode, workspaceModeEditorBusy } from "./workspaceMode";
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
