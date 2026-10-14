import { beforeEach, expect, it, vi } from "vitest";
const loaded = vi.hoisted(() => ({ main: vi.fn(), awards: vi.fn(), logbook: vi.fn(), qso: vi.fn(), cluster: vi.fn(), history: vi.fn() }));
const maps = vi.hoisted(() => ({ world: vi.fn(), bands: vi.fn() }));
const monitor = vi.hoisted(() => vi.fn());
const station = vi.hoisted(() => vi.fn());
const cw = vi.hoisted(() => vi.fn());
const rotor = vi.hoisted(() => vi.fn());
vi.mock("../src/live/DetachedRotorSurface", () => { rotor(); return { DetachedRotorSurface: "rotor-surface" }; });
vi.mock("../src/live/DetachedCWSurface", () => { cw(); return { DetachedCWSurface: "cw-surface" }; });
vi.mock("../src/live/DetachedStationControlSurface", () => { station(); return { DetachedStationControlSurface: "station-control-surface" }; });
vi.mock("../src/live/DetachedMonitorSurface", () => { monitor(); return { DetachedMonitorSurface: "monitor-surface" }; });
vi.mock("../src/LiveApp", () => { loaded.main(); return { default: "main-surface" }; });
vi.mock("../src/live/DetachedAwardsSurface", () => { loaded.awards(); return { DetachedAwardsSurface: "awards-surface" }; });
vi.mock("../src/live/DetachedLogbookSurface", () => { loaded.logbook(); return { DetachedLogbookSurface: "logbook-surface" }; });
vi.mock("../src/live/DetachedQSOSurface", () => { loaded.qso(); return { DetachedQSOSurface: "qso-surface" }; });
vi.mock("../src/live/DetachedSpotHistorySurface", () => { loaded.history(); return { DetachedSpotHistorySurface: "history-surface" }; });
vi.mock("../src/live/DetachedClusterSurface", () => { loaded.cluster(); return { DetachedClusterSurface: "cluster-surface" }; });
vi.mock("../src/live/DetachedWorldMapSurface", () => { maps.world(); return { DetachedWorldMapSurface: "world-map-surface" }; });
vi.mock("../src/live/DetachedBandMapsSurface", () => { maps.bands(); return { DetachedBandMapsSurface: "band-maps-surface" }; });
beforeEach(() => { vi.resetModules(); [...Object.values(loaded), ...Object.values(maps), monitor, station, cw, rotor].forEach(mock => mock.mockClear()); });
it("loads Rotor without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=rotor")).toBe("rotor-surface");
  expect(rotor).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("loads CW without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=cw")).toBe("cw-surface");
  expect(cw).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("loads Station Control without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=station-control")).toBe("station-control-surface");
  expect(station).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("loads detached surfaces without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=awards")).toBe("awards-surface");
  expect(await loadWindowSurface("?view=logbook&acceptance=local")).toBe("logbook-surface");
  expect(await loadWindowSurface("?view=log-qso")).toBe("qso-surface");
  expect(await loadWindowSurface("?view=spot-history")).toBe("history-surface");
  expect(await loadWindowSurface("?view=dx-cluster")).toBe("cluster-surface");
  expect(loaded.awards).toHaveBeenCalled(); expect(loaded.logbook).toHaveBeenCalled(); expect(loaded.cluster).toHaveBeenCalled();
  expect(loaded.main).not.toHaveBeenCalled();
  expect(loaded.qso).toHaveBeenCalledOnce();
  expect(loaded.history).toHaveBeenCalledOnce();
});
it("loads maps and Monitor independently and retains main routing", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=world-map")).toBe("world-map-surface");
  expect(await loadWindowSurface("?view=band-maps")).toBe("band-maps-surface");
  expect(loaded.main).not.toHaveBeenCalled();
  expect(await loadWindowSurface("?view=monitor")).toBe("monitor-surface"); expect(monitor).toHaveBeenCalledOnce();
  expect(loaded.main).not.toHaveBeenCalled();
  for (const query of ["", "?view=unknown"]) {
    expect(await loadWindowSurface(query)).toBe("main-surface");
  }
});
it("does not fall back to the main station controller after a child chunk fails", async () => {
  vi.doMock("../src/live/DetachedAwardsSurface", () => { throw new Error("chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=awards")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});

it("does not mount the main controller when the archive child cannot load", async () => {
  vi.doMock("../src/live/DetachedSpotHistorySurface", () => { throw new Error("archive chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=spot-history")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});

it("does not fall back to main when Station Control cannot load", async () => {
  vi.doMock("../src/live/DetachedStationControlSurface", () => { throw new Error("station chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=station-control")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
it("does not fall back to main when CW cannot load", async () => {
  vi.doMock("../src/live/DetachedCWSurface", () => { throw new Error("CW chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=cw")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
it("does not fall back to main when Rotor cannot load", async () => {
  vi.doMock("../src/live/DetachedRotorSurface", () => { throw new Error("Rotor chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=rotor")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
