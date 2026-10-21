import { expect, it } from "vitest";
import { DetachedContestQRZDetailsSurface } from "./DetachedContestQRZDetailsSurface";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { loadContestWindowSurface } from "./loadContestWindowSurface";
import { loadWindowSurface } from "../windowSurface";
import { ContestLogTransferWindow } from "./ContestLogTransferWindow";

it("routes QRZ Details to its dedicated contest renderer", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=qrz-details&scope=contesting")))
    .resolves.toBe(DetachedContestQRZDetailsSurface);
});

it("selects QRZ Details through the application window route", async () => {
  await expect(loadWindowSurface("?view=qrz-details&scope=contesting"))
    .resolves.toBe(DetachedContestQRZDetailsSurface);
});

it("keeps ordinary projected contest panels on the generic renderer", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=active-qso&scope=contesting")))
    .resolves.toBe(DetachedContestSurface);
});

it("routes Import or Transfer Log to its dedicated renderer", async () => {
  await expect(loadWindowSurface("?view=contest-log-transfer&scope=contesting"))
    .resolves.toBe(ContestLogTransferWindow);
});
