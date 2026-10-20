import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { operatingModuleStatus } from "../operatingModule";
import { workerRequest, framedWorkerRequest } from "../worker";
import { connectWorkspaceNavigation, isContestMenuRoute } from "../live/workspaceNavigation";
import { loadStationSession, type RadioID, type StationSession } from "../live/stationSession";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import type { SetupView } from "./ContestSetupPanel";
import { tuneContestSpot } from "./contestSpotTune";

type Data = Record<string, any>;
type MenuHandler = (route: string) => boolean | Promise<boolean>;

const message = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest Setup could not load.";
const request = async (method: string, params: Record<string, unknown> = {}) =>
  (await workerRequest(method, params)).result as Data;

type LoadStationSession = (radioId: RadioID) => Promise<StationSession>;

export function contestSetupWindowSize(view: SetupView | null): { width: number; height: number } {
  if (view === "New Contest" || view === "Edit Current Contest") return { width: 560, height: 640 };
  if (view === "Choose a Contest") return { width: 560, height: 420 };
  if (view === "Edit Macros" || view === "Edit Keys") return { width: 880, height: 700 };
  return { width: 600, height: 360 };
}

/** Read the active radio through xLog's retained native station owner. Contest
 * Setup must not bypass that owner with an unscoped worker station_snapshot. */
export async function loadContestStationSnapshot(load: LoadStationSession = loadStationSession): Promise<Data> {
  const primary = await load("radio1");
  const radioId = primary.active_radio;
  const current = radioId === "radio1" ? primary : await load(radioId);
  if (current.active_radio !== radioId) {
    throw new Error("The active radio changed. Refresh Contest Setup before using station data.");
  }
  return current.radio?.snapshot && typeof current.radio.snapshot === "object" ? current.radio.snapshot : {};
}

export function DetachedContestSetupSurface() {
  const [context, setContext] = useState<{ operatingContext: string; workspaceGeneration: string; stationCall: string } | null>(null);
  const [station, setStation] = useState<Data | null>(null), [cluster, setCluster] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const menuHandler = useRef<MenuHandler | null>(null), readiness = useRef(new Set<() => void>());
  const registerMenuRoute = useCallback((handler: MenuHandler | null) => {
    menuHandler.current = handler;
    if (handler) for (const retry of readiness.current) retry();
  }, []);
  const resizeForSetupView = useCallback((view: SetupView | null) => {
    const size = contestSetupWindowSize(view);
    void getCurrentWindow().setSize(new LogicalSize(size.width, size.height)).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true, ready = false, inFlight = false;
    const refresh = async () => {
      const [operating, workspace, settings, nextStation, nextCluster] = await Promise.all([
        operatingModuleStatus(true), request("workspace_status"), request("settings_load"),
        loadContestStationSnapshot(), request("cluster_snapshot"),
      ]);
      if (!active) return;
      const generation = typeof settings.generation === "string" ? settings.generation : "";
      if (!workspace.workspace_exists || !generation) throw new Error("Reconnect the xLog workspace before opening Contest Setup.");
      setContext({ operatingContext: operating.context, workspaceGeneration: generation,
        stationCall: typeof settings.settings?.stationCall === "string" ? settings.settings.stationCall : "" });
      setStation(nextStation); setCluster(nextCluster); setError(""); ready = true;
    };
    const poll = async () => {
      const [nextStation, nextCluster] = await Promise.all([loadContestStationSnapshot(), request("cluster_snapshot")]);
      if (active) { setStation(nextStation); setCluster(nextCluster); setError(""); }
    };
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await (ready ? poll() : refresh()); }
      catch (cause) { if (active) setError(message(cause)); }
      finally { inFlight = false; }
    };
    void run();
    // A temporary handover or startup delay must not strand Contest Setup on
    // its error shell. Retry bootstrap until context exists, then poll only the
    // two retained observations used by the contest windows.
    const timer = window.setInterval(() => void run(), 1_000);
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
    serviceRequest={request} stationTune={tuneContestSpot} operatingContext={context.operatingContext} workspaceGeneration={context.workspaceGeneration}
    stationCall={context.stationCall} radioFrequencyHz={station?.radio?.frequency_hz}
    spots={Array.isArray(cluster?.snapshot?.spots) ? cluster.snapshot.spots : []} cluster={cluster}
    registerMenuRoute={registerMenuRoute} onSetupViewChange={resizeForSetupView}/>;
}

export default DetachedContestSetupSurface;
