// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { connectMonitorTarget } from "./monitorTarget";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
afterEach(() => vi.restoreAllMocks());
const draft = () => ({ generation: testWorkspaceGeneration, revision: 0, qso: { id: "synthetic-draft", call: "TEST1", band: "20m", mode: "CW" } });
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
it("reads only canonical draft and matched lookup, caching unchanged periodic draft reads", async () => {
  let refresh!: () => Promise<void | boolean>;
  const request = vi.fn(async (method: string) => method === "logbook_operator_draft" ? { draft: draft() } : { call: "TEST1", latitude: 48, longitude: 17, source: "Synthetic" });
  const changed = vi.fn(), failed = vi.fn(), stop = vi.fn();
  const connection = connectMonitorTarget(changed, failed, request, read => { refresh = read; void read(); return stop; });
  await settle(); for (let index = 0; index < 3; index++) await refresh(); await settle();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ generation: testWorkspaceGeneration, call: "TEST1", lat: 48, lon: 17 }));
  expect(request.mock.calls.filter(([method]) => method === "lookup_call")).toHaveLength(1);
  expect(request.mock.calls.every(([method]) => ["lookup_call", "logbook_operator_draft"].includes(method))).toBe(true);
  connection.dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("discards old workspace/call lookups and disposed results without claiming another draft's target", async () => {
  let current = draft(), refresh!: () => Promise<void | boolean>, resolve!: (value: unknown) => void;
  const request = vi.fn(async (method: string, params: any) => method === "logbook_operator_draft" ? { draft: structuredClone(current) }
    : params.call === "TEST1" ? await new Promise(done => { resolve = done; }) : { call: params.call, latitude: 10, longitude: 20 });
  const changed = vi.fn(); const connection = connectMonitorTarget(changed, vi.fn(), request, read => { refresh = read; void read(); return vi.fn(); });
  await settle(); current = { ...current, generation: crypto.randomUUID(), qso: { ...current.qso, call: "TEST2" } };
  await refresh(); await settle(); resolve({ call: "TEST1", latitude: 50, longitude: 60 }); await settle();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ call: "TEST2", lat: 10 }));
  expect(changed.mock.calls.some(([value]) => value?.call === "TEST1")).toBe(false);
  connection.dispose(); await refresh(); expect(changed).toHaveBeenCalledTimes(3);
});
