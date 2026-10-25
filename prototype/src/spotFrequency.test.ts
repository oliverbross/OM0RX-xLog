import { expect, it } from "vitest";
import { formatSpotFrequency } from "./spotFrequency";
it.each([[7_150_300, "7.150.3"], [14_234_400, "14.234.4"], [7_119_100, "7.119.1"],
  [7_150_000, "7.150.0"], [7_150_349, "7.150.3"], [7_150_350, "7.150.4"],
  [9_999_950, "10.000.0"], [1_850_000, "1.850.0"], [50_100_000, "50.100.0"],
  [0, "—"], [NaN, "—"], [Infinity, "—"]])("formats %s to %s without changing the value", (hz, label) => {
  expect(formatSpotFrequency(hz as number)).toBe(label);
});
