// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { validMapEvidence, validWorkerResult, waitForAcceptance } from "../src/acceptance";

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
describe("native acceptance evidence", () => {
  it("requires loaded and rendered land, visible canvas and healthy WebGL", () => {
    const map = { loaded: true, landFeatures: 300, renderedLandFeatures: 8, canvasWidth: 900, canvasHeight: 400, webgl: true, error: "", visible: true };
    expect(validMapEvidence(map)).toBe(true);
    for (const mutation of [{ loaded: false }, { landFeatures: 0 }, { renderedLandFeatures: 0 }, { canvasWidth: 0 }, { webgl: false }, { error: "source failed" }, { visible: false }]) {
      expect(validMapEvidence({ ...map, ...mutation })).toBe(false);
    }
  });
  it("rejects successful envelopes with invalid or unsafe worker evidence", () => {
    const health = { id: "fixture", ok: true, result: { protocol_version: 1, worker: "xlog-prototype-worker", mode: "synthetic_only", station_io: false } };
    expect(validWorkerResult("health", health)).toBe(true);
    expect(validWorkerResult("health", { ...health, result: { ...health.result, station_io: true } })).toBe(false);
    expect(validWorkerResult("self_test", { id: "fixture", ok: true, result: { passed: true } })).toBe(false);
    expect(validWorkerResult("parse_adif", { id: "fixture", ok: true, result: { record_count: 1, records: [] } })).toBe(false);
    expect(validWorkerResult("health", { ...health, ok: false })).toBe(false);
  });
  it("bounds a missing rendered condition and names the failure", async () => {
    vi.useFakeTimers();
    const pending = waitForAcceptance("missing canvas", () => false, 100);
    const rejected = expect(pending).rejects.toThrow("Timed out: missing canvas");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });
  it("does no interactions when the native CLI gate is disabled and runs once under StrictMode", async () => {
    invoke.mockResolvedValue(false);
    const { startAcceptance, acceptanceActive } = await import("../src/acceptance");
    startAcceptance(false);
    startAcceptance(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("acceptance_enabled");
    expect(acceptanceActive).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("reports a map failure visibly and never claims native acceptance passed", async () => {
    const app = document.createElement("div");
    app.className = "app";
    const map = document.createElement("div");
    map.className = "map";
    map.dataset.mapError = "local geography missing";
    app.append(map);
    document.body.append(app);
    invoke.mockImplementation(async (command: string) => command === "acceptance_enabled" ? true : undefined);
    const { startAcceptance } = await import("../src/acceptance");
    startAcceptance(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("finish_acceptance", {
      report: expect.objectContaining({ status: "failed", worker: false, error: "Map failed: local geography missing" }),
    }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("local geography missing");
    expect(invoke).not.toHaveBeenCalledWith("open_monitor");
  });
});
