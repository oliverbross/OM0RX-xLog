import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ContestSetupServiceTab } from "./ContestSetupPanel";

export async function openContestSetupService(service: ContestSetupServiceTab): Promise<void> {
  if (!isTauri()) throw new Error("Shared xLog settings require the native application.");
  await invoke("contest_setup_service_open", { service });
}
