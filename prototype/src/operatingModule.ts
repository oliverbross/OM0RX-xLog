import { invoke, isTauri } from "@tauri-apps/api/core";

export type OperatingModule = "normal_logging" | "contesting";
export type OperatingModuleStatus = { selected: OperatingModule; context: string; transitioning: boolean };
export type OperatingModuleSwitchResult = { status: "rejected" | "failed"; message: string; servicesRetired: boolean };
let cached: OperatingModuleStatus | null = null;

export async function operatingModuleStatus(refresh = false): Promise<OperatingModuleStatus> {
  if (!isTauri()) return { selected: "normal_logging", context: "browser", transitioning: false };
  if (!cached || refresh) cached = await invoke<OperatingModuleStatus>("operating_module_status");
  return cached;
}

export async function switchOperatingModule(target: OperatingModule): Promise<OperatingModuleSwitchResult> {
  const current = await operatingModuleStatus();
  return invoke<OperatingModuleSwitchResult>("operating_module_switch", { target, context: current.context });
}

export function contestRetirementAssessment(capability: "checking" | "available" | "unavailable", workspaceExists: boolean,
  controllerAvailable: boolean): "prepare" | "preserve_durable_recovery" | "wait" {
  if (controllerAvailable) return "prepare";
  return capability === "available" && workspaceExists ? "wait" : "preserve_durable_recovery";
}
