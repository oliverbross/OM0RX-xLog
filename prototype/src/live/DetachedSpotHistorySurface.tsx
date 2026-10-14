import { workerRequest } from "../worker";
import { SpotHistoryPanel } from "./SpotHistoryPanel";
import "./DetachedSpotHistorySurface.css";

export const detachedSpotHistoryMethods = [
  "spot_history_status", "spot_history_query", "spot_history_detail", "spot_history_stats",
] as const;

/** The archive remains owned by the existing native cluster service. Opening a
 * reader never starts another recorder, cluster connection or station owner. */
export async function requestDetachedSpotHistory(method: string, params: Record<string, unknown> = {}) {
  if (!detachedSpotHistoryMethods.some(allowed => allowed === method))
    throw new Error("Spot History can only read the local report archive.");
  const result = (await workerRequest(method, params)).result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("The archive response could not be verified. Refresh to retry.");
  return result;
}

export function DetachedSpotHistorySurface() {
  return <div className="app live monitor-app detached-spot-history-app"><main aria-label="Detached Spot History">
    <SpotHistoryPanel request={requestDetachedSpotHistory} />
  </main></div>;
}
