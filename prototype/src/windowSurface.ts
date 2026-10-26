import type { ComponentType } from "react";

/** Load only the requested window before mounting it. Never mount the main
 * station controller as an intermediate screen or as a failed-child fallback. */
export async function loadWindowSurface(search: string): Promise<ComponentType> {
  const query = new URLSearchParams(search), view = query.get("view");
  if (view === "cw-decode") return (await import("./live/DetachedCWDecodeSurface")).DetachedCWDecodeSurface;
  if (view === "station-control")
    return (await import("./live/DetachedStationControlSurface")).DetachedStationControlSurface;
  if (view?.startsWith("contest-setup") || view === "contest-log-transfer" || query.get("scope") === "contesting")
    return (await import("./contesting/loadContestWindowSurface")).loadContestWindowSurface(query);
  if (view === "operating-goals") return (await import("./live/DetachedOperatingGoalsSurface")).DetachedOperatingGoalsSurface;
  if (view === "previous-qsos") return (await import("./live/DetachedPreviousQSOsSurface")).DetachedPreviousQSOsSurface;
  if (view === "antenna") return (await import("./live/DetachedAntennaSurface")).DetachedAntennaSurface;
  if (view === "alerts") return (await import("./live/DetachedAlertsSurface")).DetachedAlertsSurface;
  if (view === "station-identity") return (await import("./live/DetachedStationIdentitySurface")).DetachedStationIdentitySurface;
  if (view === "propagation") return (await import("./live/DetachedPropagationSurface")).DetachedPropagationSurface;
  if (view === "station-status") return (await import("./live/DetachedStationStatusSurface")).DetachedStationStatusSurface;
  if (view === "connection-doctor") return (await import("./live/DetachedConnectionDoctorSurface")).DetachedConnectionDoctorSurface;
  if (view === "rotor") return (await import("./live/DetachedRotorSurface")).DetachedRotorSurface;
  if (view === "cw") return (await import("./live/DetachedCWSurface")).DetachedCWSurface;
  if (view === "monitor") return (await import("./live/DetachedMonitorSurface")).DetachedMonitorSurface;
  if (view === "callsign-intelligence") return (await import("./live/DetachedCallsignIntelligenceSurface")).DetachedCallsignIntelligenceSurface;
  if (view === "world-map") return (await import("./live/DetachedWorldMapSurface")).DetachedWorldMapSurface;
  if (view === "dxpedition-map") return (await import("./live/DetachedDXpeditionMapSurface")).DetachedDXpeditionMapSurface;
  if (view === "band-maps") return (await import("./live/DetachedBandMapsSurface")).DetachedBandMapsSurface;
  if (view === "awards") return (await import("./live/DetachedAwardsSurface")).DetachedAwardsSurface;
  if (view === "logbook") return (await import("./live/DetachedLogbookSurface")).DetachedLogbookSurface;
  if (view === "log-qso") return import("./live/DetachedQSOSurface").then(module => module.DetachedQSOSurface);
  if (view === "spot-history") return (await import("./live/DetachedSpotHistorySurface")).DetachedSpotHistorySurface;
  if (view === "dx-cluster") return (await import("./live/DetachedClusterSurface")).DetachedClusterSurface;
  if (view === "settings") return (await import("./live/DetachedSettingsSurface")).DetachedSettingsSurface;
  if (view === "chaser-dx") return (await import("./live/DetachedOpportunitiesSurface")).DetachedOpportunitiesSurface;
  if (view === "hf-propagation-live") return (await import("./live/DetachedHFPropagationLiveSurface")).DetachedHFPropagationLiveSurface;
  return import("./LiveApp").then(module => module.default);
}
