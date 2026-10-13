import { useCallback, useEffect, useRef, useState } from "react";
import { workerRequest } from "../worker";
import { SpotHistoryPanel } from "./SpotHistoryPanel";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";
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
  const [error, setError] = useState(""), [docking, setDocking] = useState(false);
  const mounted = useRef(true), dockingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dock = useCallback(async () => {
    if (dockingRef.current) return;
    dockingRef.current = true; setDocking(true); setError("");
    try { await dockDetachedWorkspace(); }
    catch {
      if (mounted.current) setError("Could not dock Spot History. The archive remains open; try Dock back again.");
    } finally {
      dockingRef.current = false;
      if (mounted.current) setDocking(false);
    }
  }, []);
  return <div className="app live monitor-app detached-spot-history-app"><main aria-label="Detached Spot History">
    <div className="live-actions detached-history-actions">
      <strong>Spot History</strong><span className="secondary">Retained local reports · read only</span>
      <button type="button" disabled={docking} onClick={() => void dock()}>{docking ? "Docking…" : "Dock back"}</button>
    </div>
    {error && <p className="live-error" role="alert">{error}</p>}
    <SpotHistoryPanel request={requestDetachedSpotHistory} />
  </main></div>;
}
