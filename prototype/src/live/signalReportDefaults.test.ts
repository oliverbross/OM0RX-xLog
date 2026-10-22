import { describe, expect, it } from "vitest";
import { applyModeSignalReportDefaults } from "./signalReportDefaults";

describe("mode signal report defaults", () => {
  it("switches conventional voice reports to CW defaults", () => {
    expect(applyModeSignalReportDefaults({ mode: "SSB", rstSent: "59", rstReceived: "59" }, "CW"))
      .toMatchObject({ mode: "CW", rstSent: "599", rstReceived: "599" });
  });

  it("switches conventional CW reports to SSB defaults", () => {
    expect(applyModeSignalReportDefaults({ mode: "CW", rstSent: "599", rstReceived: "599" }, "SSB"))
      .toMatchObject({ mode: "SSB", rstSent: "59", rstReceived: "59" });
  });

  it("preserves reports edited by the operator", () => {
    expect(applyModeSignalReportDefaults({ mode: "SSB", rstSent: "58", rstReceived: "57" }, "CW"))
      .toMatchObject({ mode: "CW", rstSent: "58", rstReceived: "57" });
  });

  it("clears an incompatible historical submode on an explicit parent-mode change", () => {
    expect(applyModeSignalReportDefaults({ mode: "MFSK", submode: "FT4", rstSent: "-10", rstReceived: "-12" }, "SSB"))
      .toMatchObject({ mode: "SSB", submode: "", rstSent: "-10", rstReceived: "-12" });
  });

  it("retains an intentionally selected submode when the parent mode is unchanged", () => {
    expect(applyModeSignalReportDefaults({ mode: "MFSK", submode: "FT4" }, "MFSK"))
      .toMatchObject({ mode: "MFSK", submode: "FT4" });
  });
});
