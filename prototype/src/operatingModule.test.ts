import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), native: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: () => bridge.native }));
import { operatingModuleStatus } from "./operatingModule";

beforeEach(() => bridge.invoke.mockReset());

it("reads the stable native operation context without exposing a module switch", async () => {
  const status = { selected: "normal_logging" as const, context: "context-a", transitioning: false };
  bridge.invoke.mockResolvedValueOnce(status);
  expect(await operatingModuleStatus(true)).toEqual(status);
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith("operating_module_status");
});
