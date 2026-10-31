import { describe, expect, it, vi } from "vitest";
import { completeFirstRunSetup, firstRunError, firstRunValues } from "./firstRunSetupState";
import { SettingsSession } from "./settingsSession";
import { defaultRotorConfiguration, RotorConfigurationSession } from "./rotorConfigurationSession";

const generation = "00000000-0000-4000-8000-000000000001";
function fixture(existing = false, completed = false) {
  let exists = existing, revision = 0, rotorRevision = 0;
  let values = { onboardingCompleted: completed, showCWDecode: false, operatorCall: "", stationCall: "", defaultPower: "100", logbookMode: "local", automaticSync: false };
  let configuration = defaultRotorConfiguration();
  const request = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "workspace_status") return { workspace_exists: exists, first_run_eligible: !exists };
    if (method === "workspace_create") { exists = true; return {}; }
    if (method === "settings_load") return { generation, revision, settings: values };
    if (method === "settings_save") {
      if (JSON.stringify(params.settings) !== JSON.stringify(values)) revision++;
      values = structuredClone(params.settings);
      const snapshot = { generation, revision, settings: values };
      return { status: "applied", ...snapshot, receipt: { mutation: params, snapshot } };
    }
    if (method === "workspace_rotor_configuration_load") return { generation, revision: rotorRevision, configuration };
    if (method === "workspace_rotor_configuration_save") {
      if (JSON.stringify(params.configuration) !== JSON.stringify(configuration)) rotorRevision++;
      configuration = structuredClone(params.configuration);
      const snapshot = { generation, revision: rotorRevision, configuration };
      return { status: "applied", ...snapshot, receipt: { mutation: params, snapshot } };
    }
    if (method === "secret_save") return {};
    throw new Error(`Unexpected method ${method}`);
  });
  const settings = new SettingsSession(request), rotor = new RotorConfigurationSession(request);
  return { request, settings, rotor, saved: () => values, configuration: () => configuration };
}
const stationValues = () => ({ ...firstRunValues(), operatorCall: "k1abc", stationCall: "k1abc/p", gridSquare: "FN31pr" });
describe("first-run setup transactions", () => {
  it("starts with blank personal details and validates the actual configured fields", () => {
    expect(firstRunValues().operatorCall).toBe(""); expect(firstRunValues().stationCall).toBe(""); expect(firstRunValues().wavelogURL).toBe("");
    expect(firstRunError(firstRunValues())).toMatch(/operator call/);
    expect(firstRunError({ ...stationValues(), gridSquare: "AA99zz" })).toMatch(/Maidenhead/);
    expect(firstRunError({ ...stationValues(), radio: "direct_agent", agentURL: "http://station" })).toMatch(/HTTPS/);
    expect(firstRunError({ ...stationValues(), logbookMode: "wavelog", wavelogURL: "https://example.invalid", wavelogStationID: "1.5" })).toMatch(/station ID/);
  });
  it("creates and completes local-only setup without station, rotor or sync commands", async () => {
    const state = fixture(), station = vi.fn();
    await completeFirstRunSetup(stationValues(), { ...state, station });
    expect(state.request).toHaveBeenCalledWith("workspace_create", { mode: "empty", onboarding: true });
    expect(state.saved()).toMatchObject({ operatorCall: "K1ABC", stationCall: "K1ABC/P", gridSquare: "FN31PR", onboardingCompleted: true, automaticSync: false });
    expect(station).not.toHaveBeenCalled();
    expect(state.request.mock.calls.some(([method]) => /sync|rotor|secret/.test(method))).toBe(false);
  });
  it("never enrolls an existing configured operator or resets saved identity", async () => {
    const state = fixture(true, true);
    await expect(completeFirstRunSetup(stationValues(), state)).rejects.toThrow(/already configured/);
    expect(state.request.mock.calls.map(([method]) => method)).toEqual(["workspace_status", "settings_load"]);
    expect(state.saved().onboardingCompleted).toBe(true);
  });
  it("saves Wavelog secrets only in the vault and leaves synchronization off", async () => {
    const state = fixture();
    await completeFirstRunSetup({ ...stationValues(), logbookMode: "wavelog", wavelogURL: "https://example.invalid", wavelogStationID: "3", wavelogToken: "fixture-token" }, state);
    expect(state.request).toHaveBeenCalledWith("secret_save", { account: "wavelog-token", value: "fixture-token" });
    expect(state.saved()).toMatchObject({ logbookMode: "wavelog", wavelogStationID: 3, automaticSync: false, onboardingCompleted: true });
    for (const [method, params] of state.request.mock.calls) if (method === "settings_save") expect(JSON.stringify(params)).not.toContain("fixture-token");
    expect(state.request.mock.calls.some(([method]) => method.startsWith("sync_"))).toBe(false);
  });
  it("saves passive radio and rotor configurations without connecting or moving", async () => {
    const state = fixture(), station = vi.fn(async (_radio: string, params: Record<string, any>) => params.action === "snapshot"
      ? { generation, revision: 0 } : { operation_id: params.operation_id, status: "saved" });
    await completeFirstRunSetup({ ...stationValues(), radio: "hamlib", radioModel: 3073, radioPath: "/dev/fixture", rotor: "native_dcu1", rotorHost: "192.0.2.5" }, { ...state, station: station as any });
    expect(station.mock.calls.map(([, params]) => params.action)).toEqual(["snapshot", "save_hamlib"]);
    expect(state.configuration().native_dcu1.host).toBe("192.0.2.5");
    expect(state.configuration().auto_rotor_at_startup).toBe(true);
    expect(state.request.mock.calls.some(([method]) => /connect|goto|auto_rotor/.test(method))).toBe(false);
  });
  it("retains incomplete setup and the operation identity when radio outcome is uncertain", async () => {
    const state = fixture(), memory = new Map<string, string>(), storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
    const station = vi.fn(async (_radio: string, params: Record<string, any>) => params.action === "snapshot" ? { generation, revision: 0 } : { operation_id: params.operation_id, status: "unknown" });
    const values = { ...stationValues(), radio: "direct_agent" as const, agentURL: "https://station.invalid" };
    await expect(completeFirstRunSetup(values, { ...state, station: station as any, storage })).rejects.toThrow(/not confirmed/);
    expect(state.saved().onboardingCompleted).toBe(false); expect(memory.size).toBe(1);
    expect([...memory.values()][0]).toMatch(/^[a-f0-9-]{36}$/);
    station.mockClear();
    await expect(completeFirstRunSetup(values, { ...state, station: station as any, storage })).rejects.toThrow(/uncertain/);
    expect(station.mock.calls.map(([, params]) => params.action)).toEqual(["receipt"]);
  });
});
