import type { ComponentType } from "react";

/** Keep contest-only route metadata out of every ordinary detached window. */
export async function loadContestWindowSurface(query: URLSearchParams): Promise<ComponentType> {
  const view=query.get("view");
  if(view==="contest-setup-operator")return(await import("./ContestOperatorDialog")).ContestOperatorDialog;
  if(view==="contest-setup-station"||view==="contest-setup-configuration")
    return(await import("./DetachedContestSetupDialog")).DetachedContestSetupDialog;
  if(view==="contest-setup-rover"||view==="contest-setup-about")
    return(await import("./DetachedContestAuxiliaryDialog")).DetachedContestAuxiliaryDialog;
  if(view==="contest-setup-digital")return(await import("./DetachedContestDigitalDialog")).DetachedContestDigitalDialog;
  if(view==="contest-setup")return(await import("./DetachedContestSetupSurface")).DetachedContestSetupSurface;
  if(view==="call-history")return(await import("./DetachedContestCallHistorySurface")).DetachedContestCallHistorySurface;
  return(await import("./DetachedContestSurface")).DetachedContestSurface;
}
