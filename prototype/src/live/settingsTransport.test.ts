// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsSession } from "./settingsSession";
import { connectSettingsChanges } from "./settingsTransport";

const bridge = vi.hoisted(() => ({ changed: undefined as (() => void) | undefined, stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, changed: () => void) => { bridge.changed = changed; return bridge.stop; }),
}));
vi.mock("../worker", () => ({ workerRequest: vi.fn() }));

const generation = "12345678-1234-1234-1234-123456789abc";
const replacement = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const operationID = "a1b2c3d4-e5f6-47a8-89ab-cdef01234567";
const settings = { stationCall: "K1TEST/P", logbookMode: "local", automaticSync: false };
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  bridge.changed = undefined; bridge.stop.mockClear();
});
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop());
  vi.useRealTimers();
});

async function fixture() {
  let finishSave!: (reply: any) => void;
  const saving = new Promise<any>(resolve => { finishSave = resolve; });
  const request = vi.fn(async (method: string) => {
    if (method === "settings_load") return { generation, revision: 7, settings: structuredClone(settings) };
    if (method === "settings_save") return saving;
    throw new Error("Unexpected request: " + method);
  });
  const session = new SettingsSession(request, vi.fn(), null, () => operationID);
  await session.load();
  const reload = vi.fn(() => session.load()), failed = vi.fn();
  const stop = connectSettingsChanges(reload, failed);
  cleanups.push(stop);
  // Complete the subscription's normal initial reload before the save.
  await vi.advanceTimersByTimeAsync(50);
  expect(reload).toHaveBeenCalledTimes(1);
  request.mockClear(); reload.mockClear();
  session.edit({ ...settings, stationCall: "TEST1" });
  // The form owns this rejection; the concurrent notification load has its
  // own promise and must also be observed by the real subscription boundary.
  const saveOutcome = session.save({ ...settings, stationCall: "TEST1" })
    .then(() => ({ applied: true as const }), error => ({ error }));
  bridge.changed!();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(49);
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.map(([method]) => method)).toEqual(["settings_save", "settings_load"]);
  expect(session.getSnapshot().pending?.operationID).toBe(operationID);
  return { session, request, failed, stop, finishSave, saveOutcome };
}

it.each(["conflict", "workspace_changed"] as const)(
  "handles the concurrent notification/focus load rejection for a %s save",
  async outcome => {
    const state = await fixture();
    state.finishSave(outcome === "conflict"
      ? { status: outcome, generation, revision: 8, settings: { ...settings, stationCall: "OTHER" } }
      : { status: outcome, generation: replacement });
    const result = await state.saveOutcome;
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toHaveProperty("error");
    if (!("error" in result)) throw new Error("Expected a rejected save.");
    expect(state.failed).toHaveBeenCalledExactlyOnceWith(result.error.message);
    expect(result.error.message).toContain(outcome === "conflict"
      ? "Settings changed in another window" : "The workspace was restored or replaced");
    expect(state.session.getSnapshot().draft?.stationCall).toBe("TEST1");
    expect(state.session.getSnapshot().base?.revision).toBe(7);
    if (outcome === "conflict") {
      expect(state.session.getSnapshot().conflict?.settings.stationCall).toBe("OTHER");
      expect(state.session.getSnapshot().pending).toBeNull();
    } else {
      expect(state.session.getSnapshot().workspaceChanged).toBe(true);
      expect(state.session.getSnapshot().pending?.operationID).toBe(operationID);
    }
    // No receipt poll, automatic retry, or extra notification work was added.
    expect(state.request.mock.calls.map(([method]) => method)).toEqual(["settings_save", "settings_load"]);
  },
);

it("observes a late load rejection without publishing an error after disposal", async () => {
  const state = await fixture();
  state.stop();
  state.finishSave({ status: "workspace_changed", generation: replacement });
  expect(await state.saveOutcome).toHaveProperty("error");
  await vi.advanceTimersByTimeAsync(0);
  expect(state.failed).not.toHaveBeenCalled();
  expect(state.session.getSnapshot().pending?.operationID).toBe(operationID);
  expect(bridge.stop).toHaveBeenCalledTimes(1);
  expect(state.request.mock.calls.map(([method]) => method)).toEqual(["settings_save", "settings_load"]);
});
