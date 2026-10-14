import type { ComponentType } from "react";

/** Load only the requested window before mounting it. Never mount the main
 * station controller as an intermediate screen or as a failed-child fallback. */
export async function loadWindowSurface(search: string): Promise<ComponentType> {
  const view = new URLSearchParams(search).get("view");
  if (view === "monitor") return (await import("./live/DetachedMonitorSurface")).DetachedMonitorSurface;
  if (view === "callsign-intelligence") return (await import("./live/DetachedCallsignIntelligenceSurface")).DetachedCallsignIntelligenceSurface;
  if (view === "world-map") return (await import("./live/DetachedWorldMapSurface")).DetachedWorldMapSurface;
  if (view === "band-maps") return (await import("./live/DetachedBandMapsSurface")).DetachedBandMapsSurface;
  if (view === "awards") return (await import("./live/DetachedAwardsSurface")).DetachedAwardsSurface;
  if (view === "logbook") return (await import("./live/DetachedLogbookSurface")).DetachedLogbookSurface;
  if (view === "log-qso") return (await import("./live/DetachedQSOSurface")).DetachedQSOSurface;
  if (view === "spot-history") return (await import("./live/DetachedSpotHistorySurface")).DetachedSpotHistorySurface;
  if (view === "dx-cluster") return (await import("./live/DetachedClusterSurface")).DetachedClusterSurface;
  return (await import("./LiveApp")).default;
}
