import { beforeEach, expect, it, vi } from "vitest";
const loaded = vi.hoisted(() => ({ main: vi.fn(), intelligence: vi.fn() }));
vi.mock("../src/LiveApp", () => { loaded.main(); return { default: "main" }; });
vi.mock("../src/live/DetachedCallsignIntelligenceSurface", () => {
  loaded.intelligence(); return { DetachedCallsignIntelligenceSurface: "intelligence" };
});
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
it("loads Callsign Intelligence directly without evaluating the station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=callsign-intelligence")).toBe("intelligence");
  expect(loaded.intelligence).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("never falls back to the station controller if the intelligence chunk fails", async () => {
  vi.doMock("../src/live/DetachedCallsignIntelligenceSurface", () => { throw new Error("chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=callsign-intelligence")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
