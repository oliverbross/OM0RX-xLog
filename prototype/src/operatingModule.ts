import { invoke, isTauri } from "@tauri-apps/api/core";

export type OperatingModule = "normal_logging" | "contesting";
export type OperatingModuleStatus = { selected: OperatingModule; context: string; transitioning: boolean };
let cached: OperatingModuleStatus | null = null;

export async function operatingModuleStatus(refresh = false): Promise<OperatingModuleStatus> {
  if (!isTauri()) return { selected: "normal_logging", context: "browser", transitioning: false };
  if (!cached || refresh) cached = await invoke<OperatingModuleStatus>("operating_module_status");
  return cached;
}
