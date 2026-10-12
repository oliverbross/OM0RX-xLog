export const clusterSessionIntentKey = "xlog.integration.clusterSessionIntent";

/** Reconnect is opt-out in existing cluster settings; explicit Disconnect wins
 * across restarts. This policy never depends on a radio or rotor connection. */
export function shouldResumeCluster(intent: string | null, configuration: {
  reconnect?: boolean; servers?: Array<{ enabled?: boolean }>;
} | undefined): boolean {
  return intent !== "disconnected" && configuration?.reconnect === true
    && configuration.servers?.some(server => server.enabled === true) === true;
}
