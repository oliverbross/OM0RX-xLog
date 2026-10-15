import { beforeEach, expect, it, vi } from "vitest";
import { nativeRotorStop } from "./nativeRotorStop";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
beforeEach(() => { vi.resetAllMocks(); });

it("dispatches exactly one owner-scoped Stop without any device snapshot or generation prerequisite", async () => {
  const result = { owner: "native_dcu1", generation: 92, state: "active" };
  bridge.invoke.mockResolvedValue({ ok: true, result });
  await expect(nativeRotorStop("native_dcu1")).resolves.toBe(result);
  expect(bridge.invoke.mock.calls).toEqual([["monitor_rotor_stop", { owner: "native_dcu1" }]]);
});

it("preserves an uncertain lost reply and never retries or reads the device", async () => {
  bridge.invoke.mockRejectedValue(new Error("Stop acknowledgement lost"));
  await expect(nativeRotorStop("hamlib")).rejects.toThrow("Stop acknowledgement lost");
  expect(bridge.invoke.mock.calls).toEqual([["monitor_rotor_stop", { owner: "hamlib" }]]);
});

it.each([
  { ok: false, error: { message: "Owner changed" } },
  { ok: true, result: { owner: "hamlib", generation: 93, state: "active" } },
  { ok: true, result: { owner: "native_dcu1", generation: -1, state: "active" } },
])("does not confirm Stop from a rejected, changed-owner or malformed acknowledgement", async reply => {
  bridge.invoke.mockResolvedValue(reply);
  await expect(nativeRotorStop("native_dcu1")).rejects.toThrow();
  expect(bridge.invoke).toHaveBeenCalledOnce();
});
