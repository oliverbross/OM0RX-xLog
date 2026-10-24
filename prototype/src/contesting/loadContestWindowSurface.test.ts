import { describe, expect, it } from "vitest";
import { ContestOperatorDialog } from "./ContestOperatorDialog";
import { DetachedContestAuxiliaryDialog } from "./DetachedContestAuxiliaryDialog";
import { DetachedContestCallHistorySurface } from "./DetachedContestCallHistorySurface";
import { DetachedContestDigitalDialog } from "./DetachedContestDigitalDialog";
import { DetachedContestGroupChat } from "./DetachedContestGroupChat";
import { DetachedContestQRZDetailsSurface } from "./DetachedContestQRZDetailsSurface";
import { DetachedContestSetupDialog } from "./DetachedContestSetupDialog";
import { DetachedContestSetupSurface } from "./DetachedContestSetupSurface";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { contestSurfacePanelIDs } from "./contestSurfaceProtocol";
import { loadContestWindowSurface, sharedContestWindowViews } from "./loadContestWindowSurface";
import { loadWindowSurface } from "../windowSurface";
import { ContestLogTransferWindow } from "./ContestLogTransferWindow";
import { ContestLogReviewWindow } from "./ContestLogReviewWindow";
import { DetachedRotorSurface } from "../live/DetachedRotorSurface";
import { DetachedStationControlSurface } from "../live/DetachedStationControlSurface";

describe("contest window route completeness", () => {
  it("admits only projection owners that have a shared or dedicated renderer", () => {
    const renderedProjectionOwners = new Set<string>(sharedContestWindowViews.map(view => view === "edit-contact" ? "logbook" : view));
    for (const panel of ["qrz-details", "rotor", "station-control"]) renderedProjectionOwners.add(panel);
    expect([...contestSurfacePanelIDs].sort()).toEqual([...renderedProjectionOwners].sort());
  });

  it.each(sharedContestWindowViews)("routes shared projection %s to its real renderer", async view => {
    await expect(loadContestWindowSurface(new URLSearchParams(`view=${view}&scope=contesting`)))
      .resolves.toBe(DetachedContestSurface);
  });

  it.each([
    ["call-history", DetachedContestCallHistorySurface],
    ["qrz-details", DetachedContestQRZDetailsSurface],
    ["group-chat", DetachedContestGroupChat],
    ["rotor", DetachedRotorSurface],
    ["station-control", DetachedStationControlSurface],
  ] as const)("routes dedicated contest window %s", async (view, renderer) => {
    await expect(loadContestWindowSurface(new URLSearchParams(`view=${view}&scope=contesting`))).resolves.toBe(renderer);
    await expect(loadWindowSurface(`?view=${view}&scope=contesting`)).resolves.toBe(renderer);
  });

  it.each([
    ["contest-setup", DetachedContestSetupSurface],
    ["contest-setup-operator", ContestOperatorDialog],
    ["contest-setup-station", DetachedContestSetupDialog],
    ["contest-setup-configuration", DetachedContestSetupDialog],
    ["contest-setup-digital", DetachedContestDigitalDialog],
    ["contest-setup-macros", DetachedContestSetupDialog],
    ["contest-setup-keys", DetachedContestSetupDialog],
    ["contest-setup-rover", DetachedContestAuxiliaryDialog],
    ["contest-setup-about", DetachedContestAuxiliaryDialog],
    ["contest-log-transfer", ContestLogTransferWindow],
    ["contest-log-review", ContestLogReviewWindow],
  ] as const)("routes ancillary contest window %s", async (view, renderer) => {
    await expect(loadWindowSurface(`?view=${view}&scope=contesting`)).resolves.toBe(renderer);
  });

  it("keeps Edit Contact as an editor-only child on the Log Display projection", async () => {
    expect(sharedContestWindowViews).toContain("edit-contact");
    await expect(loadWindowSurface("?view=edit-contact&scope=contesting")).resolves.toBe(DetachedContestSurface);
  });

  it.each(["alerts", "settings", "missing", ""])("rejects unowned contest route %s", async view => {
    await expect(loadWindowSurface(`?view=${view}&scope=contesting`)).rejects.toThrow("Unknown contest window route");
  });
});
