import { expect, it } from "vitest";
import { DetachedStationControlSurface } from "./live/DetachedStationControlSurface";
import { loadWindowSurface } from "./windowSurface";

it("routes both normal Station Control and contest Remote VFO to the shared station surface", async () => {
  await expect(loadWindowSurface("?view=station-control")).resolves.toBe(DetachedStationControlSurface);
  await expect(loadWindowSurface("?view=station-control&scope=contesting")).resolves.toBe(DetachedStationControlSurface);
});
