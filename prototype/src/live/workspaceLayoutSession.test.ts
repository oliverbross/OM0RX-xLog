import { expect, it, vi } from "vitest";
import { changedLayout, checkedLayout, panelMinimum, readLayoutJournal, validLayoutDocument, workspacePanelIDs,
  WorkspaceLayoutSession, type LayoutChange, type LayoutSnapshot } from "./workspaceLayoutSession";

function fixture(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  return { revision: 0, generation: "12345678-1234-1234-1234-123456789abc", document: { version: 1, activePresetID: "traditional",
    presets: ["traditional", "windowed"].map(id => ({ id, name: id, width: 1920, height: 1080, locked: true, snap: true, panels: structuredClone(panels) })) } };
}
const change: LayoutChange = { action: "activatePreset", presetID: "windowed" };
function applied(base: LayoutSnapshot): LayoutSnapshot { return { ...base, revision: base.revision + 1, document: changedLayout(base.document, change) }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

it("validates all 19 roles, bounded geometry, unique IDs, names and generations", () => {
  const base = fixture(); expect(validLayoutDocument(base.document)).toBe(true); expect(workspacePanelIDs).toHaveLength(19);
  for (const corrupt of [
    (s: LayoutSnapshot) => { s.document.presets[0].panels[0].rect.width = Infinity; },
    (s: LayoutSnapshot) => { s.document.presets[0].panels[0].rect.width = 10; },
    (s: LayoutSnapshot) => { s.document.presets[0].panels[0].placement = "canvas"; s.document.presets[0].panels[0].rect.x = 1900; },
    (s: LayoutSnapshot) => { s.document.presets[0].panels[0].id = "logbook"; },
    (s: LayoutSnapshot) => { s.document.presets[0].name = "bad\nname"; },
    (s: LayoutSnapshot) => { s.generation = "unscoped"; },
  ]) { const invalid = fixture(); corrupt(invalid); expect(() => checkedLayout(invalid)).toThrow(); }
  expect(() => changedLayout(base.document, null as any)).toThrow("Invalid workspace");
  expect(readLayoutJournal("broken")).toBeNull();
});
it("journals before a scoped CAS write, then adopts only a matching acknowledgement", async () => {
  const base = fixture(), events: string[] = [];
  const request = vi.fn(async (method: string, params?: any) => {
    if (method.endsWith("load")) return { layout: base };
    events.push("write"); expect(params).toEqual({ ...change, expectedRevision: 0, generation: base.generation });
    return { status: "applied", layout: applied(base) };
  });
  const session = new WorkspaceLayoutSession(request, value => events.push(value ? "journal" : "clear"));
  await session.refresh(); await session.apply(change);
  expect(events).toEqual(["journal", "write", "clear"]); expect(session.getSnapshot().pending).toBeNull();
  expect(session.getSnapshot().snapshot?.document.activePresetID).toBe("windowed");
});
it("refuses a mutation when its recovery journal cannot be saved", async () => {
  const request = vi.fn(async () => ({ layout: fixture() }));
  const session = new WorkspaceLayoutSession(request, () => { throw new Error("disk full"); });
  await session.refresh(); await expect(session.apply(change)).rejects.toThrow("disk full");
  expect(request).toHaveBeenCalledTimes(1); expect(session.getSnapshot().pending).toBeNull();
});
it("reconciles a lost acknowledgement after restart without replaying a write", async () => {
  const base = fixture(), journal = readLayoutJournal(JSON.stringify({ base, change }));
  const request = vi.fn(async () => ({ layout: applied(base) })), save = vi.fn();
  const session = new WorkspaceLayoutSession(request, save, journal);
  await session.refresh(); expect(session.getSnapshot().pending).toBeNull(); expect(save).toHaveBeenCalledWith(null);
  expect(request).toHaveBeenCalledExactlyOnceWith("workspace_layout_load");
});
it("retains intent on a stale conflict and does not infer acknowledgement from a later revision", async () => {
  const base = fixture(), current = { ...applied(base), revision: 2 };
  const request = vi.fn(async (_method: string) => ({ layout: current }));
  const session = new WorkspaceLayoutSession(request, () => {}, { base, change });
  await session.refresh(); expect(session.getSnapshot().conflict).toEqual(current); expect(session.getSnapshot().pending).not.toBeNull();
  await expect(session.retry()).rejects.toThrow("Review"); expect(request.mock.calls.every(([method]) => method === "workspace_layout_load")).toBe(true);
});
it("never replays old intent into a restored workspace even if revisions repeat", async () => {
  const base = fixture(), current = { ...base, generation: "87654321-1234-1234-1234-123456789abc" };
  const request = vi.fn(async () => ({ layout: current }));
  const session = new WorkspaceLayoutSession(request, () => {}, { base, change });
  await session.refresh(); expect(session.getSnapshot().workspaceChanged).toBe(true);
  await expect(session.retry()).rejects.toThrow("Review"); expect(session.getSnapshot().pending).not.toBeNull();
});
it("failed fresh read cannot retry from cached state", async () => {
  const base = fixture(), request = vi.fn().mockResolvedValueOnce({ layout: base }).mockRejectedValue(new Error("offline"));
  const session = new WorkspaceLayoutSession(request, () => {}, { base, change });
  await session.refresh(); await expect(session.retry()).rejects.toThrow("offline");
  expect(request.mock.calls.every(([method]) => method === "workspace_layout_load")).toBe(true);
  expect(session.getSnapshot().pending).not.toBeNull();
});
it("serializes explicit recovery and blocks competing retry, discard and apply", async () => {
  const base = fixture(), read = deferred<any>();
  const request = vi.fn().mockReturnValueOnce(read.promise).mockResolvedValueOnce({ status: "applied", layout: applied(base) });
  const session = new WorkspaceLayoutSession(request, () => {}, { base, change });
  const retry = session.retry();
  await expect(session.retry()).rejects.toThrow("Wait"); await expect(session.discard()).rejects.toThrow("Wait");
  await expect(session.apply(change)).rejects.toThrow("Resolve");
  read.resolve({ layout: base }); await retry;
  expect(request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(1);
});
it("discard requires a successful fresh read and cannot erase an intervening edit", async () => {
  const base = fixture(), request = vi.fn().mockRejectedValueOnce(new Error("offline")), save = vi.fn();
  const session = new WorkspaceLayoutSession(request, save, { base, change });
  await expect(session.discard()).rejects.toThrow("offline"); expect(save).not.toHaveBeenCalled();
  const read = deferred<any>(); request.mockReturnValueOnce(read.promise);
  const discard = session.discard(); await expect(session.apply(change)).rejects.toThrow("Resolve");
  read.resolve({ layout: base }); await discard;
  expect(session.getSnapshot().pending).toBeNull(); expect(save).toHaveBeenCalledWith(null);
});
it("late passive reads cannot roll back an acknowledged mutation", async () => {
  const base = fixture(), read = deferred<any>();
  const request = vi.fn().mockResolvedValueOnce({ layout: base }).mockReturnValueOnce(read.promise)
    .mockResolvedValueOnce({ status: "applied", layout: applied(base) });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  const refresh = session.refresh(); await session.apply(change); read.resolve({ layout: base }); await refresh;
  expect(session.getSnapshot().snapshot?.revision).toBe(1);
});
it("coalesces invalidations into one additional read", async () => {
  const read = deferred<any>(), request = vi.fn().mockReturnValueOnce(read.promise).mockResolvedValue({ layout: fixture() });
  const session = new WorkspaceLayoutSession(request), first = session.refresh();
  void session.refresh(); void session.refresh(); read.resolve({ layout: fixture() }); await first;
  expect(request).toHaveBeenCalledTimes(2);
});
it("retains intent after a mismatched applied response or failed transport", async () => {
  for (const response of [{ status: "applied", layout: fixture() }, new Error("lost reply")]) {
    const request = vi.fn().mockResolvedValueOnce({ layout: fixture() });
    if (response instanceof Error) request.mockRejectedValueOnce(response); else request.mockResolvedValueOnce(response);
    const session = new WorkspaceLayoutSession(request); await session.refresh(); await session.apply(change);
    expect(session.getSnapshot().pending).not.toBeNull(); expect(session.getSnapshot().error).not.toBe("");
  }
});
