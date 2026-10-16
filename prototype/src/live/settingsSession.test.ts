import { expect, it, vi } from "vitest";
import { checkedSettingsSnapshot, readSettingsJournal, SettingsSession, type SettingsJournal, type SettingsSnapshot } from "./settingsSession";

const generation = "12345678-1234-1234-1234-123456789abc";
const nextGeneration = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const settings = { logbookMode: "local", stationCall: "OM0RX", wavelogStationID: 1, automaticSync: false };
const snapshot = (revision = 0, values = settings, workspace = generation): SettingsSnapshot => ({ revision, generation: workspace, settings: structuredClone(values) });
const id = "a1b2c3d4-e5f6-47a8-89ab-cdef01234567";
const nativeMutation = (value: any) => ({ ...structuredClone(value), operationID: value.operationID.toUpperCase(), generation: value.generation.toUpperCase() });
const nativeSnapshot = (value: SettingsSnapshot) => ({ ...structuredClone(value), generation: value.generation.toUpperCase() });

it.each([false, true])("accepts native UUID receipts for changed=%s Settings saves without altering payload case", async changed => {
  const committed = { ...settings, stationCall: changed ? "VK8Case" : settings.stationCall };
  const result = nativeSnapshot(snapshot(changed ? 1 : 0, committed)), writes: Array<SettingsJournal | null> = [];
  const request = vi.fn(async (method: string, params?: any) => method === "settings_load" ? nativeSnapshot(snapshot()) : {
    status: "applied", ...result, receipt: { mutation: nativeMutation(params), snapshot: result },
  });
  const session = new SettingsSession(request, value => writes.push(structuredClone(value)), null, () => id);
  await session.load(); session.edit(committed); await session.save(committed);
  expect(session.getSnapshot()).toMatchObject({ pending: null, error: "", base: { revision: changed ? 1 : 0, generation, settings: committed } });
  expect(writes.at(-1)).toBeNull(); expect(request.mock.calls.map(([method]) => method)).toEqual(["settings_load", "settings_save"]);
});

it("accepts the separately authorized automatic-sync overlay without weakening receipt checks", async () => {
  const initial = { ...settings, automaticSync: true };
  const presented = { ...initial, stationCall: "VK8Case" };
  const durable = { ...presented, automaticSync: false };
  const writes: Array<SettingsJournal | null> = [];
  const request = vi.fn(async (method: string, params?: any) => method === "settings_load" ? snapshot(0, initial) : {
    status: "applied", ...snapshot(1, presented), receipt: { mutation: params, snapshot: snapshot(1, durable) },
  });
  const session = new SettingsSession(request, value => writes.push(structuredClone(value)), null, () => id);
  await session.load(); session.edit(presented); await session.save(presented);
  expect(request.mock.calls[1]?.[1].settings.automaticSync).toBe(false);
  expect(session.getSnapshot()).toMatchObject({ pending: null, error: "", base: { revision: 1, settings: presented } });
  expect(writes.at(-1)).toBeNull();
});

it("still rejects unrelated outer acknowledgement changes beside the automatic-sync overlay", async () => {
  const initial = { ...settings, automaticSync: true };
  const presented = { ...initial, stationCall: "VK8Case" };
  const durable = { ...presented, automaticSync: false };
  const request = vi.fn(async (method: string, params?: any) => method === "settings_load" ? snapshot(0, initial) : {
    status: "applied", ...snapshot(1, { ...presented, stationCall: "WRONG" }),
    receipt: { mutation: params, snapshot: snapshot(1, durable) },
  });
  const session = new SettingsSession(request, vi.fn(), null, () => id);
  await session.load(); session.edit(presented);
  await expect(session.save(presented)).rejects.toThrow("acknowledgement did not match its receipt");
  expect(session.getSnapshot().pending?.operationID).toBe(id);
});

it.each([
  ["operation identity", (receipt: any) => { receipt.mutation.operationID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; }],
  ["workspace identity", (receipt: any) => { receipt.mutation.generation = nextGeneration; }],
  ["expected revision", (receipt: any) => { receipt.mutation.expectedRevision++; }],
  ["case-sensitive callsign", (receipt: any) => { receipt.mutation.settings.stationCall = "vk8case"; }],
  ["case-sensitive nested name", (receipt: any) => { receipt.mutation.settings.stationEquipment.name = "garden a"; }],
  ["unexpected mutation key", (receipt: any) => { receipt.mutation.unexpected = true; }],
] as const)("keeps a mismatched %s fenced in both save and receipt recovery", async (_label, alter) => {
  const committed = { ...settings, stationCall: "VK8Case", stationEquipment: { name: "Garden A" } }, writes: Array<SettingsJournal | null> = [];
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "settings_load") return nativeSnapshot(snapshot());
    const pending = method === "settings_save" ? params : writes.at(-1)!.pending;
    const receipt = { mutation: nativeMutation(pending), snapshot: nativeSnapshot(snapshot(1, committed)) }; alter(receipt);
    return method === "settings_save" ? { status: "applied", ...nativeSnapshot(snapshot(1, committed)), receipt } : { receipt };
  });
  const session = new SettingsSession(request, value => writes.push(structuredClone(value)), null, () => id);
  await session.load(); session.edit(committed);
  await expect(session.save(committed)).rejects.toThrow("receipt did not match the pending save");
  await expect(session.reconcile()).rejects.toThrow("receipt did not match the pending save");
  expect(session.getSnapshot().pending?.operationID).toBe(id); expect(session.getSnapshot().base?.revision).toBe(0);
  expect(writes.at(-1)?.pending?.settings).toEqual(committed);
  expect(request.mock.calls.filter(([method]) => method === "settings_save")).toHaveLength(1);
});

it("validates scoped snapshots and rejects secret-bearing journals", () => {
  expect(checkedSettingsSnapshot(snapshot())).toEqual(snapshot());
  expect(() => checkedSettingsSnapshot({ ...snapshot(), revision: Infinity })).toThrow();
  const journal = { version: 1, base: snapshot(), draft: { ...settings, password: "never" }, pending: null };
  expect(readSettingsJournal(JSON.stringify(journal))).toBeNull();
  expect(readSettingsJournal(JSON.stringify({ ...journal, draft: { ...settings, nested: { apiKey: "never" } } }))).toBeNull();
});

it("retains raw invalid text across navigation and reload without sending anything", async () => {
  let saved: SettingsJournal | null = null;
  const request = vi.fn(async () => snapshot());
  const session = new SettingsSession(request, value => { saved = value; }, null, () => id);
  await session.load();
  session.edit({ ...settings, wavelogStationID: "not-a-number", apiKey: "never journal this" });
  expect(session.getSnapshot().draft?.wavelogStationID).toBe("not-a-number");
  expect((saved as unknown as SettingsJournal).draft).not.toHaveProperty("apiKey");
  const restored = new SettingsSession(request, vi.fn(), readSettingsJournal(JSON.stringify(saved)), () => id);
  await restored.load();
  expect(restored.getSnapshot().draft?.wavelogStationID).toBe("not-a-number");
  expect(request).toHaveBeenCalledTimes(2);
});

it("writes recovery identity before Save and accepts an exact changed receipt", async () => {
  const writes: Array<SettingsJournal | null> = [];
  const request = vi.fn(async (method: string, params?: any) => method === "settings_load" ? snapshot() : {
    status: "applied", ...snapshot(1, { ...settings, stationCall: "VK8ABC" }), receipt: {
      mutation: params, snapshot: snapshot(1, { ...settings, stationCall: "VK8ABC" }),
    },
  });
  const session = new SettingsSession(request, value => writes.push(structuredClone(value)), null, () => id);
  await session.load(); session.edit({ ...settings, stationCall: "VK8ABC" });
  await session.save({ ...settings, stationCall: "VK8ABC" });
  expect(writes.some(value => value?.pending?.operationID === id)).toBe(true);
  expect(writes.at(-1)).toBeNull();
  expect(session.getSnapshot().snapshot?.revision).toBe(1);
});

it("no-op Save keeps the revision and still records an idempotent receipt", async () => {
  const request = vi.fn(async (method: string, params?: any) => method === "settings_load" ? snapshot() : {
    status: "applied", ...snapshot(), receipt: { mutation: params, snapshot: snapshot() },
  });
  const session = new SettingsSession(request, vi.fn(), null, () => id);
  await session.load(); await session.save(settings);
  expect(session.getSnapshot().snapshot?.revision).toBe(0);
});

it("lost acknowledgement is reconciled read-only and never blindly replayed", async () => {
  const committed = { ...settings, stationCall: "VK8ABC" };
  const pending = { operationID: id, expectedRevision: 0, generation, settings: committed };
  const journal: SettingsJournal = { version: 1, base: snapshot(), draft: committed, pending };
  const request = vi.fn(async (method: string) => method === "settings_load" ? nativeSnapshot(snapshot(1, committed))
    : method === "settings_receipt" ? { receipt: { mutation: nativeMutation(pending), snapshot: nativeSnapshot(snapshot(1, committed)) } }
    : (() => { throw new Error("unexpected write"); })());
  const cleared = vi.fn();
  const session = new SettingsSession(request, cleared, readSettingsJournal(JSON.stringify(journal)), () => id);
  await session.load();
  expect(session.getSnapshot().pending).toBeNull();
  expect(cleared).toHaveBeenLastCalledWith(null);
  expect(request.mock.calls.map(call => call[0])).toEqual(["settings_load", "settings_receipt", "settings_load"]);
});

it("rejects a receipt whose committed snapshot does not prove the pending mutation", async () => {
  const committed = { ...settings, stationCall: "VK8ABC" };
  const pending = { operationID: id, expectedRevision: 0, generation, settings: committed };
  const journal: SettingsJournal = { version: 1, base: snapshot(), draft: committed, pending };
  const request = vi.fn(async (method: string) => method === "settings_load" ? snapshot(1, committed)
    : { receipt: { mutation: pending, snapshot: snapshot(1, { ...settings, stationCall: "WRONG" }) } });
  const session = new SettingsSession(request, vi.fn(), journal, () => id);
  await expect(session.load()).rejects.toThrow(/requested values/);
  expect(session.getSnapshot().pending).toEqual(pending);
});

it("missing receipts keep the exact pending identity for explicit retry", async () => {
  const pending = { operationID: id, expectedRevision: 0, generation, settings };
  const journal: SettingsJournal = { version: 1, base: snapshot(), draft: settings, pending };
  const request = vi.fn(async (method: string) => method === "settings_load" ? snapshot() : { receipt: null });
  const session = new SettingsSession(request, vi.fn(), journal, () => id);
  await session.load();
  expect(session.getSnapshot().pending).toEqual(pending);
  expect(session.getSnapshot().error).toMatch(/same operation ID/);
  expect(request).toHaveBeenCalledTimes(2);
});

it("concurrent settings and restored workspaces retain local text for review", async () => {
  const concurrent = new SettingsSession(async () => snapshot(2, { ...settings, stationCall: "OTHER" }), vi.fn(),
    { version: 1, base: snapshot(), draft: { ...settings, stationCall: "LOCAL" }, pending: null }, () => id);
  await concurrent.load();
  expect(concurrent.getSnapshot().conflict?.revision).toBe(2);
  expect(concurrent.getSnapshot().draft?.stationCall).toBe("LOCAL");

  const restored = new SettingsSession(async () => snapshot(0, settings, nextGeneration), vi.fn(),
    { version: 1, base: snapshot(), draft: { ...settings, stationCall: "LOCAL" }, pending: null }, () => id);
  await restored.load();
  expect(restored.getSnapshot().workspaceChanged).toBe(true);
  expect(restored.getSnapshot().draft?.stationCall).toBe("LOCAL");
});

it("adopts newer or restored Settings automatically when the local form is clean", async () => {
  for (const next of [snapshot(2, { ...settings, stationCall: "OTHER" }), snapshot(0, settings, nextGeneration)]) {
    let current = snapshot();
    const session = new SettingsSession(async () => current, vi.fn(), null, () => id);
    await session.load(); current = next; await session.load();
    expect(session.getSnapshot().base).toEqual(next);
    expect(session.getSnapshot().conflict).toBeNull();
    expect(session.getSnapshot().workspaceChanged).toBe(false);
  }
});
