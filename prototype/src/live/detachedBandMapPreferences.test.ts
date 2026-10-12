import { describe, expect, it } from "vitest";
import type { BandMapViewPreferences } from "./BandMaps";
import { mergeBandMapPreferenceIntent, sameBandMapPreferences } from "./detachedBandMapPreferences";

const base: BandMapViewPreferences = { bands: ["20m"], followRadio: true, layout: "grid", fontScale: 1, modes: ["cw", "data", "phone"] };

describe("detached band-map preference intents", () => {
  it("retains an unsent mode edit when a rapid layout edit uses the same old render", () => {
    const first = mergeBandMapPreferenceIntent(base, base, { ...base, modes: ["cw", "data"] });
    const second = mergeBandMapPreferenceIntent(first, base, { ...base, layout: "row" });
    expect(second).toEqual({ ...base, modes: ["cw", "data"], layout: "row" });
  });

  it("merges a multi-field add-band intent without reverting an earlier font-size edit", () => {
    const first = mergeBandMapPreferenceIntent(base, base, { ...base, fontScale: 1.2 });
    const second = mergeBandMapPreferenceIntent(first, base, { ...base, bands: ["20m", "40m"], followRadio: false });
    expect(second).toEqual({ ...base, fontScale: 1.2, bands: ["20m", "40m"], followRadio: false });
  });

  it("recognizes a matching authoritative projection without depending on object identity", () => {
    expect(sameBandMapPreferences(base, { ...base, bands: ["20m"], modes: ["cw", "data", "phone"] })).toBe(true);
    expect(sameBandMapPreferences(base, { ...base, modes: ["cw"] })).toBe(false);
  });
});
