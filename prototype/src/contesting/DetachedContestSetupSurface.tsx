import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { operatingModuleStatus } from "../operatingModule";
import { workerRequest, framedWorkerRequest } from "../worker";
import { connectWorkspaceNavigation, isContestMenuRoute } from "../live/workspaceNavigation";
import { loadStationSession, type RadioID, type StationSession } from "../live/stationSession";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import type { SetupView } from "./ContestSetupPanel";
import { stepContestVFO, tuneContestSpot } from "./contestSpotTune";
import { postContestSpot } from "./contestSurfaceNative";

type Data = Record<string, any>;
type MenuHandler = (route: string) => boolean | Promise<boolean>;
type WindowSize = { width: number; height: number };

const CONTEST_SETUP_AUTO_FIT_SIZE_KEY = "xlog.contest.setup.auto-fit-size.v1";
const sameWindowSize = (one: WindowSize, other: WindowSize) =>
  Math.abs(one.width - other.width) < 0.5 && Math.abs(one.height - other.height) < 0.5;

const message = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest Setup could not load.";
const request = async (method: string, params: Record<string, unknown> = {}) =>
  (await workerRequest(method, params)).result as Data;

type LoadStationSession = (radioId: RadioID) => Promise<StationSession>;
export type HostActiveContestStartup = { sessionID: string; workspaceGeneration: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function hostActiveContestStartup(query: URLSearchParams): HostActiveContestStartup | null {
  const startup = query.getAll("startup");
  if (startup.length === 0) return null;
  if (startup.length !== 1 || startup[0] !== "host-active") throw new Error("The native active contest startup context is invalid.");
  const sessions = query.getAll("hostActiveSessionID"), generations = query.getAll("hostActiveWorkspaceGeneration");
  if (sessions.length !== 1 || generations.length !== 1 || !uuid.test(sessions[0]) || !uuid.test(generations[0])) {
    throw new Error("The native active contest startup context is invalid.");
  }
  return { sessionID: sessions[0], workspaceGeneration: generations[0] };
}

export function contestSetupWindowSize(view: SetupView | null): { width: number; height: number } {
  if (view === "New Contest" || view === "Edit Current Contest") return { width: 560, height: 640 };
  if (view === "Choose a Contest") return { width: 560, height: 420 };
  if (view === "Edit Macros" || view === "Edit Keys") return { width: 880, height: 700 };
  return { width: 600, height: 360 };
}

export function fittedContestSetupWindowSize(view: SetupView | null, contentHeight: number, availableWidth: number, availableHeight: number, contentScale = 1, nativeChromeHeight = 0): { width: number; height: number } {
  const preferred = contestSetupWindowSize(view);
  const scale = Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1;
  const chrome = Number.isFinite(nativeChromeHeight) && nativeChromeHeight > 0 ? nativeChromeHeight : 0;
  const measured = Number.isFinite(contentHeight) && contentHeight > 0 ? Math.ceil((contentHeight + 24) * scale + chrome) : preferred.height;
  const widthLimit = Number.isFinite(availableWidth) && availableWidth > 0
    ? Math.max(520, Math.floor(availableWidth - 64)) : preferred.width;
  const heightLimit = Number.isFinite(availableHeight) && availableHeight > 0
    ? Math.max(320, Math.floor(availableHeight - 64)) : Math.max(preferred.height, measured);
  return {
    width: Math.min(preferred.width, widthLimit),
    height: Math.min(Math.max(preferred.height, measured), heightLimit),
  };
}

/** Only untouched xLog defaults and the last size applied by this fitter are
 * managed. Any other geometry belongs to the operator and must survive view
 * changes, close/reopen, and application restarts. */
export function isManagedContestSetupWindowSize(current: WindowSize, rememberedAutoFit: WindowSize | null): boolean {
  if (rememberedAutoFit && sameWindowSize(current, rememberedAutoFit)) return true;
  return [null, "New Contest", "Choose a Contest", "Edit Current Contest", "Edit Macros", "Edit Keys"]
    .map(view => contestSetupWindowSize(view as SetupView | null))
    .some(size => sameWindowSize(current, size));
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
  const strictHostActive = useMemo(() => hostActiveContestStartup(new URLSearchParams(window.location.search)), []);
  const [context, setContext] = useState<{ operatingContext: string; workspaceGeneration: string; stationCall: string; contestingTest: boolean } | null>(null);
  const [station, setStation] = useState<Data | null>(null), [cluster, setCluster] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const menuHandler = useRef<MenuHandler | null>(null), readiness = useRef(new Set<() => void>());
  const resizeFrame = useRef(0);
  const autoFitSize = useRef<WindowSize | null>(null), operatorSized = useRef(false);
  const registerMenuRoute = useCallback((handler: MenuHandler | null) => {
    menuHandler.current = handler;
    if (handler) for (const retry of readiness.current) retry();
  }, []);
  const resizeForSetupView = useCallback((view: SetupView | null) => {
    window.cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = window.requestAnimationFrame(() => {
      const fit = async () => {
        const panel = document.querySelector<HTMLElement>(".contest-workspace.is-setup-only > .contest-setup");
        const appWindow = getCurrentWindow();
        const [innerSize, outerSize, scaleFactor] = await Promise.all([appWindow.innerSize(), appWindow.outerSize(), appWindow.scaleFactor()]);
        const logicalInner = scaleFactor > 0 ? innerSize.toLogical(scaleFactor) : innerSize;
        const logicalInnerHeight = logicalInner.height;
        const nativeChromeHeight = scaleFactor > 0 ? Math.max(0, (outerSize.height - innerSize.height) / scaleFactor) : 0;
        if (!autoFitSize.current) {
          try {
            const stored = JSON.parse(localStorage.getItem(CONTEST_SETUP_AUTO_FIT_SIZE_KEY) ?? "null") as Partial<WindowSize> | null;
            autoFitSize.current = stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)
              ? { width: Number(stored.width), height: Number(stored.height) } : null;
          } catch { autoFitSize.current = null; }
        }
        if (operatorSized.current || !isManagedContestSetupWindowSize(logicalInner, autoFitSize.current)) {
          operatorSized.current = true;
          try { localStorage.removeItem(CONTEST_SETUP_AUTO_FIT_SIZE_KEY); } catch { /* geometry remains best effort */ }
          return;
        }
        const contentScale = window.innerHeight > 0 ? logicalInnerHeight / window.innerHeight : 1;
        const size = fittedContestSetupWindowSize(view, panel?.scrollHeight ?? 0, window.screen.availWidth, window.screen.availHeight, contentScale, nativeChromeHeight);
        autoFitSize.current = size;
        try { localStorage.setItem(CONTEST_SETUP_AUTO_FIT_SIZE_KEY, JSON.stringify(size)); } catch { /* geometry remains best effort */ }
        if (sameWindowSize(logicalInner, size)) return;
        await appWindow.setSize(new LogicalSize(size.width, size.height));
      };
      void fit().then(() => {
        // Re-measure after the native width change because wrapping can alter
        // the form height, especially with xLog's 4K interface scaling.
        resizeFrame.current = window.requestAnimationFrame(() => void fit().catch(cause => setError(message(cause))));
      }).catch(cause => setError(message(cause)));
    });
  }, []);
  useEffect(() => () => window.cancelAnimationFrame(resizeFrame.current), []);

  useEffect(() => {
    let active = true, ready = false, inFlight = false, isolated = false;
    const refresh = async () => {
      const health = await request("health");
      isolated = health.mode === "contesting_test";
      const observations = isolated
        ? Promise.resolve([{}, { snapshot: { spots: [] } }] as [Data, Data])
        : Promise.all([loadContestStationSnapshot(), request("cluster_snapshot")]);
      const [operating, workspace, settings, [nextStation, nextCluster]] = await Promise.all([
        operatingModuleStatus(true), request("workspace_status"), request("settings_load"), observations,
      ]);
      if (!active) return;
      const generation = typeof settings.generation === "string" ? settings.generation : "";
      if (!workspace.workspace_exists || !generation) throw new Error("Reconnect the xLog workspace before opening Contest Setup.");
      setContext({ operatingContext: operating.context, workspaceGeneration: generation,
        stationCall: typeof settings.settings?.stationCall === "string" ? settings.settings.stationCall : "",
        contestingTest: isolated });
      setStation(nextStation); setCluster(nextCluster); setError(""); ready = true;
    };
    const poll = async () => {
      const [nextStation, nextCluster] = isolated
        ? [{}, { snapshot: { spots: [] } }]
        : await Promise.all([loadContestStationSnapshot(), request("cluster_snapshot")]);
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
    serviceRequest={request} stationTune={tuneContestSpot} stationStep={stepContestVFO} contestSpot={postContestSpot} operatingContext={context.operatingContext} workspaceGeneration={context.workspaceGeneration}
    stationCall={context.stationCall} contestingTest={context.contestingTest} radioFrequencyHz={station?.radio?.frequency_hz}
    spots={Array.isArray(cluster?.snapshot?.spots) ? cluster.snapshot.spots : []} cluster={cluster}
    strictHostActive={strictHostActive} registerMenuRoute={registerMenuRoute} onSetupViewChange={resizeForSetupView}/>;
}

export default DetachedContestSetupSurface;
