// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSpotEditor } from "./useSpotEditor";
const api = vi.hoisted(() => ({ reconcile: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./spotEditorRegistration", () => ({ connectSpotEditor: () => api }));
beforeEach(() => { api.reconcile.mockReset(); api.dispose.mockResolvedValue(undefined); });
afterEach(cleanup);
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
