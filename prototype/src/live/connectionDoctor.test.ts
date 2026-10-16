// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectConnectionDoctor, readConnectionDoctorPreview } from "./connectionDoctor";

const preview = () => ({ schemaVersion: 1, evidence: "retained-worker-state-only", provider: "direct_tci", configuration: "unknown",
  transport: "ready", freshness: "fresh", readOnly: true, advertisedCapabilities: ["observe"], checks: [
    { stage: "provider", status: "passed", reason: "providerRecognized" },
    { stage: "configuration", status: "unknown", reason: "configurationUnknown" },
    { stage: "connection", status: "passed", reason: "connected" },
    { stage: "freshness", status: "passed", reason: "observationFresh" },
    { stage: "capabilities", status: "passed", reason: "readOnly" },
  ] });
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());

it("accepts only the closed typed support preview", () => {
  expect(readConnectionDoctorPreview(preview()).provider).toBe("direct_tci");
  expect(() => readConnectionDoctorPreview({ ...preview(), endpoint: "secret" })).toThrow("could not be verified");
  expect(() => readConnectionDoctorPreview({ ...preview(), advertisedCapabilities: ["observe", "observe"] })).toThrow();
  const wrong = preview(); wrong.checks = [...wrong.checks].reverse(); expect(() => readConnectionDoctorPreview(wrong)).toThrow();
});

it("subscribes before one retained read, coalesces wakes and has no timer poller", async () => {
  let wake!: () => void; const stop = vi.fn(), changed = vi.fn(), failed = vi.fn();
  const read = vi.fn(async () => preview());
  const dispose = connectConnectionDoctor(changed, failed, { read, listen: async (_name, callback) => { wake = callback; return stop; } });
  expect(read).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20_000); expect(read).toHaveBeenCalledOnce();
  wake(); wake(); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(3);
  expect(changed).toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled(); dispose(); expect(stop).toHaveBeenCalledTimes(2);
});

it("never relays native failure details", async () => {
  const failed = vi.fn();
  connectConnectionDoctor(vi.fn(), failed, { read: async () => { throw new Error("https://secret.invalid/?token=private"); }, listen: async () => () => {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalledWith("Connection Doctor preview is unavailable. Retained station state was not changed.");
  expect(JSON.stringify(failed.mock.calls)).not.toContain("secret.invalid");
});
