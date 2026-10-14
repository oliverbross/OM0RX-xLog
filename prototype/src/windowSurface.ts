import type { ComponentType } from "react";

/** Load only the requested window before mounting it. Never mount the main
 * station controller as an intermediate screen or as a failed-child fallback. */
export async function loadWindowSurface(search: string): Promise<ComponentType> {
  const view = new URLSearchParams(search).get("view");
  if (view === "station-identity") return (await import("./live/DetachedStationIdentitySurface")).DetachedStationIdentitySurface;
  if (view === "propagation") return (await import("./live/DetachedPropagationSurface")).DetachedPropagationSurface;
  if (view === "station-status") return (await import("./live/DetachedStationStatusSurface")).DetachedStationStatusSurface;
  if (view === "rotor") return (await import("./live/DetachedRotorSurface")).DetachedRotorSurface;
  if (view === "cw") return (await import("./live/DetachedCWSurface")).DetachedCWSurface;
  if (view === "station-control") return (await import("./live/DetachedStationControlSurface")).DetachedStationControlSurface;
  if (view === "monitor") return (await import("./live/DetachedMonitorSurface")).DetachedMonitorSurface;
  if (view === "callsign-intelligence") return (await import("./live/DetachedCallsignIntelligenceSurface")).DetachedCallsignIntelligenceSurface;
  if (view === "world-map") return (await import("./live/DetachedWorldMapSurface")).DetachedWorldMapSurface;
  if (view === "band-maps") return (await import("./live/DetachedBandMapsSurface")).DetachedBandMapsSurface;
  if (view === "awards") return (await import("./live/DetachedAwardsSurface")).DetachedAwardsSurface;
  if (view === "logbook") return (await import("./live/DetachedLogbookSurface")).DetachedLogbookSurface;
  if (view === "log-qso") return (await import("./live/DetachedQSOSurface")).DetachedQSOSurface;
  if (view === "spot-history") return (await import("./live/DetachedSpotHistorySurface")).DetachedSpotHistorySurface;
  if (view === "dx-cluster") return (await import("./live/DetachedClusterSurface")).DetachedClusterSurface;
  if (view === "settings") return (await import("./live/DetachedSettingsSurface")).DetachedSettingsSurface;
  if (view === "chaser-dx") return (await import("./live/DetachedOpportunitiesSurface")).DetachedOpportunitiesSurface;
  return (await import("./LiveApp")).default;
}
