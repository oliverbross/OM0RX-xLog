import { describe, expect, it, vi } from "vitest";
import { CanonicalDraftFollower, CallsignLookupCache, intelligenceIdentity } from "./callsignIntelligenceContext";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
const snapshot = (call = "TEST1", generation = testWorkspaceGeneration, revision = 0) => ({ generation, revision,
  qso: { id: "fixture-draft", call, start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe("read-only canonical draft follower", () => {
  it("coalesces reads, accepts a new workspace without mutation and makes failures explicitly unavailable", async () => {
    const gate = deferred<any>(), read = vi.fn().mockReturnValueOnce(gate.promise).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ draft: snapshot("TEST2", crypto.randomUUID()) });
    const follower = new CanonicalDraftFollower(read); follower.activate();
    const first = follower.refresh(), second = follower.refresh(); expect(first).toBe(second);
    gate.resolve({ draft: snapshot() }); expect(await first).toBe(true); expect(read).toHaveBeenCalledOnce();
    await expect(follower.refresh()).rejects.toThrow("offline");
    expect(follower.getSnapshot()).toMatchObject({ available: false, error: "offline", snapshot: { qso: { call: "TEST1" } } });
    expect(await follower.refresh()).toBe(true); expect(follower.getSnapshot()).toMatchObject({ available: true, error: "", snapshot: { qso: { call: "TEST2" } } });
  });
  it("ignores a disposed read and can restart its lifecycle under Strict Mode", async () => {
    const old = deferred<any>(), next = deferred<any>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const follower = new CanonicalDraftFollower(read); follower.activate();
    const first = follower.refresh(); await Promise.resolve(); follower.dispose(); follower.activate();
    const second = follower.refresh(); await Promise.resolve();
    next.resolve({ draft: snapshot("NEW") }); expect(await second).toBe(true);
    old.resolve({ draft: snapshot("OLD") }); expect(await first).toBe(false);
    expect(follower.getSnapshot().snapshot?.qso.call).toBe("NEW"); follower.dispose();
    expect(await follower.refresh()).toBe(false); expect(read).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed and lower-revision snapshots instead of displaying old evidence", async () => {
    const read = vi.fn().mockResolvedValueOnce({ draft: snapshot("TEST1", testWorkspaceGeneration, 4) })
      .mockResolvedValueOnce({ draft: snapshot("OLD", testWorkspaceGeneration, 3) }).mockResolvedValueOnce({ draft: { revision: 9 } });
    const follower = new CanonicalDraftFollower(read); follower.activate(); await follower.refresh();
    await expect(follower.refresh()).rejects.toThrow("older"); expect(follower.getSnapshot().available).toBe(false);
    await expect(follower.refresh()).rejects.toThrow("verified");
  });
});

describe("generation and contact scoped lookup cache", () => {
  it("caches unchanged calls, coalesces requests, expires, and refreshes explicitly", async () => {
    let now = 0; const gate = deferred<any>(); const read = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue({ call: "TEST1", name: "Synthetic" });
    const cache = new CallsignLookupCache(read, () => now), key = intelligenceIdentity(snapshot());
    const first = cache.lookup(key, "TEST1"), same = cache.lookup(key, "TEST1"); expect(first).toBe(same);
    gate.resolve({ call: "TEST1", name: "Synthetic" }); await first;
    await cache.lookup(key, "TEST1"); expect(read).toHaveBeenCalledOnce();
    now = 300_001; await cache.lookup(key, "TEST1"); expect(read).toHaveBeenCalledTimes(2);
    cache.invalidate(key); await cache.lookup(key, "TEST1"); expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.every(([method]) => method === "lookup_call")).toBe(true);
  });
  it("does not reuse another workspace or draft identity and rejects mismatched profiles", async () => {
    const read = vi.fn().mockResolvedValue({ call: "TEST1", name: "Synthetic" });
    const cache = new CallsignLookupCache(read);
    await cache.lookup(intelligenceIdentity(snapshot()), "TEST1");
    await cache.lookup(intelligenceIdentity(snapshot("TEST1", crypto.randomUUID())), "TEST1");
    await cache.lookup(intelligenceIdentity({ ...snapshot(), qso: { ...snapshot().qso, id: "other-draft" } }), "TEST1");
    expect(read).toHaveBeenCalledTimes(3);
    read.mockResolvedValueOnce({ call: "OTHER", country: "Wrong country" });
    await expect(cache.lookup("different-key", "TEST1")).rejects.toThrow("does not match");
    await cache.lookup("different-key", "TEST1"); expect(read).toHaveBeenCalledTimes(5);
  });
  it("bounds retained profiles and never persists contact data", async () => {
    const read = vi.fn(async (_method, params) => ({ call: params.call })), cache = new CallsignLookupCache(read);
    for (let index = 0; index < 33; index++) await cache.lookup(`key-${index}`, `TEST${index}`);
    await cache.lookup("key-0", "TEST0"); expect(read).toHaveBeenCalledTimes(34);
  });
});
