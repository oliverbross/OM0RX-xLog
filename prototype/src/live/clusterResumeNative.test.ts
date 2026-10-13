// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
afterEach(() => vi.useRealTimers());
it("recovers from bounded native pre-transport contention without reading legacy storage", async () => {
  vi.useFakeTimers();
  const busy = "Cluster session is busy. Wait for the current action to finish.";
  bridge.request.mockRejectedValueOnce(busy).mockRejectedValueOnce(busy)
    .mockResolvedValue({ ok: true, result: { resume_initialized: true } });
  const read = vi.spyOn(Storage.prototype, "getItem");
  try {
    const completed = initializeNativeClusterResume().then(() => ({ ok: true }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(200);
    expect(await completed).toEqual({ ok: true });
    expect(bridge.request).toHaveBeenCalledTimes(3);
    expect(bridge.request.mock.calls.every(([method, params]) => method === "cluster_resume_initialize" && Object.keys(params).length === 0)).toBe(true);
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});
it("bounds native busy retries and never guesses a legacy reconnect intent after exhaustion", async () => {
  vi.useFakeTimers();
  bridge.request.mockRejectedValue("Cluster session is busy. Wait for the current action to finish.");
  const read = vi.spyOn(Storage.prototype, "getItem");
  try {
    const completed = initializeNativeClusterResume().catch(cause => cause);
    await vi.advanceTimersByTimeAsync(200);
    expect(await completed).toBeInstanceOf(Error);
    expect((await completed).message).toContain("still busy");
    expect(bridge.request).toHaveBeenCalledTimes(3);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.request).toHaveBeenCalledTimes(3);
  } finally { read.mockRestore(); }
});
it("retries only a rejected-before-transport legacy import and preserves Disconnect", async () => {
  vi.useFakeTimers(); localStorage.setItem(clusterSessionIntentKey, "disconnected");
  bridge.request.mockResolvedValueOnce({ ok: true, result: { resume_initialized: false } })
    .mockRejectedValueOnce("Cluster session is busy. Wait for the current action to finish.")
    .mockResolvedValueOnce({ ok: true, result: { resume_initialized: true } });
  const completed = initializeNativeClusterResume().then(() => ({ ok: true }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(50);
  expect(await completed).toEqual({ ok: true });
  expect(bridge.request.mock.calls).toEqual([
    ["cluster_resume_initialize", {}],
    ["cluster_resume_initialize", { intent: "disconnected" }],
    ["cluster_resume_initialize", { intent: "disconnected" }],
  ]);
  expect(localStorage.getItem(clusterSessionIntentKey)).toBe("disconnected");
});
it.each([
  new Error("Cluster session is busy. Wait for the current action to finish."),
  new Error("Persistent migration failure"),
  "Station service timed out; outcome unknown",
])("does not retry worker errors or uncertain native failures: %s", async cause => {
  bridge.request.mockRejectedValue(cause);
  await expect(initializeNativeClusterResume()).rejects.toThrow(cause instanceof Error ? cause.message : cause);
  expect(bridge.request).toHaveBeenCalledOnce();
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
