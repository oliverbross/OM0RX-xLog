import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DoctorProvider = "direct_agent" | "direct_flex_lan" | "direct_tci" | "hamlib" | "unknown";
export type DoctorStatus = "passed" | "attention" | "unknown";
export type DoctorStage = "provider" | "configuration" | "connection" | "freshness" | "capabilities";
export type DoctorReason = "providerRecognized" | "providerUnknown" | "configurationRetained" | "configurationMissing"
  | "configurationInvalid" | "configurationUnknown" | "connected" | "connectionPending" | "disconnected"
  | "connectionUnknown" | "observationFresh" | "observationStale" | "observationUnavailable"
  | "observationTimeUnknown" | "readOnly" | "capabilitiesAdvertised" | "capabilitiesUnknown";
export type ConnectionDoctorPreview = {
  schemaVersion: 1;
  evidence: "retained-worker-state-only";
  provider: DoctorProvider;
  configuration: "unknown" | "configured" | "missing" | "invalid";
  transport: "stopped" | "connecting" | "synchronizing" | "ready" | "unknown";
  freshness: "fresh" | "stale" | "unavailable" | "unknown";
  readOnly?: boolean;
  advertisedCapabilities: ("observe" | "tune" | "ptt" | "cw" | "rfPower")[];
  checks: { stage: DoctorStage; status: DoctorStatus; reason: DoctorReason }[];
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const providers = ["direct_agent", "direct_flex_lan", "direct_tci", "hamlib", "unknown"];
const configurations = ["unknown", "configured", "missing", "invalid"];
const transports = ["stopped", "connecting", "synchronizing", "ready", "unknown"];
const freshness = ["fresh", "stale", "unavailable", "unknown"];
const stages: DoctorStage[] = ["provider", "configuration", "connection", "freshness", "capabilities"];
const statuses = ["passed", "attention", "unknown"];
const reasons = ["providerRecognized", "providerUnknown", "configurationRetained", "configurationMissing", "configurationInvalid",
  "configurationUnknown", "connected", "connectionPending", "disconnected", "connectionUnknown", "observationFresh", "observationStale",
  "observationUnavailable", "observationTimeUnknown", "readOnly", "capabilitiesAdvertised", "capabilitiesUnknown"];
const capabilities = ["observe", "tune", "ptt", "cw", "rfPower"];
const exactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

export function readConnectionDoctorPreview(value: unknown): ConnectionDoctorPreview {
  if (!object(value) || !exactKeys(value, ["schemaVersion", "evidence", "provider", "configuration", "transport", "freshness", "readOnly", "advertisedCapabilities", "checks"])
    || value.schemaVersion !== 1 || value.evidence !== "retained-worker-state-only"
    || !providers.includes(value.provider as string) || !configurations.includes(value.configuration as string)
    || !transports.includes(value.transport as string) || !freshness.includes(value.freshness as string)
    || value.readOnly !== undefined && typeof value.readOnly !== "boolean"
    || !Array.isArray(value.advertisedCapabilities) || value.advertisedCapabilities.length > capabilities.length
    || new Set(value.advertisedCapabilities).size !== value.advertisedCapabilities.length
    || !value.advertisedCapabilities.every(item => capabilities.includes(item))
    || !Array.isArray(value.checks) || value.checks.length !== stages.length
    || !value.checks.every((check, index) => object(check) && exactKeys(check, ["stage", "status", "reason"])
      && check.stage === stages[index] && statuses.includes(check.status as string) && reasons.includes(check.reason as string))) {
    throw new Error("Connection Doctor preview could not be verified.");
  }
  return value as ConnectionDoctorPreview;
}

type Adapter = { read: () => Promise<unknown>; listen: (name: string, wake: () => void) => Promise<() => void> };
export function connectConnectionDoctor(changed: (value: ConnectionDoctorPreview) => void, failed: (message: string) => void,
  adapter: Adapter = { read: () => invoke("connection_doctor_snapshot"), listen: (name, wake) => listen(name, wake) }) {
  let active = true, ready = false, reading = false, again = false, revision = 0;
  const stops: (() => void)[] = [];
  const recover = async () => {
    if (!active || !ready) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = revision;
      try {
        const value = readConnectionDoctorPreview(await adapter.read());
        if (active && captured === revision) changed(value);
      } catch { if (active && captured === revision) failed("Connection Doctor preview is unavailable. Retained station state was not changed."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; revision++; void recover(); };
  window.addEventListener("focus", wake);
  void Promise.allSettled(["xlog:station-selection", "xlog:station-telemetry"].map(name => adapter.listen(name, wake))).then(results => {
    for (const result of results) if (result.status === "fulfilled") { if (active) stops.push(result.value); else result.value(); }
    if (!active) return;
    ready = true;
    if (results.some(result => result.status === "rejected")) failed("Some station notifications are unavailable. Refocus the window to read retained state again.");
    void recover();
  });
  return () => { active = false; revision++; stops.forEach(stop => stop()); window.removeEventListener("focus", wake); };
}
