// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ServiceSettings from "./live/ServiceSettings";
import { SettingsSession, type SettingsJournal } from "./live/settingsSession";
import { verifySettingsSave } from "./settingsSaveAcceptance";

afterEach(cleanup);
const generation = "12345678-1234-1234-1234-123456789abc";
const replacementGeneration = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const operationID = "a1b2c3d4-e5f6-47a8-89ab-cdef01234567";
const initialSettings = {
  stationCall: "K1TEST/P", operatorCall: "K1TEST", logbookMode: "local",
  wavelogStationID: 1, automaticSync: false, qrzUsername: "private-fixture-user",
};
type Json = Record<string, any>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(refresh: Promise<void> = Promise.resolve()) {
  let current = { generation, revision: 7, settings: structuredClone(initialSettings) };
  let readbackOverride: Json | null = null;
  const saves: Array<{ params: Json; gate: ReturnType<typeof deferred<Json>> }> = [];
  const journals: Array<SettingsJournal | null> = [];
  const request = vi.fn(async (method: string, params?: Json) => {
    if (method === "settings_load") return structuredClone(readbackOverride ?? current);
    if (method === "settings_save") {
      const gate = deferred<Json>();
      saves.push({ params: structuredClone(params!), gate });
      return gate.promise;
    }
    return {};
  });
  const session = new SettingsSession(request, journal => journals.push(structuredClone(journal)), null, () => operationID);
  await session.load();
  function Form() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <>
      <aside className="sidebar-foot">{state.draft?.stationCall}</aside>
      <ServiceSettings values={state.draft!} savedValues={state.base?.settings} request={request}
        availableTabs={["Station"]} onChanged={values => session.edit(values)}
        onSave={async values => { await session.save(values); await refresh; }}
        saving={state.saving} pending={!!state.pending} conflict={!!state.conflict}
        workspaceChanged={state.workspaceChanged} sessionError={state.error} />
    </>;
  }
  render(<Form />);
  request.mockClear();
  const diagnostics: Json = {};
  const run = () => verifySettingsSave({
    worker: async method => ({ result: await request(method) }), diagnostics,
    edit: async () => { fireEvent.change(screen.getByRole("textbox", { name: "Station call" }), { target: { value: "TEST1" } }); },
    save: async () => { fireEvent.click(screen.getByRole("button", { name: "Save settings" })); },
  }, "TEST1");
  const apply = (index = 0) => {
    const { params, gate } = saves[index];
    current = { generation, revision: params.expectedRevision + 1, settings: structuredClone(params.settings) };
    gate.resolve({ status: "applied", ...structuredClone(current),
      receipt: { mutation: params, snapshot: structuredClone(current) } });
  };
  const loads = () => request.mock.calls.filter(([method]) => method === "settings_load");
  return { session, journals, request, saves, diagnostics, run, apply, loads,
    overrideReadback: (value: Json) => { readbackOverride = value; },
    form: () => document.querySelector<HTMLElement>(".service-settings")!,
  };
}

it("waits for the exact delayed submit even though the sidebar already displays the unsaved call", async () => {
  const refresh = deferred<void>();
  const state = await fixture(refresh.promise);
  const result = state.run();
  await waitFor(() => expect(state.saves).toHaveLength(1));
  expect(document.querySelector(".sidebar-foot")?.textContent).toBe("TEST1");
  expect(state.session.getSnapshot().base?.settings.stationCall).toBe("K1TEST/P");
  expect(state.form().dataset.settingsSaveStatus).toBe("saving");
  expect(state.loads()).toHaveLength(1);
  expect(screen.queryByText("Settings saved")).toBeNull();

  await act(async () => { state.apply(); });
  expect(state.session.getSnapshot().base?.settings.stationCall).toBe("TEST1");
  expect(state.form().dataset.settingsSaveStatus).toBe("saving");
  expect(state.loads()).toHaveLength(1);
  await act(async () => { refresh.resolve(); });

  await expect(result).resolves.toBe(true);
  expect(state.loads()).toHaveLength(2);
  expect(state.saves).toHaveLength(1);
  expect(state.diagnostics).toMatchObject({
    before: { generation, revision: 7, stationCall: "K1TEST/P" },
    expected: { generation, revision: 8, stationCall: "TEST1", attempt: 1 },
    completion: { attempt: 1, status: "applied" },
    readback: { generation, revision: 8, stationCall: "TEST1" },
    matched: true,
  });
  expect(JSON.stringify(state.diagnostics)).not.toContain("private-fixture-user");
  expect(screen.getByText("Settings saved")).toBeTruthy();
});

it("does not accept a previous success toast for a new pending submission", async () => {
  const state = await fixture();
  fireEvent.change(screen.getByRole("textbox", { name: "Station call" }), { target: { value: "PREVIOUS" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(state.saves).toHaveLength(1));
  await act(async () => { state.apply(); });
  expect(await screen.findByText("Settings saved")).toBeTruthy();

  const result = state.run();
  await waitFor(() => expect(state.saves).toHaveLength(2));
  expect(screen.getByText("Settings saved")).toBeTruthy();
  expect(state.form().dataset.settingsSaveStatus).toBe("saving");
  expect(state.loads()).toHaveLength(1);
  await act(async () => { state.apply(1); });
  await expect(result).resolves.toBe(true);
  expect(state.diagnostics.expected.attempt).toBe(2);
  expect(state.diagnostics.readback.revision).toBe(9);
  expect(state.loads()).toHaveLength(2);
});

it.each([
  ["station call", { stationCall: "WRONG" }, generation, 8],
  ["generation", { stationCall: "TEST1" }, replacementGeneration, 8],
  ["revision", { stationCall: "TEST1" }, generation, 9],
])("retains a mismatched %s after completion and never polls it into a pass", async (_label, changes, workspace, revision) => {
  const state = await fixture();
  const result = state.run();
  await waitFor(() => expect(state.saves).toHaveLength(1));
  state.overrideReadback({ generation: workspace, revision, settings: { ...initialSettings, ...changes } });
  await act(async () => { state.apply(); });
  await expect(result).resolves.toBe(false);
  expect(state.loads()).toHaveLength(2);
  expect(state.saves).toHaveLength(1);
  expect(state.diagnostics).toMatchObject({
    completion: { attempt: 1, status: "applied" },
    readback: { generation: workspace, revision, stationCall: changes.stationCall },
    matched: false,
  });
});

it.each(["conflict", "workspace_changed"] as const)("retains %s recovery without success feedback or a post-save read", async outcome => {
  const state = await fixture();
  const result = state.run();
  const rejected = expect(result).rejects.toThrow("Settings save was not applied: " + outcome);
  await waitFor(() => expect(state.saves).toHaveLength(1));
  await act(async () => {
    state.saves[0].gate.resolve(outcome === "conflict"
      ? { status: outcome, generation, revision: 8, settings: { ...initialSettings, stationCall: "OTHER" } }
      : { status: outcome, generation: replacementGeneration });
  });
  await rejected;
  const snapshot = state.session.getSnapshot();
  expect(snapshot.draft?.stationCall).toBe("TEST1");
  expect(snapshot.base?.revision).toBe(7);
  expect(snapshot.saving).toBe(false);
  expect(state.journals.at(-1)?.draft.stationCall).toBe("TEST1");
  if (outcome === "conflict") {
    expect(snapshot.conflict?.settings.stationCall).toBe("OTHER");
    expect(snapshot.pending).toBeNull();
  } else {
    expect(snapshot.workspaceChanged).toBe(true);
    expect(snapshot.pending?.operationID).toBe(operationID);
    expect(state.journals.at(-1)?.pending?.operationID).toBe(operationID);
  }
  expect(screen.queryByText("Settings saved")).toBeNull();
  expect(document.querySelector(".settings-save-toast-error")).toBeTruthy();
  expect(state.loads()).toHaveLength(1);
  expect(state.saves).toHaveLength(1);
  expect(state.request.mock.calls.some(([method]) => method === "settings_receipt")).toBe(false);
  expect(state.diagnostics.completion.status).toBe(outcome);
});

it("keeps an unknown save pending and fails without a success toast or automatic replay", async () => {
  const state = await fixture();
  const result = state.run();
  const rejected = expect(result).rejects.toThrow("Settings save was not applied: failed");
  await waitFor(() => expect(state.saves).toHaveLength(1));
  await act(async () => { state.saves[0].gate.reject(new Error("Acknowledgement unavailable")); });
  await rejected;
  expect(state.session.getSnapshot().pending?.operationID).toBe(operationID);
  expect(state.session.getSnapshot().draft?.stationCall).toBe("TEST1");
  expect(screen.queryByText("Settings saved")).toBeNull();
  expect(state.loads()).toHaveLength(1);
  expect(state.saves).toHaveLength(1);
  expect(state.diagnostics.readback).toBeUndefined();
});
