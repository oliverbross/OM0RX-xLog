import { beforeEach, describe, expect, it, vi } from "vitest";
import { openContestSurfaceWindow, type ContestSurfaceContext } from "./contestSurfaceNative";
import type { ContestSurfacePanelID } from "./contestSurfaceProtocol";

const native = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const context: ContestSurfaceContext = {
  operatingContext: "10000000-0000-4000-8000-000000000001",
  sessionID: "10000000-0000-4000-8000-000000000002",
  workspaceGeneration: "10000000-0000-4000-8000-000000000003",
};

describe("Contest shared service windows", () => {
  beforeEach(() => { native.invoke.mockReset(); native.tauri = true; });
  it.each(["qrz-details", "band-maps", "dx-cluster", "rotor", "station-control"] as const)(
    "opens %s through contest context admission", async panelID => {
      await openContestSurfaceWindow(context, panelID);
      expect(native.invoke).toHaveBeenCalledExactlyOnceWith("contest_window_open", { ...context, panelID });
    });
  it("rejects unverified contexts before invoking shared service routing", async () => {
    await expect(openContestSurfaceWindow({ ...context, sessionID: "expired" }, "rotor")).rejects.toThrow("verified");
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it("rejects unrelated windows and browser-only requests", async () => {
    await expect(openContestSurfaceWindow(context, "cw" as ContestSurfacePanelID)).rejects.toThrow("verified");
    native.tauri = false;
    await expect(openContestSurfaceWindow(context, "station-control")).rejects.toThrow("native application");
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
