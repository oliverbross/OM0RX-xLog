import { describe, expect, it } from "vitest";
import { countryDisplay } from "./countryDisplay";

describe("countryDisplay", () => {
  it.each([
    ["UNITED STATES", "United States"],
    ["RODRIGUES IS.", "Rodrigues Is."],
    ["CANARY ISLANDS", "Canary Islands"],
    ["CÔTE D'IVOIRE", "Côte d'Ivoire"],
    ["BONAIRE, SINT EUSTATIUS AND SABA", "Bonaire, Sint Eustatius and Saba"],
    ["SOUTH GEORGIA & THE SOUTH SANDWICH ISLANDS", "South Georgia & the South Sandwich Islands"],
  ])("formats %s for display", (source, expected) => expect(countryDisplay(source)).toBe(expected));

  it("does not mutate the stored source value", () => {
    const stored = "UNITED STATES";
    countryDisplay(stored);
    expect(stored).toBe("UNITED STATES");
  });
});
