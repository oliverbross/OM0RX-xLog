import { describe, it, expect, vi } from "vitest";
import { retireStationProvider } from "../src/live/stationHandover";

describe("station provider handover", () => {
  it("retires embedded remote ownership without connecting another provider", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    await retireStationProvider("direct_agent", invoke);
    expect(invoke.mock.calls).toEqual([["station_disconnect", { provider: "direct_agent" }]]);
  });
  it("waits for both independent local owners before completing", async () => {
    let release!: () => void;
    const rotor = new Promise<void>(resolve => { release = resolve; });
    const invoke = vi.fn((_method, args) => args.device === "rotor" ? rotor : Promise.resolve({}));
    let completed = false;
    const pending = retireStationProvider("hamlib", invoke).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    release(); await pending;
    expect(completed).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("still retires the other local device when one release fails and rejects handover", async () => {
    const invoke = vi.fn((_method, args) => args.device === "radio" ? Promise.reject(new Error("unavailable")) : Promise.resolve({}));
    await expect(retireStationProvider("hamlib", invoke)).rejects.toThrow("could not be confirmed");
    expect(invoke).toHaveBeenCalledWith("hamlib_disconnect", { device: "rotor" });
  });
});
