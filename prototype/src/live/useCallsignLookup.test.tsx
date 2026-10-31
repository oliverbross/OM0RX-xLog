// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCallsignLookup } from "./useCallsignLookup";
import { enrichedDraft } from "./draftEnrichment";
const draft = { id: "draft-a", call: "FW3GT", name: "", country: "", dxcc: null };
const profile = { call: "FW3GT", name: "Provider", country: "Wallis", dxcc: 298, source: "QRZ" };
const defer = () => { let resolve!: (value: any) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(["generation", "draft"])("retires an old same-call %s lookup and never joins its in-flight promise", async changed => {
  const first = defer(), second = defer(), lookup = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const request = vi.fn((method: string) => method === "lookup_call" ? lookup() : Promise.resolve({ qsos: [] }));
  const enrich = vi.fn();
  const view = renderHook(({ qso, generation }) => useCallsignLookup({ draft: qso, generation, workspaceExists: true, request, canEnrich: () => true, enrich }),
    { initialProps: { qso: draft, generation: "generation-a" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  view.rerender({ qso: changed === "draft" ? { ...draft, id: "draft-b" } : draft, generation: changed === "generation" ? "generation-b" : "generation-a" });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(lookup).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve(profile); await Promise.resolve(); });
  expect(view.result.current.lookup?.name).toBe("Provider");
  await act(async () => { first.resolve({ ...profile, name: "Stale old workspace" }); await Promise.resolve(); });
  expect(view.result.current.lookup?.name).toBe("Provider");
  expect(enrich).toHaveBeenCalledTimes(1);
});

it("preserves manual edits made while an automatic lookup is in flight", async () => {
  const pending = defer(); let current = { ...draft };
  const enrich = vi.fn((baseline, info) => { current = enrichedDraft(current, baseline, info)! as typeof current; });
  const request = vi.fn((method: string) => method === "lookup_call" ? pending.promise : Promise.resolve({ qsos: [] }));
  const view = renderHook(({ qso }) => useCallsignLookup({ draft: qso, generation: "a", workspaceExists: true, request, canEnrich: () => true, enrich }), { initialProps: { qso: current } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  current = { ...current, name: "Manual operator", country: "Manual country" }; view.rerender({ qso: current });
  await act(async () => { pending.resolve(profile); await Promise.resolve(); });
  expect(enrich).toHaveBeenCalledTimes(1);
  expect(current.name).toBe("Manual operator"); expect(current.country).toBe("Manual country");
});

it("offers a fresh read-only retry after exhaustion without overwriting fields entered before the click", async () => {
  const lookup = vi.fn().mockRejectedValue(Object.assign(new Error("Busy"), { code: "worker_busy" }));
  const request = vi.fn((method: string) => method === "lookup_call" ? lookup() : Promise.resolve({ qsos: [] }));
  const enrich = vi.fn();
  const view = renderHook(({ qso }) => useCallsignLookup({ draft: qso, generation: "a", workspaceExists: true, request, canEnrich: () => true, enrich }), { initialProps: { qso: draft } });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(lookup).toHaveBeenCalledTimes(9); expect(view.result.current.lookup?.lookup_error).toBe(true);
  const manual = { ...draft, country: "Manual before retry", name: "Manual name" };
  view.rerender({ qso: manual }); lookup.mockResolvedValue(profile);
  act(() => view.result.current.retryLookup());
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(view.result.current.lookup?.name).toBe("Provider");
  expect(enrich).not.toHaveBeenCalled(); expect(manual.country).toBe("Manual before retry");
  expect(request.mock.calls.every(([method]) => ["lookup_call", "logbook_previous"].includes(method))).toBe(true);
});

it("cancels all future retries when the main surface is unmounted", async () => {
  const lookup = vi.fn().mockRejectedValue(new Error("Prototype worker is busy; try again"));
  const request = vi.fn((method: string) => method === "lookup_call" ? lookup() : Promise.resolve({ qsos: [] }));
  const view = renderHook(() => useCallsignLookup({ draft, generation: "a", workspaceExists: true, request, canEnrich: () => true, enrich: vi.fn() }));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); }); view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(lookup).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
