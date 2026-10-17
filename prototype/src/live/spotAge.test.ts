import { describe, expect, it } from "vitest";
import { formatSpotAge, spotAgeColor } from "./spotAge";

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

  it("moves continuously from green through amber and orange to capped red", () => {
    expect(spotAgeColor(appleNow, now)).toBe("#166534");
    expect(spotAgeColor(appleNow - 5 * 60, now)).toBe("#4d7c0f");
    expect(spotAgeColor(appleNow - 15 * 60, now)).toBe("#854d0e");
    expect(spotAgeColor(appleNow - 30 * 60, now)).toBe("#9a3412");
    expect(spotAgeColor(appleNow - 60 * 60, now)).toBe("#991b1b");
    expect(spotAgeColor(appleNow - 24 * 60 * 60, now)).toBe("#991b1b");
    expect(spotAgeColor(Number.NaN, now)).toBe("#334155");
  });

  it("keeps white age text at WCAG AA contrast throughout the ramp", () => {
    const luminance = (hex: string) => hex.match(/\w\w/g)!.map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance("ffffff");
    for (let seconds = 0; seconds <= 60 * 60; seconds += 15) {
      const background = luminance(spotAgeColor(appleNow - seconds, now).slice(1));
      expect((foreground + 0.05) / (background + 0.05), `${seconds}s`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
