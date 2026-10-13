import type { ComponentType } from "react";

/** Load only the requested window before mounting it. Never mount the main
 * station controller as an intermediate screen or as a failed-child fallback. */
export async function loadWindowSurface(search: string): Promise<ComponentType> {
  const view = new URLSearchParams(search).get("view");
  if (view === "awards") return (await import("./live/DetachedAwardsSurface")).DetachedAwardsSurface;
  if (view === "logbook") return (await import("./live/DetachedLogbookSurface")).DetachedLogbookSurface;
  if (view === "log-qso") return (await import("./live/DetachedQSOSurface")).DetachedQSOSurface;
  if (view === "dx-cluster") return (await import("./live/DetachedClusterSurface")).DetachedClusterSurface;
  return (await import("./LiveApp")).default;
}
