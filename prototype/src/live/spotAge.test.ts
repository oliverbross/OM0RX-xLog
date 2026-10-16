import { describe, expect, it } from "vitest";
import { formatSpotAge } from "./spotAge";

describe("cluster spot age", () => {
  const appleNow = 812_000_000;
  const now = (appleNow + 978_307_200) * 1000;

  it("uses compact live-age labels across useful cluster ranges", () => {
    expect(formatSpotAge(appleNow, now)).toBe("Now");
    expect(formatSpotAge(appleNow - 60, now)).toBe("1 min");
    expect(formatSpotAge(appleNow - 59 * 60, now)).toBe("59 min");
    expect(formatSpotAge(appleNow - 60 * 60, now)).toBe("1 h");
    expect(formatSpotAge(appleNow - 24 * 60 * 60, now)).toBe("1 d");
    expect(formatSpotAge(appleNow + 30, now)).toBe("Now");
    expect(formatSpotAge(Number.NaN, now)).toBe("—");
  });
});
