// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSpotEditor } from "./useSpotEditor";
const api = vi.hoisted(() => ({ reconcile: vi.fn(), dispose: vi.fn(), changed: null as any, failed: null as any }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./spotEditorRegistration", () => ({ connectSpotEditor: (_members: unknown, _ready: unknown, changed: unknown, failed: unknown) => {
  api.changed = changed; api.failed = failed; return api;
} }));
beforeEach(() => { api.reconcile.mockReset(); api.dispose.mockResolvedValue(undefined); });
afterEach(cleanup);
it("retains an unchanged validated idle display but publishes registration recovery and nonidle observations", async () => {
  const { result, unmount } = renderHook(() => useSpotEditor([], () => ({ ready: true })));
  const idle = () => ({ operationId: null, phase: "idle", barrier: null });
  act(() => api.changed(idle())); const first = result.current.status;
  act(() => api.changed(idle())); expect(result.current.status).toBe(first);
  act(() => api.failed("Registration unavailable")); expect(result.current.initializing).toBe(true);
  act(() => api.changed(idle())); expect(result.current.initializing).toBe(false); expect(result.current.error).toBe("");
  const preparing = { operationId: "00000000-0000-4000-8000-000000000001", phase: "preparing", barrier: null };
  act(() => api.changed(preparing)); expect(result.current.status).toBe(preparing);
  const next = { ...preparing }; act(() => api.changed(next)); expect(result.current.status).toBe(next);
  act(() => api.changed(idle())); expect(result.current.status?.phase).toBe("idle");
  unmount(); act(() => api.changed(preparing)); expect(result.current.status?.phase).toBe("idle");
});
it("exposes failed reconciliation while retaining the hook error", async () => {
  api.reconcile.mockRejectedValue(new Error("Canonical draft unavailable"));
  const { result } = renderHook(() => useSpotEditor([], () => ({ ready: true })));
  let settled = true;
  await act(async () => { settled = await result.current.reconcile(); });
  expect(settled).toBe(false); expect(result.current.error).toBe("Canonical draft unavailable");
});
it("returns only the explicit registered-editor success result", async () => {
  const { result } = renderHook(() => useSpotEditor([], () => ({ ready: true })));
  api.reconcile.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await result.current.reconcile()).toBe(false);
  expect(await result.current.reconcile()).toBe(true);
});
