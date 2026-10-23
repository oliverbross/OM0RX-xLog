import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), native: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: () => bridge.native }));
import { invalidateOperatingModuleStatus, operatingModuleStatus, switchOperatingModule } from "./operatingModule";

beforeEach(() => { bridge.invoke.mockReset(); bridge.native = true; invalidateOperatingModuleStatus(); });

it("reads and caches the stable native operation context", async () => {
  const status = { selected: "normal_logging" as const, context: "context-a", transitioning: false };
  bridge.invoke.mockResolvedValueOnce(status);
  expect(await operatingModuleStatus(true)).toEqual(status);
  expect(await operatingModuleStatus()).toEqual(status);
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith("operating_module_status");
});

it("binds a module switch to the exact native context and invalidates the cache", async () => {
  const before = { selected: "normal_logging" as const, context: "context-a", transitioning: false };
  const after = { selected: "normal_logging" as const, context: "context-a", transitioning: true };
  const result = { status: "failed" as const, message: "Restart xLog.", servicesRetired: true };
  bridge.invoke.mockResolvedValueOnce(before).mockResolvedValueOnce(result).mockResolvedValueOnce(after);
  expect(await switchOperatingModule("contesting")).toEqual(result);
  expect(bridge.invoke).toHaveBeenNthCalledWith(2, "operating_module_switch", { target: "contesting", context: "context-a" });
  expect(await operatingModuleStatus()).toEqual(after);
  expect(bridge.invoke).toHaveBeenCalledTimes(3);
});

it("invalidates cached status when a native switch throws", async () => {
  const before = { selected: "normal_logging" as const, context: "context-a", transitioning: false };
  const after = { selected: "normal_logging" as const, context: "context-b", transitioning: false };
  bridge.invoke.mockResolvedValueOnce(before).mockRejectedValueOnce(new Error("bridge unavailable")).mockResolvedValueOnce(after);
  await expect(switchOperatingModule("contesting")).rejects.toThrow("bridge unavailable");
  expect(await operatingModuleStatus()).toEqual(after);
});

it("fails safely without invoking native commands in browser mode", async () => {
  bridge.native = false;
  expect(await operatingModuleStatus()).toEqual({ selected: "normal_logging", context: "browser", transitioning: false });
  expect(await switchOperatingModule("contesting")).toEqual({
    status: "rejected", message: "Operating modules can only be changed in the installed app.", servicesRetired: false,
  });
  expect(bridge.invoke).not.toHaveBeenCalled();
});
