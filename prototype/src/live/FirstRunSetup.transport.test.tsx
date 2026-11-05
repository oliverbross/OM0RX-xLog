// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

// Mock only the desktop IPC boundary: the wizard, worker framing, station
// adapter, catalogue normalization and save sessions below are production code.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
afterEach(cleanup);
beforeEach(() => { vi.resetModules(); vi.mocked(invoke).mockReset(); });

it.each(["empty", "error"])("recovers from %s radio and framed rotor catalogues and saves both chosen models through the real adapters", async failure => {
  const { default: FirstRunSetup } = await import("./FirstRunSetup");
  const { workerRequest } = await import("../worker");
  const { completeFirstRunSetup } = await import("./firstRunSetupState");
  const { SettingsSession } = await import("./settingsSession");
  const { RotorConfigurationSession, defaultRotorConfiguration } = await import("./rotorConfigurationSession");
  const { stationSessionRequest } = await import("./stationSession");
  const generation = "00000000-0000-4000-8000-000000000001";
  let exists = false, revision = 0, rotorRevision = 0, radioReads = 0, rotorReads = 0;
  let settings: Record<string, any> = { onboardingCompleted: false, automaticSync: false };
  let rotor = defaultRotorConfiguration();
  let radio: Record<string, any> = { generation, revision: 0, radio_id: "radio1", selection: { provider: null, selection_id: null, generation: 0 } };
  const model = (model: string) => ({ id: 1, manufacturer: "Hamlib", model, maturity: "Stable" });
  vi.mocked(invoke).mockImplementation(async (command, args: any = {}) => {
    if (command === "operating_module_status") return { context: "normal_logging" };
    if (command === "station_session_request") {
      const params = args.params;
      expect(params.radio_id).toBe("radio1");
      if (params.action === "hamlib_catalogue") {
        if (++radioReads === 1) {
          if (failure === "error") throw new Error("Bundled radio model catalogue is unavailable.");
          return { models: [] };
        }
        return { models: [model("Dummy radio")] };
      }
      if (params.action === "snapshot") return structuredClone(radio);
      if (params.action === "save_hamlib") {
        radio = { ...radio, hamlib: structuredClone(params.configuration), profile: structuredClone(params.profile), revision: radio.revision + 1 };
        return { operation_id: params.operation_id, status: "saved" };
      }
      throw new Error(`Unexpected station action: ${params.action}`);
    }
    if (command !== "worker_request") throw new Error(`Unexpected IPC: ${command}`);
    const { id, method, params, operatingContext } = args.request;
    expect(operatingContext).toBe("normal_logging");
    const framed = (result: unknown) => ({ id, ok: true, result });
    if (method === "health") return framed({ platform: "Windows", platform_services: false });
    if (method === "hamlib_models") {
      expect(params).toEqual({ device: "rotor" });
      if (++rotorReads === 1) return failure === "error" ? { id, ok: false, error: { code: "helper_missing", message: "Fixture helper unavailable" } } : framed({ models: [] });
      return framed({ models: [model("Dummy rotor")] });
    }
    if (method === "workspace_status") return framed({ workspace_exists: exists, first_run_eligible: !exists });
    if (method === "workspace_create") { exists = true; return framed({}); }
    if (method === "settings_load") return framed({ generation, revision, settings: structuredClone(settings) });
    if (method === "settings_save") {
      if (JSON.stringify(params.settings) !== JSON.stringify(settings)) revision++;
      settings = structuredClone(params.settings);
      const snapshot = { generation, revision, settings };
      return framed({ status: "applied", ...snapshot, receipt: { mutation: params, snapshot } });
    }
    if (method === "workspace_rotor_configuration_load") return framed({ generation, revision: rotorRevision, configuration: structuredClone(rotor) });
    if (method === "workspace_rotor_configuration_save") {
      if (JSON.stringify(params.configuration) !== JSON.stringify(rotor)) rotorRevision++;
      rotor = structuredClone(params.configuration);
      const snapshot = { generation, revision: rotorRevision, configuration: rotor };
      return framed({ status: "applied", ...snapshot, receipt: { mutation: params, snapshot } });
    }
    throw new Error(`Unexpected worker method: ${method}`);
  });
  const request = async (method: string, params?: Record<string, any>) => (await workerRequest(method, params)).result;
  const finish = vi.fn(async values => completeFirstRunSetup(values, {
    request, settings: new SettingsSession(request), rotor: new RotorConfigurationSession(request), storage: sessionStorage,
  }));
  render(<FirstRunSetup initialSettings={{ operatorCall: "K1ABC", stationCall: "K1ABC" }} onFinish={finish} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(/Direct station services are unavailable/);
  expect(screen.queryByRole("option", { name: "Remote Station Agent" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Setup radio connection"), { target: { value: "hamlib" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse radio models" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/retry/i);
  fireEvent.click(screen.getByRole("button", { name: "Browse radio models" }));
  await screen.findByRole("option", { name: /Dummy radio/ });
  fireEvent.change(screen.getByLabelText("Setup radio model"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Setup rotator connection"), { target: { value: "hamlib" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse rotator models" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/retry/i);
  fireEvent.click(screen.getByRole("button", { name: "Browse rotator models" }));
  await screen.findByRole("option", { name: /Dummy rotor/ });
  fireEvent.change(screen.getByLabelText("Setup rotor model"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(settings.onboardingCompleted).toBe(true));
  expect(finish).toHaveBeenCalledOnce();
  expect(radioReads).toBe(2);
  expect(rotorReads).toBe(2);
  // New session owners independently reload the persisted fixture state.
  const reopenedSettings = new SettingsSession(request), reopenedRotor = new RotorConfigurationSession(request);
  await reopenedSettings.load(); await reopenedRotor.load();
  expect(reopenedSettings.getSnapshot().snapshot?.settings).toMatchObject({ operatorCall: "K1ABC", stationCall: "K1ABC", onboardingCompleted: true, automaticSync: false });
  expect(reopenedRotor.getSnapshot().snapshot?.configuration).toMatchObject({ owner: "hamlib", hamlib: { model: 1, mode: "managed", path: "", baud: 9600 } });
  expect(await stationSessionRequest("radio1", { action: "snapshot" })).toMatchObject({ hamlib: { model: 1, mode: "managed", path: "", baud: 9600 }, profile: { provider: "hamlib" }, selection: { provider: null, selection_id: null } });
  expect(sessionStorage.getItem("xlog.first-run.radio-operation")).toBeNull();
});
