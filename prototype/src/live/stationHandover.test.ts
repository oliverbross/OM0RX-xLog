import { describe, expect, it, vi } from "vitest";
import { retireStationProvider } from "./stationHandover";

describe("station provider handover", () => {
  it("retires the exact direct FLEX owner before selection changes", async () => {
    const invoke = vi.fn(async () => ({ result: { source: "direct_flex_lan" } }));
    await retireStationProvider("direct_flex_lan", invoke);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("station_disconnect", { provider: "direct_flex_lan" });
  });
  it("does not swallow an unconfirmed transmit release", async () => {
    const invoke = vi.fn(async () => { throw new Error("release_unconfirmed"); });
    await expect(retireStationProvider("direct_flex_lan", invoke)).rejects.toThrow("release_unconfirmed");
  });
  it("refuses unknown providers without disconnecting another owner", async () => {
    const invoke = vi.fn();
    await expect(retireStationProvider("unknown", invoke)).rejects.toThrow("Unknown station provider");
    expect(invoke).not.toHaveBeenCalled();
  });
});
