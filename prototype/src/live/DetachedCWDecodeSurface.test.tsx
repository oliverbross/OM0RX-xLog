import { expect, it } from "vitest";
import { loadWindowSurface } from "../windowSurface";
import { DetachedCWDecodeSurface } from "./DetachedCWDecodeSurface";
it("loads the receive-only CW window directly without mounting the main controller", async () => {
  expect(await loadWindowSurface("?view=cw-decode")).toBe(DetachedCWDecodeSurface);
  expect(await loadWindowSurface("?view=cw-decode&scope=contesting")).toBe(DetachedCWDecodeSurface);
});
