// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSharedCW } from "./useSharedCW";
import { defaultCWProfile } from "./cwMacros";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); invoke.mockReset(); });

it("measures shared CW idle, hidden, suspended, holder and shutdown dispatches", async () => {
  vi.useFakeTimers();
  let visible = true, armed = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  invoke.mockImplementation(async (_command, { client, params }) => {
    if (params.action === "arm") armed = true;
    if (params.action === "unregister" || params.action === "stop") armed = false;
    return { revision: 1, armed, pending: false, owner: null, client: armed ? client : null,
      lease: armed ? "lease" : null, error: "", canonical: { profile: defaultCWProfile } };
  });
  let controller: ReturnType<typeof useSharedCW>["controller"];
  function Harness({ suspended = false, native = false }) {
    controller = useSharedCW("fixture", suspended, native).controller;
    return null;
  }
  const counts: Record<string, number> = {};
  const snapshots = () => invoke.mock.calls.filter(call => call[1].params.action === "snapshot").length;
  const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); };
  const { rerender, unmount } = render(<Harness />);
  await act(async () => {}); await advance(); counts.visibleDisarmed = snapshots();
  let start = snapshots(); visible = false;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await advance(); counts.hiddenDisarmed = snapshots() - start;
  expect(vi.getTimerCount()).toBe(0);
  start = snapshots(); rerender(<Harness suspended />); await advance(); counts.suspended = snapshots() - start;
  expect(vi.getTimerCount()).toBe(0);
  start = snapshots();
  visible = true; rerender(<Harness native />);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(snapshots()).toBe(start + 1);
  await act(async () => { await controller!.arm(); });
  start = snapshots(); await advance(); counts.activeHolder = snapshots() - start;
  visible = false;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  start = snapshots(); await advance(); counts.hiddenNativeHolder = snapshots() - start;
  start = snapshots(); unmount(); await advance(); counts.shutdown = snapshots() - start;
  expect(vi.getTimerCount()).toBe(0);
  console.log("CW_POLLING_30_SECONDS", JSON.stringify(counts));
  expect(counts.visibleDisarmed).toBe(41);
  expect(counts.hiddenDisarmed).toBe(0);
  expect(counts.suspended).toBe(0);
  expect(counts.activeHolder).toBe(40);
  expect(counts.hiddenNativeHolder).toBe(40);
  expect(counts.shutdown).toBe(0);
});

it("does not revive a timer when an in-flight snapshot finishes after shutdown", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({});
  function Harness() { useSharedCW("fixture"); return null; }
  const { unmount } = render(<Harness />);
  unmount();
  await act(async () => {
    finish({ revision: 1, armed: false, pending: false, error: "" });
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(invoke.mock.calls.map(call => call[1].params.action)).toEqual(["snapshot", "unregister"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps snapshot deadlines during 500ms context changes and arms from the fresh revision", async () => {
  vi.useFakeTimers();
  let canonicalRevision = 0, observedRevision = 0, armed = false;
  invoke.mockImplementation(async (_command, { client, params }) => {
    if (params.action === "snapshot") observedRevision = canonicalRevision;
    if (params.action === "unregister") armed = false;
    if (params.action === "arm") {
      if (params.expectedRevision !== canonicalRevision) throw new Error("CW context changed; observe it before arming.");
      armed = true;
    }
    return { revision: observedRevision, armed, pending: false, owner: null, client: armed ? client : null,
      lease: armed ? "lease" : null, error: "", canonical: { profile: defaultCWProfile, context: { CALL: `CALL${observedRevision}` } } };
  });
  let controller: ReturnType<typeof useSharedCW>["controller"];
  function Harness({ contextKey }: { contextKey: string }) {
    controller = useSharedCW(contextKey).controller;
    return null;
  }
  const { rerender } = render(<Harness contextKey="0" />);
  await act(async () => {});
  for (let change = 1; change <= 10; change++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    canonicalRevision = change;
    rerender(<Harness contextKey={String(change)} />);
    await act(async () => {});
  }
  const snapshots = () => invoke.mock.calls.filter(call => call[1].params.action === "snapshot").length;
  expect(snapshots()).toBe(7); // Initial read plus deadlines at 750...4500ms.
  expect(invoke.mock.calls.filter(call => call[1].params.action === "arm")).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(snapshots()).toBe(8);
  expect(controller!.getSnapshot().canonical?.context.CALL).toBe("CALL10");
  await act(async () => { await controller!.arm(); });
  expect(controller!.getSnapshot().armed).toBe(true);
  expect(invoke.mock.calls.find(call => call[1].params.action === "arm")?.[1].params.expectedRevision).toBe(10);
});
