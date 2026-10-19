import { useCallback, useEffect, useRef, useState } from "react";
import { operatingModuleStatus } from "../operatingModule";
import { workerRequest, framedWorkerRequest } from "../worker";
import { connectWorkspaceNavigation, isContestMenuRoute } from "../live/workspaceNavigation";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";

type Data = Record<string, any>;
type MenuHandler = (route: string) => boolean | Promise<boolean>;

const message = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest Setup could not load.";
const request = async (method: string, params: Record<string, unknown> = {}) =>
  (await workerRequest(method, params)).result as Data;

export function DetachedContestSetupSurface() {
  const [context, setContext] = useState<{ operatingContext: string; workspaceGeneration: string; stationCall: string } | null>(null);
  const [station, setStation] = useState<Data | null>(null), [cluster, setCluster] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const menuHandler = useRef<MenuHandler | null>(null), readiness = useRef(new Set<() => void>());
  const registerMenuRoute = useCallback((handler: MenuHandler | null) => {
    menuHandler.current = handler;
    if (handler) for (const retry of readiness.current) retry();
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [operating, workspace, settings, nextStation, nextCluster] = await Promise.all([
        operatingModuleStatus(true), request("workspace_status"), request("settings_load"),
        request("station_snapshot"), request("cluster_snapshot"),
      ]);
      if (!active) return;
      const generation = typeof settings.generation === "string" ? settings.generation : "";
      if (!workspace.workspace_exists || !generation) throw new Error("Reconnect the xLog workspace before opening Contest Setup.");
      setContext({ operatingContext: operating.context, workspaceGeneration: generation,
        stationCall: typeof settings.settings?.stationCall === "string" ? settings.settings.stationCall : "" });
      setStation(nextStation); setCluster(nextCluster); setError("");
    };
    void refresh().catch(cause => { if (active) setError(message(cause)); });
    const timer = window.setInterval(() => void Promise.all([request("station_snapshot"), request("cluster_snapshot")])
      .then(([nextStation, nextCluster]) => { if (active) { setStation(nextStation); setCluster(nextCluster); } })
      .catch(cause => { if (active) setError(message(cause)); }), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => connectWorkspaceNavigation(route => {
    if (!isContestMenuRoute(route)) return false;
    return menuHandler.current?.(route) ?? false;
  }, setError, undefined, retry => {
    readiness.current.add(retry);
    return () => { readiness.current.delete(retry); };
  }), []);

  if (!context) return <main className="contest-workspace" aria-label="Contest Setup">
    <header className="contest-header"><div><h1>Contest Setup</h1><p>Detached contest session owner</p></div></header>
    {error ? <p className="contest-alert is-error" role="alert">{error}</p> : <p role="status">Loading contest setup…</p>}
  </main>;
  return <Not1MMContestWorkspace setupOnly request={(method, params = {}) => framedWorkerRequest(method, params)}
    serviceRequest={request} operatingContext={context.operatingContext} workspaceGeneration={context.workspaceGeneration}
    stationCall={context.stationCall} radioFrequencyHz={station?.radio?.frequency_hz}
    spots={Array.isArray(cluster?.snapshot?.spots) ? cluster.snapshot.spots : []} cluster={cluster}
    registerMenuRoute={registerMenuRoute}/>;
}

export default DetachedContestSetupSurface;
