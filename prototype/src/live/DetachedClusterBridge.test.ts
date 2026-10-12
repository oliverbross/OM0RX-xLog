import { describe, expect, it, vi } from "vitest";
import { newerClusterProjection, requestViaSession, validClusterProjection, validClusterRequest, validClusterResponse } from "./DetachedClusterBridge";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));

describe("detached DX Cluster boundary", () => {
  const request = { id: "12345678-abcd", method: "cluster_filter", params: { filter: { query: "EA" } } };
  it("permits only bounded cluster requests and excludes Keychain operations", () => {
    expect(validClusterRequest(request)).toBe(true);
    expect(validClusterRequest({ ...request, method: "cluster_password_set", params: { password: "secret" } })).toBe(false);
    expect(validClusterRequest({ ...request, method: "station_tune" })).toBe(false);
    expect(validClusterRequest({ ...request, params: "not-an-object" })).toBe(false);
    expect(validClusterRequest({ ...request, params: { command: "x".repeat(40_000) } })).toBe(false);
  });
  it("accepts revisioned real-snapshot projections but rejects malformed state", () => {
    const projection = { revision: 2, selected: "spot-1", available: true, response: { snapshot: { spots: [{ id: "spot-1" }] } } };
    expect(validClusterProjection(projection)).toBe(true);
    expect(validClusterProjection({ ...projection, revision: -1 })).toBe(false);
    expect(validClusterProjection({ ...projection, response: { snapshot: { spots: "fake" } } })).toBe(false);
    expect(validClusterProjection({ ...projection, selected: {} })).toBe(false);
    expect(validClusterProjection({ ...projection, response: null })).toBe(false);
    expect(validClusterProjection({ ...projection, available: false, response: null })).toBe(true);
    expect(newerClusterProjection(projection, { ...projection, revision: 1, selected: null })).toBe(projection);
    expect(newerClusterProjection(projection, { ...projection, revision: 3 }).revision).toBe(3);
  });
  it("correlates responses to bounded IDs", () => {
    expect(validClusterResponse({ id: "12345678-abcd", ok: true, result: { snapshot: { spots: [] } } })).toBe(true);
    expect(validClusterResponse({ id: "bad", ok: true, result: {} })).toBe(false);
    expect(validClusterResponse({ id: "12345678-abcd", ok: false, error: { message: "Try again" } })).toBe(true);
  });
  it("calls the native session directly without a main-window ticket or event listener", async () => {
    native.invoke.mockReset().mockImplementation(async (_command, { request }) => ({ id: request.id, ok: true, result: { snapshot: { spots: [] } } }));
    expect(await requestViaSession("cluster_filter", { filter: { query: "EA" } })).toEqual({ snapshot: { spots: [] } });
    expect(native.invoke).toHaveBeenCalledOnce();
    expect(native.invoke.mock.calls[0][0]).toBe("worker_request");
    await expect(requestViaSession("station_tune")).rejects.toThrow("unavailable");
    expect(native.invoke).toHaveBeenCalledOnce();
  });
  it("does not retry lost or mismatched responses", async () => {
    native.invoke.mockReset().mockRejectedValue(new Error("delivery unknown"));
    await expect(requestViaSession("cluster_command", { command: "sh/dx" })).rejects.toThrow("delivery unknown");
    expect(native.invoke).toHaveBeenCalledOnce();
    native.invoke.mockReset().mockResolvedValue({ id: "wrong-12345678", ok: true, result: {} });
    await expect(requestViaSession("cluster_snapshot")).rejects.toThrow("could not be verified");
    expect(native.invoke).toHaveBeenCalledOnce();
  });
});
