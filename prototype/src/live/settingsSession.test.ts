import { expect, it, vi } from "vitest";
import { checkedSettingsSnapshot, readSettingsJournal, SettingsSession, type SettingsJournal, type SettingsSnapshot } from "./settingsSession";

const generation = "12345678-1234-1234-1234-123456789abc";
const nextGeneration = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const settings = { logbookMode: "local", stationCall: "OM0RX", wavelogStationID: 1, automaticSync: false };
const snapshot = (revision = 0, values = settings, workspace = generation): SettingsSnapshot => ({ revision, generation: workspace, settings: structuredClone(values) });
const id = "11111111-2222-3333-4444-555555555555";

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
  const request = vi.fn(async (method: string) => method === "settings_load" ? snapshot(1, committed)
    : method === "settings_receipt" ? { receipt: { mutation: pending, snapshot: snapshot(1, committed) } }
    : (() => { throw new Error("unexpected write"); })());
  const session = new SettingsSession(request, vi.fn(), journal, () => id);
  await session.load();
  expect(session.getSnapshot().pending).toBeNull();
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
