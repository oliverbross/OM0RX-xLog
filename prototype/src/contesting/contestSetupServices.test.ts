import { beforeEach, expect, it, vi } from "vitest";
import { openContestSetupService } from "./contestSetupServices";
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => {}), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
beforeEach(() => { native.invoke.mockClear(); native.isTauri.mockReturnValue(true); });

it("passes only the requested service name to the native settings owner", async () => {
  for (const service of ["Station", "QRZ", "Radio", "CW", "Cluster", "Integrations", "Rotator"] as const) {
    await openContestSetupService(service);
    expect(native.invoke).toHaveBeenLastCalledWith("contest_setup_service_open", { service });
  }
});

it("refuses browser-only settings navigation and propagates native refusal", async () => {
  native.isTauri.mockReturnValue(false);
  await expect(openContestSetupService("Rotator")).rejects.toThrow("native application");
  expect(native.invoke).not.toHaveBeenCalled();
  native.isTauri.mockReturnValue(true); native.invoke.mockRejectedValueOnce(new Error("Owner refused"));
  await expect(openContestSetupService("CW")).rejects.toThrow("Owner refused");
});
