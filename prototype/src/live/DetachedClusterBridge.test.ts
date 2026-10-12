import { describe, expect, it } from "vitest";
import { newerClusterProjection, validClusterProjection, validClusterRequest, validClusterResponse } from "./DetachedClusterBridge";

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
    const projection = { revision: 2, selected: "spot-1", response: { snapshot: { spots: [{ id: "spot-1" }] } } };
    expect(validClusterProjection(projection)).toBe(true);
    expect(validClusterProjection({ ...projection, revision: -1 })).toBe(false);
    expect(validClusterProjection({ ...projection, response: { snapshot: { spots: "fake" } } })).toBe(false);
    expect(validClusterProjection({ ...projection, selected: {} })).toBe(false);
    expect(newerClusterProjection(projection, { ...projection, revision: 1, selected: null })).toBe(projection);
    expect(newerClusterProjection(projection, { ...projection, revision: 3 }).revision).toBe(3);
  });
  it("correlates responses to bounded IDs", () => {
    expect(validClusterResponse({ id: "12345678-abcd", ok: true, result: { snapshot: { spots: [] } } })).toBe(true);
    expect(validClusterResponse({ id: "bad", ok: true, result: {} })).toBe(false);
    expect(validClusterResponse({ id: "12345678-abcd", ok: false, error: "Try again" })).toBe(true);
  });
});
