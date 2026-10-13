// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ native: true, acceptance: false, request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => bridge.native }));
vi.mock("../worker", () => ({ workerRequest: bridge.request }));
vi.mock("../acceptance", () => ({ get acceptanceActive() { return bridge.acceptance; } }));
import { clusterSessionIntentKey, initializeNativeClusterResume } from "./clusterResume";

beforeEach(() => {
  bridge.native = true;
  bridge.acceptance = false;
  bridge.request.mockReset().mockImplementation(async (_method, params) => ({ ok: true, result: { resume_initialized: !!params.intent } }));
  localStorage.clear();
});
it.each([null, "connected", "disconnected"])("imports legacy %s only through the native initialization operation", async intent => {
  if (intent) localStorage.setItem(clusterSessionIntentKey, intent);
  await initializeNativeClusterResume();
  expect(bridge.request).toHaveBeenNthCalledWith(1, "cluster_resume_initialize", {});
  expect(bridge.request).toHaveBeenNthCalledWith(2, "cluster_resume_initialize", { intent: intent ?? "automatic" });
  expect(bridge.request).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(clusterSessionIntentKey)).toBe(intent);
});
it("never sends Connect from a renderer and leaves native failures visible", async () => {
  bridge.request.mockRejectedValue(new Error("busy"));
  await expect(initializeNativeClusterResume()).rejects.toThrow("busy");
  expect(bridge.request).toHaveBeenCalledOnce();
});
it("does not initialize native services from browser fixtures", async () => {
  bridge.native = false;
  await initializeNativeClusterResume();
  expect(bridge.request).not.toHaveBeenCalled();
});
it("does not migrate or start services in isolated native acceptance", async () => {
  bridge.acceptance = true;
  await initializeNativeClusterResume();
  expect(bridge.request).not.toHaveBeenCalled();
});
it("no longer depends on browser storage after native migration", async () => {
  bridge.request.mockResolvedValue({ ok: true, result: { resume_initialized: true } });
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  try { await initializeNativeClusterResume(); expect(read).not.toHaveBeenCalled(); }
  finally { read.mockRestore(); }
  expect(bridge.request).toHaveBeenCalledOnce();
});
it("does not replace an unreadable legacy Disconnect with automatic", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  try { await expect(initializeNativeClusterResume()).rejects.toThrow("could not be read"); }
  finally { read.mockRestore(); }
  expect(bridge.request).toHaveBeenCalledExactlyOnceWith("cluster_resume_initialize", {});
});
