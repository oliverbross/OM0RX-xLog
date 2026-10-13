import { isTauri } from "@tauri-apps/api/core";
import { workerRequest } from "../worker";
import { acceptanceActive } from "../acceptance";

export const clusterSessionIntentKey = "xlog.integration.clusterSessionIntent";

export const nativeClusterSession = () => isTauri();

/** Native storage wins after the first import. Do not guess automatic reconnect
 * if browser storage is unreadable: an explicit Disconnect may be stored there. */
export async function initializeNativeClusterResume(): Promise<void> {
  if (!nativeClusterSession() || acceptanceActive) return;
  const status = await workerRequest("cluster_resume_initialize", {});
  if ((status.result as { resume_initialized?: boolean } | undefined)?.resume_initialized === true) return;
  let legacy: string | null;
  try { legacy = localStorage.getItem(clusterSessionIntentKey); }
  catch { throw new Error("Cluster restart preference could not be read. Use Connect or Disconnect explicitly."); }
  const intent = legacy === "connected" || legacy === "disconnected" ? legacy : "automatic";
  const imported = await workerRequest("cluster_resume_initialize", { intent });
  if ((imported.result as { resume_initialized?: boolean } | undefined)?.resume_initialized !== true)
    throw new Error("Cluster restart preference was not confirmed. Use Connect or Disconnect explicitly.");
}

/** Reconnect is opt-out in existing cluster settings; explicit Disconnect wins
 * across restarts. This policy never depends on a radio or rotor connection. */
export function shouldResumeCluster(intent: string | null, configuration: {
  reconnect?: boolean; servers?: Array<{ enabled?: boolean }>;
} | undefined): boolean {
  return intent !== "disconnected" && configuration?.reconnect === true
    && configuration.servers?.some(server => server.enabled === true) === true;
}
