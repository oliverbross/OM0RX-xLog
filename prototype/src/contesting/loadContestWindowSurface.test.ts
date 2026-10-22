import { expect, it } from "vitest";
import { DetachedContestQRZDetailsSurface } from "./DetachedContestQRZDetailsSurface";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { loadContestWindowSurface } from "./loadContestWindowSurface";
import { loadWindowSurface } from "../windowSurface";
import { ContestLogTransferWindow } from "./ContestLogTransferWindow";
import { DetachedRotorSurface } from "../live/DetachedRotorSurface";
import { DetachedStationControlSurface } from "../live/DetachedStationControlSurface";

it("routes Callsign Details to its dedicated contest renderer", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=qrz-details&scope=contesting")))
    .resolves.toBe(DetachedContestQRZDetailsSurface);
});

it("selects Callsign Details through the application window route", async () => {
  await expect(loadWindowSurface("?view=qrz-details&scope=contesting"))
    .resolves.toBe(DetachedContestQRZDetailsSurface);
});

it("keeps ordinary projected contest panels on the generic renderer", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=active-qso&scope=contesting")))
    .resolves.toBe(DetachedContestSurface);
});

it("reuses the shared Rotor surface for the contest rotor window", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=rotor&scope=contesting")))
    .resolves.toBe(DetachedRotorSurface);
});

it("routes contest Remote VFO to the compact shared station renderer", async () => {
  await expect(loadContestWindowSurface(new URLSearchParams("view=station-control&scope=contesting")))
    .resolves.toBe(DetachedStationControlSurface);
  await expect(loadWindowSurface("?view=station-control&scope=contesting"))
    .resolves.toBe(DetachedStationControlSurface);
});

it("routes Import or Transfer Log to its dedicated renderer", async () => {
  await expect(loadWindowSurface("?view=contest-log-transfer&scope=contesting"))
    .resolves.toBe(ContestLogTransferWindow);
});
