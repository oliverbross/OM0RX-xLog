import { beforeEach, expect, it, vi } from "vitest";
const loaded = vi.hoisted(() => ({ main: vi.fn(), awards: vi.fn(), logbook: vi.fn(), qso: vi.fn(), cluster: vi.fn(), history: vi.fn() }));
const maps = vi.hoisted(() => ({ world: vi.fn(), bands: vi.fn() }));
const monitor = vi.hoisted(() => vi.fn());
const station = vi.hoisted(() => vi.fn());
const cw = vi.hoisted(() => vi.fn());
const rotor = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const propagation = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => vi.fn());
const alerts = vi.hoisted(() => vi.fn());
vi.mock("../src/live/DetachedAlertsSurface", () => { alerts(); return { DetachedAlertsSurface: "alerts-surface" }; });
vi.mock("../src/live/DetachedStationIdentitySurface", () => { identity(); return { DetachedStationIdentitySurface: "station-identity-surface" }; });
vi.mock("../src/live/DetachedPropagationSurface", () => { propagation(); return { DetachedPropagationSurface: "propagation-surface" }; });
vi.mock("../src/live/DetachedStationStatusSurface", () => { status(); return { DetachedStationStatusSurface: "station-status-surface" }; });
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
beforeEach(() => { vi.resetModules(); [...Object.values(loaded), ...Object.values(maps), monitor, station, cw, rotor, status, propagation, identity, alerts].forEach(mock => mock.mockClear()); });
it("loads Station Identity without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=station-identity")).toBe("station-identity-surface");
  expect(identity).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("loads Alerts without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=alerts")).toBe("alerts-surface");
  expect(alerts).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("cannot fall back to the main station controller if the Alerts chunk fails", async () => {
  vi.doMock("../src/live/DetachedAlertsSurface", () => { throw new Error("Alerts chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=alerts")).rejects.toThrow(); expect(loaded.main).not.toHaveBeenCalled();
  vi.doUnmock("../src/live/DetachedAlertsSurface");
});
it("loads Propagation without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=propagation")).toBe("propagation-surface");
  expect(propagation).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
it("loads Station Status without evaluating the main station controller", async () => {
  const { loadWindowSurface } = await import("../src/windowSurface");
  expect(await loadWindowSurface("?view=station-status")).toBe("station-status-surface");
  expect(status).toHaveBeenCalledOnce(); expect(loaded.main).not.toHaveBeenCalled();
});
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
it("does not fall back to main when Station Status cannot load", async () => {
  vi.doMock("../src/live/DetachedStationStatusSurface", () => { throw new Error("Status chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=station-status")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
it("does not fall back to main when Propagation cannot load", async () => {
  vi.doMock("../src/live/DetachedPropagationSurface", () => { throw new Error("Propagation chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=propagation")).rejects.toThrow();
  expect(loaded.main).not.toHaveBeenCalled();
});
it("does not fall back to main when Station Identity cannot load", async () => {
  vi.doMock("../src/live/DetachedStationIdentitySurface", () => { throw new Error("Identity chunk unavailable"); });
  const { loadWindowSurface } = await import("../src/windowSurface");
  await expect(loadWindowSurface("?view=station-identity")).rejects.toThrow(); expect(loaded.main).not.toHaveBeenCalled();
});
