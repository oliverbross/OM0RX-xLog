// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedAlertsSurface } from "./DetachedAlertsSurface";
import type { DxAlertsSnapshot } from "./dxAlerts";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const directory = [{ adif: 230, name: "Germany" }, { adif: 288, name: "South Africa" }, { adif: 150, name: "Australia" }];
const legacy = (): DxAlertsSnapshot => ({
  epoch: "00000000-0000-4000-8000-000000000001", revision: 1,
  configuration: { generation: "00000000-0000-4000-8000-000000000002", revision: 0,
    enabled: false, dedupSeconds: 120, retentionMinutes: 120, nativePopup: false, notificationSound: false,
    rules: [{ id: "legacy", name: "Legacy unrestricted", enabled: true, callsignGlob: "*", commentContains: "",
      bands: [], modes: [], callStatuses: [], dxccStatuses: [], specials: [] }] },
  storageError: null, source: { available: true, baselined: true, revision: 1, receivedAtMs: 1 },
  entries: [], delivery: { error: null, suppressed: 0, maximumPerWindow: 3, windowSeconds: 10 },
  limits: { maximumRules: 32, maximumEntries: 200 },
});
let saved: DxAlertsSnapshot;
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks(); saved = legacy();
  native.listen.mockResolvedValue(() => {});
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "alerts_snapshot") return { epoch: saved.epoch, revision: 1, radio_report: false, rotor_report: false, items: [] };
    if (command === "dx_alerts_snapshot") return structuredClone(saved);
    if (command === "dx_alerts_entities") return directory;
    if (command === "dx_alerts_save") {
      saved = { ...saved, revision: saved.revision + 1, configuration: { ...args.configuration,
        generation: saved.configuration.generation, revision: saved.configuration.revision + 1 } };
      return structuredClone(saved);
    }
    if (command === "dx_alerts_preview") return { matches: [] };
    throw Error("Unexpected native action: " + command);
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });
async function openRules() {
  await screen.findByLabelText("Rule 1 name");
  const reads = native.invoke.mock.calls.filter(([command]) => command === "dx_alerts_entities").length;
  fireEvent.click(screen.getByText(/^Rules ·/));
  await waitFor(() => expect(native.invoke.mock.calls.filter(([command]) => command === "dx_alerts_entities")).toHaveLength(reads + 1));
  await waitFor(() => expect(screen.queryByText("Loading DXCC entity directory…")).toBeNull());
}
function chooseZones(label: string, values: string[]) {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  for (const option of select.options) option.selected = values.includes(option.value);
  fireEvent.change(select);
}
async function addEntity(rule: number, field: "dx" | "spotter", search: string, name: string, id: number) {
  fireEvent.change(screen.getByLabelText(`Rule ${rule} find ${field} entity`), { target: { value: search } });
  const title = field === "dx" ? "DX" : "Spotter";
  fireEvent.click(await screen.findByRole("button", { name: `Add ${name} (${id}) to Rule ${rule} ${title} entities` }));
}
it("creates all six geographical conditions on one rule, saves/reopens them and previews native matching and nonmatching results", async () => {
  let panel = render(<DetachedAlertsSurface />); await openRules();
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  fireEvent.change(screen.getByLabelText("Rule 2 name"), { target: { value: "European DX via Africa" } });
  await addEntity(2, "dx", "germ", "Germany", 230);
  await addEntity(2, "spotter", "288", "South Africa", 288);
  fireEvent.click(screen.getByLabelText("Rule 2 DX continent Europe (EU)"));
  fireEvent.click(screen.getByLabelText("Rule 2 spotter continent Africa (AF)"));
  chooseZones("Rule 2 DX CQ zones", ["14", "15"]);
  chooseZones("Rule 2 DX ITU zones", ["28"]);
  const geography = { dxEntities: [230], dxContinents: ["EU"], dxCqZones: [14, 15], dxItuZones: [28],
    spotterEntities: [288], spotterContinents: ["AF"] };
  fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() => expect(saved.configuration.rules[1]).toMatchObject(geography));
  expect(saved.configuration.rules[0]).toEqual(legacy().configuration.rules[0]);
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_save", expect.objectContaining({
    expectedGeneration: saved.configuration.generation, expectedRevision: 0,
    configuration: expect.objectContaining({ rules: [legacy().configuration.rules[0], expect.objectContaining(geography)] }),
  }));
  panel.unmount(); panel = render(<DetachedAlertsSurface />); await openRules();
  expect(within(screen.getByLabelText("Rule 2 DX entities selected")).getByText("Germany (230)")).toBeTruthy();
  expect(within(screen.getByLabelText("Rule 2 Spotter entities selected")).getByText("South Africa (288)")).toBeTruthy();
  expect((screen.getByLabelText("Rule 2 DX continent Europe (EU)") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Rule 2 spotter continent Africa (AF)") as HTMLInputElement).checked).toBe(true);
  expect(Array.from((screen.getByLabelText("Rule 2 DX CQ zones") as HTMLSelectElement).selectedOptions, option => option.value)).toEqual(["14", "15"]);
  expect(Array.from((screen.getByLabelText("Rule 2 DX ITU zones") as HTMLSelectElement).selectedOptions, option => option.value)).toEqual(["28"]);
  const base = native.invoke.getMockImplementation()!;
  const previewCases = [
    { zones: [14, 15], matches: [{ callsign: "DL1MATCH", frequencyKHz: 7010, ruleNames: ["European DX via Africa"] }] },
    { zones: [2], matches: [] },
  ];
  native.invoke.mockImplementation(async (command, args) => {
    if (command !== "dx_alerts_preview") return base(command, args);
    const fixture = previewCases.shift()!;
    expect(args.rules[0]).toEqual(legacy().configuration.rules[0]);
    expect(args.rules[1]).toMatchObject({ ...geography, dxCqZones: fixture.zones });
    return { matches: fixture.matches };
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview retained reports (read only)" }));
  await screen.findByText(/DL1MATCH 7010.0 kHz: European DX via Africa/);
  chooseZones("Rule 2 DX CQ zones", ["2"]);
  fireEvent.click(screen.getByRole("button", { name: "Preview retained reports (read only)" }));
  await screen.findByText("No retained reports match.");
  expect(screen.queryByText(/DL1MATCH 7010.0/)).toBeNull();
  expect(saved.configuration.rules[1]).toMatchObject(geography);
  expect(native.invoke.mock.calls.every(([command]) =>
    ["alerts_snapshot", "dx_alerts_snapshot", "dx_alerts_entities", "dx_alerts_save", "dx_alerts_preview"].includes(command))).toBe(true);
  panel.unmount();
});
it("clears geography back to unrestricted choices without changing another rule or creating a notification", async () => {
  const rule = legacy().configuration.rules[0];
  saved.configuration.rules = [{ ...rule, dxEntities: [230], spotterEntities: [288], dxContinents: ["EU"],
    spotterContinents: ["AF"], dxCqZones: [14], dxItuZones: [28] }];
  render(<DetachedAlertsSurface />); await openRules();
  fireEvent.click(screen.getByRole("button", { name: "Remove Germany (230) from Rule 1 DX entities" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove South Africa (288) from Rule 1 Spotter entities" }));
  fireEvent.click(screen.getByLabelText("Rule 1 DX continent Europe (EU)"));
  fireEvent.click(screen.getByLabelText("Rule 1 spotter continent Africa (AF)"));
  fireEvent.click(screen.getByRole("button", { name: "Any CQ zone for rule 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Any ITU zone for rule 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() => expect(saved.configuration.rules[0]).toMatchObject({
    dxEntities: [], spotterEntities: [], dxContinents: [], spotterContinents: [], dxCqZones: [], dxItuZones: [],
  }));
});
it("reports entity-directory failure and retries without losing a rule's saved entity IDs", async () => {
  saved.configuration.rules[0].dxEntities = [230];
  const base = native.invoke.getMockImplementation()!;
  let attempts = 0;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "dx_alerts_entities" && attempts++ === 0) throw Error("Unavailable");
    return base(command, args);
  });
  render(<DetachedAlertsSurface />); await openRules();
  await screen.findByText(/DXCC entity directory unavailable/);
  expect(screen.getByText("DXCC entity (230)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry entity directory" }));
  await screen.findByText("Germany (230)");
  expect(saved.configuration.rules[0].dxEntities).toEqual([230]);
  expect(native.invoke.mock.calls.filter(([command]) => command === "dx_alerts_save")).toHaveLength(0);
});
