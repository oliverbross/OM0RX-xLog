// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNormalLoggingAccess } from "./normalLoggingAccess";
const api = vi.hoisted(() => ({ isTauri: vi.fn(), status: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: api.isTauri }));
vi.mock("../operatingModule", () => ({ operatingModuleStatus: api.status }));
beforeEach(() => { vi.resetAllMocks(); api.isTauri.mockReturnValue(true); });
afterEach(cleanup);
it("keeps native normal editing passive until Normal Logging is confirmed", async () => {
  let resolve!: (value: unknown) => void;
  api.status.mockReturnValue(new Promise(done => { resolve = done; }));
  const { result } = renderHook(useNormalLoggingAccess);
  expect(result.current.active).toBe(false);
  await act(async () => resolve({ selected: "normal_logging", transitioning: false }));
  expect(result.current.active).toBe(true);
});
it.each([{ selected: "contesting", transitioning: false }, { selected: "normal_logging", transitioning: true }])
  ("does not authorize normal editing for %j", async status => {
    api.status.mockResolvedValue(status);
    const { result } = renderHook(useNormalLoggingAccess);
    await act(async () => {});
    expect(result.current.active).toBe(false);
    expect(api.status).toHaveBeenCalledWith(true);
  });
it("retains the passive gate and explains unverified module authority", async () => {
  api.status.mockRejectedValue(new Error("Bridge unavailable"));
  const { result } = renderHook(useNormalLoggingAccess);
  await waitFor(() => expect(result.current.error).toContain("could not be verified"));
  expect(result.current.active).toBe(false);
});
it("leaves browser fixtures active without invoking native authority", () => {
  api.isTauri.mockReturnValue(false);
  const { result } = renderHook(useNormalLoggingAccess);
  expect(result.current.active).toBe(true);
  expect(api.status).not.toHaveBeenCalled();
});
