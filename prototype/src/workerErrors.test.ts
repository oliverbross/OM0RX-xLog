import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: api.invoke }));
import { workerRequest } from "./worker";
beforeEach(() => api.invoke.mockReset());
it.each(["worker_busy", "credential_required"])("preserves native %s for read-specific retry classification", async code => {
  api.invoke.mockImplementation(async (command: string) => command === "operating_module_status" ? { context: "normal" }
    : { id: "fixture", ok: false, error: { code, message: "Native detail" } });
  await expect(workerRequest("lookup_call", { call: "FW3GT" })).rejects.toMatchObject({ code, message: "Native detail" });
});
