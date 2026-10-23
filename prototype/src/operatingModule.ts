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

export function invalidateOperatingModuleStatus(): void { cached = null; }

export async function switchOperatingModule(target: OperatingModule): Promise<OperatingModuleSwitchResult> {
  if (!isTauri()) return { status: "rejected", message: "Operating modules can only be changed in the installed app.", servicesRetired: false };
  const current = await operatingModuleStatus();
  try {
    return await invoke<OperatingModuleSwitchResult>("operating_module_switch", { target, context: current.context });
  } finally { invalidateOperatingModuleStatus(); }
}
