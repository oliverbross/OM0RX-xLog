import { defaultRotorConfiguration, type RotorConfiguration, type RotorConfigurationSession } from "./rotorConfigurationSession";
import type { SettingsSession } from "./settingsSession";
import { stationSessionRequest, type RadioProfile, type StationSession, type StationReceipt } from "./stationSession";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
/** Direct radio clients and the DCU-1 adapter are Swift platform services.
 * Hamlib is owned by the bundled cross-platform native helper. */
export const firstRunDirectServicesAvailable = (health: unknown) => !!health && typeof health === "object" &&
  !Array.isArray(health) && (health as Data).platform_services === true;
export type FirstRunValues = {
  operatorCall: string; stationCall: string; gridSquare: string; stationLocation: string; defaultPower: string;
  radio: "skip" | RadioProfile["provider"]; radioName: string; radioModel?: number; radioPath: string; radioBaud: number;
  radioHost: string; radioPort: number; agentURL: string; tciEndpoint: string;
  rotor: "skip" | "native_dcu1" | "hamlib"; rotorHost: string; rotorPort: number; rotorModel?: number; rotorPath: string; rotorBaud: number;
  logbookMode: "local" | "wavelog"; wavelogURL: string; wavelogStationID: string; wavelogToken: string;
};
export const firstRunValues = (settings: Data | null = null): FirstRunValues => ({
  operatorCall: settings?.operatorCall ?? "", stationCall: settings?.stationCall ?? "", gridSquare: settings?.gridSquare ?? "",
  stationLocation: settings?.stationLocation ?? "", defaultPower: settings?.defaultPower ?? "100",
  radio: "skip", radioName: "", radioPath: "", radioBaud: 9600, radioHost: "", radioPort: 4992, agentURL: "", tciEndpoint: "",
  rotor: "skip", rotorHost: "", rotorPort: 4001, rotorPath: "", rotorBaud: 9600,
  logbookMode: settings?.logbookMode === "wavelog" ? "wavelog" : "local", wavelogURL: settings?.wavelogURL ?? "",
  wavelogStationID: settings?.wavelogStationID ? String(settings.wavelogStationID) : "", wavelogToken: "",
});
const port = (value: number) => Number.isInteger(value) && value > 0 && value <= 65535;
const url = (value: string, protocols: string[]) => { try { const u = new URL(value.trim()); return protocols.includes(u.protocol) && !!u.hostname && !u.username && !u.password && !u.search && !u.hash; } catch { return false; } };
export function firstRunError(values: FirstRunValues, step = 3): string {
  if (![values.operatorCall, values.stationCall].every(value => /^[A-Z0-9][A-Z0-9/]{1,31}$/i.test(value.trim()))) return "Enter an operator call and station call using letters, numbers or /.";
  if (values.gridSquare.trim() && !/^[A-R]{2}(?:\d{2}(?:[A-X]{2}(?:\d{2}(?:[A-X]{2})?)?)?)?$/i.test(values.gridSquare.trim())) return "Enter a valid Maidenhead station grid, or leave it blank.";
  if (!/^\d+(?:\.\d+)?$/.test(values.defaultPower) || Number(values.defaultPower) > 100_000) return "Enter default power between 0 and 100000 watts.";
  if (step >= 1) {
    if (values.radio === "hamlib" && (!Number.isInteger(values.radioModel) || values.radioModel! < 1 || values.radioModel !== 1 && !values.radioPath.trim() || values.radioBaud < 300 || values.radioBaud > 921600)) return "Choose a CAT radio model and enter its serial device or network address and baud rate.";
    if (values.radio === "direct_flex_lan" && (!values.radioHost.trim() || !port(values.radioPort))) return "Enter the FLEX radio address and a port between 1 and 65535.";
    if (values.radio === "direct_agent" && !url(values.agentURL, ["https:"])) return "Enter the Remote Station Agent HTTPS address.";
    if (values.radio === "direct_tci" && !url(values.tciEndpoint, ["ws:", "wss:"])) return "Enter the ExpertSDR TCI WebSocket address.";
  }
  if (step >= 2) {
    if (values.rotor === "native_dcu1" && (!values.rotorHost.trim() || !port(values.rotorPort))) return "Enter the rotator address and a port between 1 and 65535.";
    if (values.rotor === "hamlib" && (!Number.isInteger(values.rotorModel) || values.rotorModel! < 1 || values.rotorModel !== 1 && !values.rotorPath.trim() || values.rotorBaud < 300 || values.rotorBaud > 921600)) return "Choose a rotator model and enter its serial device or network address and baud rate.";
  }
  if (step >= 3 && values.logbookMode === "wavelog" && (!url(values.wavelogURL, ["https:", "http:"]) || !/^\d+$/.test(values.wavelogStationID) || Number(values.wavelogStationID) < 1 || Number(values.wavelogStationID) > 2_147_483_647)) return "Enter the Wavelog URL and a station ID between 1 and 2147483647.";
  return "";
}
const confirmed = (session: SettingsSession | RotorConfigurationSession) => {
  const state = session.getSnapshot();
  if (state.pending || state.conflict || state.workspaceChanged || state.error) throw new Error(state.error || "The setup save could not be confirmed. Check saved settings before retrying.");
};

/** Finish saves passive setup only. No selection, connection, motion or sync API
 * belongs here. A pending radio identity contains no endpoint or secret. */
export async function completeFirstRunSetup(values: FirstRunValues, dependencies: {
  request: Request; settings: SettingsSession; rotor: RotorConfigurationSession;
  station?: typeof stationSessionRequest; storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}) {
  const error = firstRunError(values); if (error) throw new Error(error);
  const { request, settings, rotor } = dependencies;
  const status = await request("workspace_status");
  if (!status.workspace_exists) {
    if (status.first_run_eligible !== true) throw new Error("Existing station data was found. Open logbook recovery before creating a workspace.");
    await request("workspace_create", { mode: "empty", onboarding: true });
  }
  await settings.load();
  const saved = settings.getSnapshot().snapshot?.settings;
  if (!saved || saved.onboardingCompleted !== false) throw new Error("This operator is already configured. Change setup in Settings.");
  confirmed(settings);
  const configured = { ...saved, operatorCall: values.operatorCall.trim().toUpperCase(), stationCall: values.stationCall.trim().toUpperCase(),
    gridSquare: values.gridSquare.trim().toUpperCase(), stationLocation: values.stationLocation.trim(), defaultPower: values.defaultPower,
    ...(values.radioName.trim() ? { defaultRadio: values.radioName.trim() } : {}), logbookMode: values.logbookMode,
    ...(values.logbookMode === "wavelog" ? { wavelogURL: values.wavelogURL.trim(), wavelogStationID: Number(values.wavelogStationID) } : {}), automaticSync: false };
  await settings.save(configured); confirmed(settings);
  if (values.radio !== "skip") {
    const station = dependencies.station ?? stationSessionRequest;
    const storage = dependencies.storage;
    const key = "xlog.first-run.radio-operation";
    const pending = storage?.getItem(key);
    if (pending) {
      const receipt = await station<StationReceipt | null>("radio1", { action: "receipt", operation_id: pending });
      if (receipt && receipt.status !== "saved") throw new Error("The radio setup outcome is uncertain. Review its receipt in Radio Settings before retrying.");
      storage?.removeItem(key);
    }
    const base = await station<StationSession>("radio1", { action: "snapshot" });
    const operationID = crypto.randomUUID();
    const action = values.radio === "direct_agent" ? "save" : `save_${values.radio === "direct_flex_lan" ? "flex" : values.radio === "direct_tci" ? "tci" : "hamlib"}`;
    const profile: RadioProfile = { manufacturer: "", model: "", nickname: values.radioName.trim(), provider: values.radio, enabled: true };
    const configuration = values.radio === "hamlib" ? { mode: "managed", model: values.radioModel, path: values.radioPath.trim(), baud: values.radioBaud }
      : values.radio === "direct_flex_lan" ? { host: values.radioHost.trim(), port: values.radioPort, station_name: "OM0RX-xLog" }
      : { endpoint: values.tciEndpoint.trim(), trx: 0, channel: 0 };
    storage?.setItem(key, operationID);
    const receipt = await station<StationReceipt>("radio1", { action, operation_id: operationID, generation: base.generation, revision: base.revision, profile,
      ...(values.radio === "direct_agent" ? { base_url: values.agentURL.trim() } : { configuration }) });
    if (receipt.operation_id !== operationID || receipt.status !== "saved") throw new Error("The radio setup save was not confirmed. Check its receipt before retrying.");
    storage?.removeItem(key);
  }
  if (values.rotor !== "skip") {
    await rotor.load(); confirmed(rotor);
    const configuration: RotorConfiguration = structuredClone(rotor.getSnapshot().snapshot?.configuration ?? defaultRotorConfiguration());
    configuration.owner = values.rotor;
    if (values.rotor === "native_dcu1") configuration.native_dcu1 = { host: values.rotorHost.trim(), port: values.rotorPort, name: "Rotor" };
    else configuration.hamlib = { ...configuration.hamlib, mode: "managed", model: values.rotorModel, path: values.rotorPath.trim(), baud: values.rotorBaud };
    await rotor.save(configuration); confirmed(rotor);
  }
  if (values.logbookMode === "wavelog" && values.wavelogToken) await request("secret_save", { account: "wavelog-token", value: values.wavelogToken });
  await settings.save({ ...configured, onboardingCompleted: true }); confirmed(settings);
}
