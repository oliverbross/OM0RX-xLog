import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), native: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: () => bridge.native }));
import { contestRetirementAssessment, operatingModuleStatus, switchOperatingModule } from "./operatingModule";

beforeEach(() => bridge.invoke.mockReset());

it("binds a module switch to the exact native operating context", async () => {
  const status = { selected: "normal_logging" as const, context: "context-a", transitioning: false };
  const refusal = { status: "rejected", message: "Close the Log QSO window.", servicesRetired: false };
  bridge.invoke.mockResolvedValueOnce(status).mockResolvedValueOnce(refusal);
  expect(await operatingModuleStatus(true)).toEqual(status);
  expect(await switchOperatingModule("contesting")).toEqual(refusal);
  expect(bridge.invoke).toHaveBeenLastCalledWith("operating_module_switch", { target: "contesting", context: "context-a" });
});

it("waits for a live contest owner but permits unavailable-runtime return without deleting durable recovery", () => {
  expect(contestRetirementAssessment("available", true, true)).toBe("prepare");
  expect(contestRetirementAssessment("available", true, false)).toBe("wait");
  expect(contestRetirementAssessment("unavailable", true, false)).toBe("preserve_durable_recovery");
  expect(contestRetirementAssessment("checking", false, false)).toBe("preserve_durable_recovery");
});
