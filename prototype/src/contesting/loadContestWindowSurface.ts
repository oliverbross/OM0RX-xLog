import type { ComponentType } from "react";

export const sharedContestWindowViews = ["active-qso", "band-maps", "world-map", "callsign-intelligence", "monitor", "propagation",
  "awards", "chaser-dx", "logbook", "edit-contact", "dx-cluster", "score-reporting", "messages"] as const;

/** Keep contest-only route metadata out of every ordinary detached window. */
export async function loadContestWindowSurface(query: URLSearchParams): Promise<ComponentType> {
  const view=query.get("view");
  if(view==="contest-setup-operator")return(await import("./ContestOperatorDialog")).ContestOperatorDialog;
  if(view==="contest-setup-station"||view==="contest-setup-configuration"||view==="contest-setup-macros"||view==="contest-setup-keys")
    return(await import("./DetachedContestSetupDialog")).DetachedContestSetupDialog;
  if(view==="contest-setup-rover"||view==="contest-setup-about")
    return(await import("./DetachedContestAuxiliaryDialog")).DetachedContestAuxiliaryDialog;
  if(view==="contest-setup-digital")return(await import("./DetachedContestDigitalDialog")).DetachedContestDigitalDialog;
  if(view==="contest-log-transfer")return(await import("./ContestLogTransferWindow")).ContestLogTransferWindow;
  if(view==="contest-setup")return(await import("./DetachedContestSetupSurface")).DetachedContestSetupSurface;
  if(view==="call-history")return(await import("./DetachedContestCallHistorySurface")).DetachedContestCallHistorySurface;
  if(view==="qrz-details")return(await import("./DetachedContestQRZDetailsSurface")).DetachedContestQRZDetailsSurface;
  if(view==="group-chat")return(await import("./DetachedContestGroupChat")).DetachedContestGroupChat;
  if(view==="rotor")return(await import("../live/DetachedRotorSurface")).DetachedRotorSurface;
  if(view==="station-control")return(await import("../live/DetachedStationControlSurface")).DetachedStationControlSurface;
  if(sharedContestWindowViews.includes(view as typeof sharedContestWindowViews[number]))
    return(await import("./DetachedContestSurface")).DetachedContestSurface;
  throw new Error(`Unknown contest window route: ${view ?? "missing"}`);
}
