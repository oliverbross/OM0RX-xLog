import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
import { verifyBandMapContext } from "./bandMapWindowAcceptance";
import { syntheticMapContext } from "./live/mapContextFixtures";

function context(scale = 1.2): any {
  const value = syntheticMapContext();
  return { ...value, acceptance: { synthetic: true, source: "isolated_local_worker", externalOwners: false },
    metadata: { ...value.metadata, preferences: { ...value.metadata.preferences, bandMapFontScale: scale } },
    cluster: { revision: 0, received_at_ms: Date.now(), response: { snapshot: { spots: [] } }, available: true, selected: null },
    selection: { provider: null }, radio: { available: false, provider: null, snapshot: null } };
}
beforeEach(() => { bridge.invoke.mockReset(); });
it("verifies a focused map fixture independently from workspace toolbar scale", async () => {
  bridge.invoke.mockResolvedValue(context(1.7));
  await expect(verifyBandMapContext(null, true)).resolves.toMatchObject({ synthetic: true, externalOwners: false });
  expect(bridge.invoke).toHaveBeenCalledOnce();
});
afterEach(() => { vi.useRealTimers(); });
it("requires native fixture provenance and durable scale matching the actual rendered control", async () => {
  const value = context(); bridge.invoke.mockResolvedValue(value);
  await expect(verifyBandMapContext("120%")).resolves.toEqual({ synthetic: true, source: "isolated_local_worker", externalOwners: false,
    generation: value.metadata.generation, revision: value.metadata.revision, scale: "120%" });
  expect(bridge.invoke.mock.calls).toEqual([["map_context_snapshot"]]);
});
it.each(["missing-marker", "external-owners", "live-provider", "live-radio", "populated-feed", "invalid-generation", "stale-fixture"])("rejects %s rather than treating it as isolated evidence", async kind => {
  const value = context();
  if (kind === "missing-marker") delete value.acceptance;
  if (kind === "external-owners") value.acceptance.externalOwners = true;
  if (kind === "live-provider") value.selection.provider = "direct_agent";
  if (kind === "live-radio") value.radio.available = true;
  if (kind === "populated-feed") value.cluster.response.snapshot.spots = [{ id: "external" }];
  if (kind === "invalid-generation") value.metadata.generation = "unverified";
  if (kind === "stale-fixture") value.cluster.received_at_ms = Date.now() - 6000;
  bridge.invoke.mockResolvedValue(value);
  await expect(verifyBandMapContext("120%")).rejects.toThrow("without external owners");
});
it("waits for the private preference acknowledgement, not just an optimistic scale", async () => {
  vi.useFakeTimers(); bridge.invoke.mockResolvedValueOnce(context(1.1)).mockResolvedValueOnce(context(1.2));
  const verified = verifyBandMapContext("120%");
  await vi.advanceTimersByTimeAsync(50);
  await expect(verified).resolves.toMatchObject({ scale: "120%" });
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it("fails boundedly when the rendered preference is never acknowledged", async () => {
  vi.useFakeTimers(); bridge.invoke.mockImplementation(async () => context(1.1));
  const pending = expect(verifyBandMapContext("120%")).rejects.toThrow("not durably acknowledged");
  await vi.advanceTimersByTimeAsync(15_000); await pending;
  expect(bridge.invoke.mock.calls.every(([method]) => method === "map_context_snapshot")).toBe(true);
});
