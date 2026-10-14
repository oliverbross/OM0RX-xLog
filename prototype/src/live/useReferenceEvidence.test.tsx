// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useReferenceEvidence } from "./useReferenceEvidence";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("verifies canonical refs read-only and discards late same-call results crossing draft/workspace/reference identity", async () => {
  vi.useFakeTimers(); let finish!: (value: any) => void;
  const request = vi.fn((_method: string, _params: any) => new Promise(resolve => { finish = resolve; }));
  const original = { id: "one", call: "TEST1", comment: "Portable", potaReference: "US-0001" };
  const view = renderHook(({ draft, generation }) => useReferenceEvidence(draft, generation, request), { initialProps: { draft: original, generation: "first" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(request).toHaveBeenCalledExactlyOnceWith("reference_resolve", { comment: "Portable", special_tags: ["POTA:US-0001"] });
  const first = finish; view.rerender({ draft: { ...original, id: "two", potaReference: "US-0002" }, generation: "second" });
  await act(async () => { first({ fields: { call: "MUST NOT WRITE" }, references: [{ kind: "pota", reference: "US-0001", status: "verified", name: "Old park" }] }); });
  expect(view.result.current).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  await act(async () => { finish({ fields: { potaReference: "MUST NOT WRITE" }, references: [{ kind: "pota", reference: "US-0002", status: "verified", name: "Current park" }] }); });
  expect(view.result.current).toMatchObject({ call: "TEST1", rows: [{ name: "Current park" }] });
  expect(original.potaReference).toBe("US-0001"); expect(request.mock.calls.every(([method]) => method === "reference_resolve")).toBe(true);
  view.rerender({ draft: { ...original, id: "two", potaReference: "US-0003" }, generation: "second" }); expect(view.result.current).toBeNull();
});
it("makes missing verification explicit without changing references or adopting disposed replies", async () => {
  vi.useFakeTimers(); const request = vi.fn().mockRejectedValue(new Error("directory unavailable"));
  const view = renderHook(() => useReferenceEvidence({ id: "one", call: "TEST1", sotaReference: "FL/VO-209" }, "workspace", request));
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(view.result.current?.error).toContain("Entered references are unchanged"); view.unmount();
});
