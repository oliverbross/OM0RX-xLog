import { expect, it, vi } from "vitest";
import { changedLayout, checkedLayout, migratedLayoutDocument, panelMinimum, readLayoutJournal, validLayoutDocument, workspacePanelIDs,
  WorkspaceLayoutSession, type LayoutChange, type LayoutSnapshot } from "./workspaceLayoutSession";

function fixture(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  return { revision: 0, generation: "12345678-1234-1234-1234-123456789abc", document: { version: 2, activePresetID: "traditional",
    presets: ["traditional", "windowed"].map(id => ({ id, name: id, width: 1920, height: 1080, locked: true, snap: true, panels: structuredClone(panels) })) } };
}
const change: LayoutChange = { action: "activatePreset", presetID: "windowed" };
function legacyFixture(activePresetID = "operator-custom"): any {
  const snapshot: any = fixture(); snapshot.revision = 47; snapshot.document.version = 1;
  for (const preset of snapshot.document.presets) preset.panels = preset.panels.filter((panel: any) => !["spot-history", "monitor"].includes(panel.id));
  const custom = structuredClone(snapshot.document.presets[0]);
  Object.assign(custom, { id: "operator-custom", name: "My DX desk", width: 3072, height: 1728, locked: false, snap: false });
  custom.panels.reverse();
  custom.panels.forEach((panel: any, index: number) => Object.assign(panel, {
    placement: ["canvas", "window", "hidden"][index % 3], rect: { x: index * 16, y: index * 8, width: 700, height: 500 }, z: 10000 - index,
  }));
  snapshot.document.presets.push(custom); snapshot.document.activePresetID = activePresetID;
  return snapshot;
}
function oldChangedSnapshot(base: any, change: LayoutChange): any {
  const next = structuredClone(base), index = next.document.presets.findIndex((preset: any) => preset.id === change.presetID);
  if (change.action === "savePreset") {
    if (index < 0) next.document.presets.push(structuredClone(change.preset)); else next.document.presets[index] = structuredClone(change.preset);
  } else if (change.action === "placePanel") {
    const panel = next.document.presets[index].panels.findIndex((panel: any) => panel.id === change.panel.id);
    next.document.presets[index].panels[panel] = structuredClone(change.panel);
  } else if (change.action === "deletePreset") next.document.presets.splice(index, 1);
  else next.document.activePresetID = change.presetID;
  next.revision++;
  return next;
}
function applied(base: LayoutSnapshot): LayoutSnapshot { return { ...base, revision: base.revision + 1, document: changedLayout(base.document, change) }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

it("validates all 21 roles, bounded geometry, unique IDs, names and generations", () => {
  const base = fixture(); expect(validLayoutDocument(base.document)).toBe(true); expect(workspacePanelIDs).toHaveLength(21);
  expect(panelMinimum("monitor")).toEqual([640, 480]); expect(panelMinimum("spot-history")).toEqual([640, 480]);
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
it.each(["traditional", "windowed", "operator-custom"])("upgrades old %s layouts without changing any existing role or preset", activeID => {
  const old = legacyFixture(activeID), original = structuredClone(old), upgraded = checkedLayout(old);
  expect(upgraded.revision).toBe(old.revision); expect(upgraded.generation).toBe(old.generation);
  expect(upgraded.document.version).toBe(2); expect(upgraded.document.activePresetID).toBe(activeID);
  expect(upgraded.document.presets.map(preset => preset.id)).toEqual(old.document.presets.map((preset: any) => preset.id));
  upgraded.document.presets.forEach((preset, index) => {
    expect({ ...preset, panels: preset.panels.slice(0, 19) }).toEqual(old.document.presets[index]);
    expect(preset.panels.slice(19)).toEqual([
      { id: "spot-history", placement: "hidden", rect: { x: 0, y: 0, width: 640, height: 480 }, z: 19 },
      { id: "monitor", placement: "hidden", rect: { x: 0, y: 0, width: 640, height: 480 }, z: 20 },
    ]);
  });
  expect(validLayoutDocument(old.document)).toBe(false);
  expect(validLayoutDocument(upgraded.document)).toBe(true);
  expect(checkedLayout(upgraded)).toEqual(upgraded); expect(old).toEqual(original);
});
it("rejects malformed old inventories and future versions instead of repairing them", () => {
  const variants: Array<(snapshot: any) => void> = [
    snapshot => { snapshot.document.version = 3; },
    snapshot => { snapshot.document.version = 0; },
    snapshot => { snapshot.document.presets[0].panels.pop(); },
    snapshot => { snapshot.document.presets[0].panels[1] = snapshot.document.presets[0].panels[0]; },
    snapshot => { snapshot.document.presets[0].panels[0].id = "monitor"; },
    snapshot => { snapshot.document.presets[0].panels.push(...fixture().document.presets[0].panels.slice(19)); },
    snapshot => { snapshot.document.presets[0].panels[0].rect.width = 1; },
    snapshot => { snapshot.document.presets[0].panels[0].placement = "canvas"; snapshot.document.presets[0].panels[0].rect.x = 16384; },
    snapshot => { snapshot.document.activePresetID = "missing"; },
    snapshot => { snapshot.document.presets[0].name = "\n"; },
  ];
  for (const mutate of variants) {
    const snapshot = legacyFixture(); mutate(snapshot);
    expect(() => checkedLayout(snapshot)).toThrow("could not be verified");
    expect(readLayoutJournal(JSON.stringify({ base: snapshot, change }))).toBeNull();
  }
  const maximum = legacyFixture();
  for (let index = maximum.document.presets.length; index < 12; index++) maximum.document.presets.push({ ...structuredClone(maximum.document.presets[0]), id: `saved-${index}` });
  expect(checkedLayout(maximum).document.presets).toHaveLength(12);
  maximum.document.presets.push({ ...structuredClone(maximum.document.presets[0]), id: "excess" });
  expect(() => migratedLayoutDocument(maximum.document)).toThrow();
});
it("upgrades every old journal operation and reconciles an old or upgraded acknowledgement without replay", async () => {
  const base = legacyFixture(), renamed = { ...structuredClone(base.document.presets[2]), name: "Renamed desk" };
  const panel = { ...structuredClone(base.document.presets[2].panels[0]), rect: { x: 24, y: 24, width: 700, height: 500 } };
  const operations: LayoutChange[] = [change,
    { action: "placePanel", presetID: "operator-custom", panel },
    { action: "savePreset", presetID: "operator-custom", preset: renamed },
    { action: "savePreset", presetID: "saved-copy", preset: { ...renamed, id: "saved-copy" } },
    { action: "deletePreset", presetID: "windowed" },
  ];
  for (const operation of operations) {
    const pending = readLayoutJournal(JSON.stringify({ base, change: operation })); expect(pending).not.toBeNull();
    expect(pending!.base.revision).toBe(47); expect(pending!.base.generation).toBe(base.generation);
    const acknowledged = oldChangedSnapshot(base, operation);
    const desired = changedLayout(pending!.base.document, pending!.change);
    if (operation.action === "activatePreset") expect(desired.lastCanvasPresetID).toBe(base.document.activePresetID);
    delete desired.lastCanvasPresetID; // Old worker acknowledgements predate return-to-Canvas metadata.
    expect(desired).toEqual(checkedLayout(acknowledged).document);
    for (const response of [acknowledged, checkedLayout(acknowledged)]) {
      const request = vi.fn(async () => ({ layout: response })), journal = vi.fn();
      const session = new WorkspaceLayoutSession(request, journal, pending);
      await session.refresh(); expect(session.getSnapshot().pending).toBeNull(); expect(journal).toHaveBeenCalledWith(null);
      expect(request).toHaveBeenCalledExactlyOnceWith("workspace_layout_load");
    }
  }
});
it("old journal retry preserves its generation/revision and sends new hidden roles only after explicit fresh-read retry", async () => {
  const old = legacyFixture(), preset = { ...structuredClone(old.document.presets[2]), name: "Retained rename" };
  const pending = readLayoutJournal(JSON.stringify({ base: old, change: { action: "savePreset", presetID: preset.id, preset } }))!;
  const current = checkedLayout(old);
  const request = vi.fn(async (method: string, params?: any) => method.endsWith("load") ? { layout: current } :
    { status: "applied", layout: { ...current, revision: current.revision + 1, document: changedLayout(current.document, params) } });
  const session = new WorkspaceLayoutSession(request, () => {}, pending);
  await session.refresh(); expect(request).toHaveBeenCalledTimes(1); expect(session.getSnapshot().pending).toEqual(pending);
  await session.retry();
  expect(request.mock.calls[2][1]).toEqual({ ...pending.change, expectedRevision: 47, generation: old.generation });
  expect((request.mock.calls[2][1] as any).preset.panels).toHaveLength(21);
  expect(session.getSnapshot().pending).toBeNull();
});
it("migrated journals retain stale and restored-workspace intent without automatic writes", async () => {
  const old = legacyFixture(), pending = readLayoutJournal(JSON.stringify({ base: old, change }))!;
  for (const current of [
    { ...checkedLayout(old), revision: 48 },
    { ...checkedLayout(old), revision: 49, document: changedLayout(pending.base.document, change) },
    { ...checkedLayout(old), generation: "87654321-1234-1234-1234-123456789abc" },
  ]) {
    const request = vi.fn(async (_method: string) => ({ layout: current })), journal = vi.fn();
    const session = new WorkspaceLayoutSession(request, journal, pending);
    await session.refresh(); await expect(session.retry()).rejects.toThrow("Review");
    expect(session.getSnapshot().pending).toEqual(pending); expect(session.getSnapshot().conflict).toEqual(current);
    expect(request.mock.calls.every(([method]) => method === "workspace_layout_load")).toBe(true); expect(journal).not.toHaveBeenCalled();
  }
});
it("does not accept a new-role mutation or malformed saved preset smuggled into an old journal", () => {
  const base = legacyFixture();
  const newPanel = fixture().document.presets[0].panels.find(panel => panel.id === "monitor")!;
  expect(readLayoutJournal(JSON.stringify({ base, change: { action: "placePanel", presetID: "traditional", panel: newPanel } }))).toBeNull();
  expect(readLayoutJournal(JSON.stringify({ base, change: { action: "savePreset", presetID: "traditional", preset: fixture().document.presets[0] } }))).toBeNull();
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
it("refuses captured preset saves after revision, generation or document drift before journaling or writing", async () => {
  const editingBase = fixture();
  const preset = { ...structuredClone(editingBase.document.presets[0]), name: "Edited desk" };
  const save: LayoutChange = { action: "savePreset", presetID: preset.id, preset };
  for (const mutate of [
    (snapshot: LayoutSnapshot) => { snapshot.revision++; },
    (snapshot: LayoutSnapshot) => { snapshot.generation = "87654321-1234-1234-1234-123456789abc"; },
    (snapshot: LayoutSnapshot) => { snapshot.document.presets[0].panels.find(panel => panel.id === "monitor")!.rect.x = 32; },
  ]) {
    const current = structuredClone(editingBase); mutate(current);
    const request = vi.fn().mockResolvedValueOnce({ layout: editingBase }).mockResolvedValueOnce({ layout: current });
    const journal = vi.fn(), session = new WorkspaceLayoutSession(request, journal);
    await session.refresh(); await session.refresh();
    await expect(session.applyAtBase(save, editingBase)).rejects.toThrow("changed after editing began");
    expect(journal).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().snapshot).toEqual(current); expect(session.getSnapshot().pending).toBeNull();
  }
});
it("saves against a matching captured base while preserving generation, other roles and immutable inputs", async () => {
  const base = fixture(); base.revision = 47;
  const monitor = base.document.presets[0].panels.find(panel => panel.id === "monitor")!;
  Object.assign(monitor, { placement: "window", rect: { x: 55, y: 66, width: 800, height: 600 }, z: 876 });
  const original = structuredClone(base), preset = { ...structuredClone(base.document.presets[0]), name: "Renamed desk" };
  const save: LayoutChange = { action: "savePreset", presetID: preset.id, preset };
  const request = vi.fn(async (method: string, params?: any) => method.endsWith("load") ? { layout: base }
    : { status: "applied", layout: { ...base, revision: 48, document: changedLayout(base.document, params) } });
  const journal = vi.fn(), session = new WorkspaceLayoutSession(request, journal);
  await session.refresh(); await session.applyAtBase(save, structuredClone(base));
  expect(request.mock.calls[1][1]).toEqual({ ...save, expectedRevision: 47, generation: base.generation });
  expect(session.getSnapshot().snapshot?.generation).toBe(base.generation);
  expect(session.getSnapshot().snapshot?.document.presets[0].panels).toEqual(base.document.presets[0].panels);
  expect(session.getSnapshot().pending).toBeNull(); expect(base).toEqual(original);
});
it("captured-base writes retain the unresolved pending-change guard", async () => {
  const base = fixture(), request = vi.fn(async () => ({ layout: base })), journal = vi.fn();
  const session = new WorkspaceLayoutSession(request, journal, { base, change });
  await session.refresh(); await expect(session.applyAtBase(change, base)).rejects.toThrow("Resolve");
  expect(journal).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
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
it("qualifies contest layout reads and writes without changing legacy Normal request bytes", async () => {
  const normalRequest = vi.fn().mockResolvedValueOnce({ layout: fixture() });
  const normal = new WorkspaceLayoutSession(normalRequest); await normal.refresh();
  expect(normalRequest).toHaveBeenCalledWith("workspace_layout_load");

  const contestRequest = vi.fn().mockResolvedValueOnce({ layout: fixture() })
    .mockResolvedValueOnce({ status: "applied", layout: applied(fixture()) });
  const contest = new WorkspaceLayoutSession(contestRequest, () => {}, null, "contesting");
  await contest.refresh(); await contest.apply(change);
  expect(contestRequest.mock.calls[0]).toEqual(["workspace_layout_load", { scope: "contesting" }]);
  expect(contestRequest.mock.calls[1][1]).toMatchObject({ scope: "contesting", action: "activatePreset", presetID: "windowed" });
});
