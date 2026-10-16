import { isTauri } from "@tauri-apps/api/core";
import { workerRequest } from "../worker";
import { acceptanceActive } from "../acceptance";

export const clusterSessionIntentKey = "xlog.integration.clusterSessionIntent";

export const nativeClusterSession = () => isTauri();

// This exact native rejection happens before the worker transport is called.
// Never retry a worker error, lost reply, or an explicit Connect/Disconnect.
const nativeClusterBusy = "Cluster session is busy. Wait for the current action to finish.";
const initializationRetryDelays = [50, 150];
async function requestInitialization(params: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    try { return await workerRequest("cluster_resume_initialize", params); }
    catch (cause) {
      if (cause !== nativeClusterBusy || attempt >= initializationRetryDelays.length) {
        if (cause === nativeClusterBusy)
          throw new Error("Cluster restart preference check is still busy. It will retry automatically.");
        throw cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "Cluster restart preference could not be initialized.");
      }
      await new Promise(resolve => setTimeout(resolve, initializationRetryDelays[attempt]));
    }
  }
}

/** Native storage wins after the first import. Do not guess automatic reconnect
 * if browser storage is unreadable: an explicit Disconnect may be stored there. */
export async function initializeNativeClusterResume(): Promise<void> {
  if (!nativeClusterSession() || acceptanceActive) return;
  const status = await requestInitialization({});
  if ((status.result as { resume_initialized?: boolean } | undefined)?.resume_initialized === true) return;
  let legacy: string | null;
  try { legacy = localStorage.getItem(clusterSessionIntentKey); }
  catch { throw new Error("Cluster restart preference could not be read. Use Connect or Disconnect explicitly."); }
  const intent = legacy === "connected" || legacy === "disconnected" ? legacy : "automatic";
  const imported = await requestInitialization({ intent });
  if ((imported.result as { resume_initialized?: boolean } | undefined)?.resume_initialized !== true)
    throw new Error("Cluster restart preference was not confirmed. Use Connect or Disconnect explicitly.");
}

/** Startup connection is opt-out in cluster settings and independent of the
 * previous running session, radio or rotor connection. */
export function shouldResumeCluster(configuration: {
  connectOnStartup?: boolean; servers?: Array<{ enabled?: boolean }>;
} | undefined): boolean {
  return configuration?.connectOnStartup === true
    && configuration.servers?.some(server => server.enabled === true) === true;
}
