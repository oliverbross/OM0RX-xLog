// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOwnRbn } from "./useOwnRbn";
import type { OwnRBNSpot } from "./hfPropagationModel";
const feed = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./ownRbnFeed", () => ({ loadOwnRBNPickups: feed.load }));
vi.mock("./useDocumentVisible", () => ({ useDocumentVisible: () => true }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("keeps disabled receiver inputs stable and restores current data on enable/context change without slowing refresh", async () => {
  vi.useFakeTimers(); feed.load.mockReset();
  const rows: OwnRBNSpot[] = []; feed.load.mockResolvedValue(rows);
  const { result, rerender, unmount } = renderHook(({ enabled, context }) => useOwnRbn("K1ABC", enabled, context), { initialProps: { enabled: false, context: "one" } });
  const empty = result.current.spots;
  rerender({ enabled: false, context: "two" }); expect(result.current.spots).toBe(empty);
  expect(feed.load).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  rerender({ enabled: true, context: "two" }); await act(async () => {});
  expect(result.current.spots).toBe(rows); expect(result.current.status).toBe("Current");
  expect(vi.getTimerCount()).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); }); expect(feed.load).toHaveBeenCalledTimes(2);
  rerender({ enabled: false, context: "two" }); expect(result.current.spots).toBe(empty); expect(vi.getTimerCount()).toBe(0);
  unmount();
});
