import { describe, it, expect, vi } from "vitest";
import { retireStationProvider } from "../src/live/stationHandover";

describe("station provider handover", () => {
  it("retires embedded remote ownership without connecting another provider", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    await retireStationProvider("direct_agent", invoke);
    expect(invoke.mock.calls).toEqual([["station_disconnect", { provider: "direct_agent" }]]);
  });
  it("waits for the local radio and preserves the independent rotor", async () => {
    let release!: () => void;
    const radio = new Promise<void>(resolve => { release = resolve; });
    const invoke = vi.fn((_method, args) => args.device === "radio" ? radio : Promise.resolve({}));
    let completed = false;
    const pending = retireStationProvider("hamlib", invoke).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    release(); await pending;
    expect(completed).toBe(true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("hamlib_disconnect", { device: "radio" });
  });
  it("does not disconnect the rotor when radio handover fails", async () => {
    const invoke = vi.fn((_method, args) => args.device === "radio" ? Promise.reject(new Error("unavailable")) : Promise.resolve({}));
    await expect(retireStationProvider("hamlib", invoke)).rejects.toThrow("could not be confirmed");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("hamlib_disconnect", { device: "radio" });
  });
});
