// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clusterAppearanceKey, readClusterAppearance, useClusterAppearancePreference } from "./clusterAppearance";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("defaults to Modern for missing, invalid and unavailable storage", () => {
  expect(readClusterAppearance()).toBe("modern");
  localStorage.setItem(clusterAppearanceKey, "classic");
  expect(readClusterAppearance()).toBe("classic");
  localStorage.setItem(clusterAppearanceKey, "unknown");
  expect(readClusterAppearance()).toBe("modern");
  expect(readClusterAppearance({ getItem() { throw new Error("restricted"); } })).toBe("modern");
});

it("updates other mounted views, persists across remounts and returns to Modern", () => {
  const first = renderHook(useClusterAppearancePreference), second = renderHook(useClusterAppearancePreference);
  act(() => first.result.current.save("classic"));
  expect(second.result.current.appearance).toBe("classic");
  first.unmount();
  const reopened = renderHook(useClusterAppearancePreference);
  expect(reopened.result.current.appearance).toBe("classic");
  act(() => reopened.result.current.save("modern"));
  expect(second.result.current.appearance).toBe("modern");
});

it("receives other-window storage changes and resets after storage is cleared", () => {
  const hook = renderHook(useClusterAppearancePreference);
  act(() => {
    localStorage.setItem(clusterAppearanceKey, "classic");
    window.dispatchEvent(new StorageEvent("storage", { key: clusterAppearanceKey }));
  });
  expect(hook.result.current.appearance).toBe("classic");
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(hook.result.current.appearance).toBe("modern");
});

it("retains the active choice when saving fails and allows retry", () => {
  const hook = renderHook(useClusterAppearancePreference);
  const store = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
  act(() => hook.result.current.save("classic"));
  expect(hook.result.current.appearance).toBe("modern");
  expect(hook.result.current.error).toContain("try again");
  store.mockRestore();
  act(() => hook.result.current.save("classic"));
  expect(hook.result.current.appearance).toBe("classic");
  expect(hook.result.current.error).toBe("");
});
