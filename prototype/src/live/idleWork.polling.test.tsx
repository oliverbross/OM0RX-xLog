// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSharedCW } from "./useSharedCW";
import { useFollowRadio } from "./useFollowRadio";
import { useAutoRotor } from "./useAutoRotor";
import { useSpotActivation } from "./useSpotActivation";
import { defaultCWProfile } from "./cwMacros";

const bridge = vi.hoisted(() => ({
  call: vi.fn(), completed: {} as Record<string, number>,
  events: new Map<string, Set<() => void>>(), installed: 0, disposed: 0, wakes: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: bridge.call }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (event: string, wake: () => void) => {
  const listeners = bridge.events.get(event) ?? new Set<() => void>();
  listeners.add(wake); bridge.events.set(event, listeners); bridge.installed++;
  return () => { listeners.delete(wake); bridge.disposed++; };
} }));
const idle = () => ({ operationId: null, phase: "idle", barrier: null });
const settle = async () => { await act(async () => {}); };
const advance = async () => {
  // Separate commits at each existing 750ms deadline; a single 30s act would
  // batch React work and conceal the actual repeated snapshot notifications.
  for (let tick = 0; tick < 40; tick++) await act(async () => { await vi.advanceTimersByTimeAsync(750); });
};
const wake = async (event: string) => { await act(async () => {
  bridge.events.get(event)?.forEach(listener => { bridge.wakes++; listener(); });
}); };
const calls = () => Object.fromEntries([...new Set(bridge.call.mock.calls.map(([command]) => command))]
  .map(command => [command, bridge.call.mock.calls.filter(([value]) => value === command).length]));
beforeEach(() => {
  vi.useFakeTimers(); bridge.call.mockReset(); bridge.completed = {}; bridge.events.clear();
  bridge.installed = 0; bridge.disposed = 0; bridge.wakes = 0;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  bridge.call.mockImplementation(async (command: string) => {
    let value: unknown;
    if (command === "cw_session_request") value = { revision: 1, armed: false, pending: false,
      owner: null, client: null, lease: null, error: "", canonical: { profile: defaultCWProfile } };
    else if (command === "operator_draft_follow_snapshot") value = { enabled: false, epoch: 0, error: "", operation: idle(), settlementPending: false };
    else if (command === "auto_rotor_snapshot") value = { armed: false, epoch: 0, owner: null, generation: null,
      target: null, activation_pending: false, canonical_pending: false, error: "" };
    else if (command === "spot_activation_snapshot") value = idle();
    else throw new Error(`Unexpected idle command: ${command}`);
    bridge.completed[command] = (bridge.completed[command] ?? 0) + 1;
    return structuredClone(value); // IPC returns new objects even when unchanged.
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("counts the real idle hooks without suppressing authority reads, timers or subscriptions", async () => {
  const commits: Record<string, number> = {};
  const commit = (owner: string) => { commits[owner] = (commits[owner] ?? 0) + 1; };
  function CW() { useSharedCW("idle-fixture"); useLayoutEffect(() => commit("cw")); return null; }
  function Follow() { useFollowRadio(); useLayoutEffect(() => commit("follow")); return null; }
  function Rotor() { useAutoRotor(); useLayoutEffect(() => commit("rotor")); return null; }
  function Spot({ command }: { command: "activate_spot" | "activate_opportunity" }) {
    useSpotActivation(command); useLayoutEffect(() => commit(command)); return null;
  }
  const view = render(<><CW /><Follow /><Rotor /><Spot command="activate_spot" /><Spot command="activate_opportunity" /></>);
  await settle();
  const initial = { ...commits };
  expect(vi.getTimerCount()).toBe(5);
  expect(bridge.installed).toBe(5);
  await advance();
  const intervalCommits = Object.fromEntries(Object.entries(commits).map(([owner, count]) => [owner, count - initial[owner]]));
  const dispatches = calls(), completions = { ...bridge.completed };
  console.log("IDLE_HOOKS_30_SECONDS", JSON.stringify({ intervalMs: 30_000, dispatches, completions,
    intervalCommits, timers: vi.getTimerCount(), subscriptions: bridge.installed, wakes: bridge.wakes }));
  expect(dispatches).toEqual({ cw_session_request: 41, operator_draft_follow_snapshot: 21,
    auto_rotor_snapshot: 21, spot_activation_snapshot: 42 });
  expect(completions).toEqual(dispatches);
  view.unmount(); await settle();
  const stopped = bridge.call.mock.calls.length;
  await advance();
  expect(bridge.call.mock.calls.length).toBe(stopped);
  expect(vi.getTimerCount()).toBe(0);
  expect(bridge.disposed).toBe(bridge.installed);
  expect([...bridge.events.values()].every(listeners => listeners.size === 0)).toBe(true);
  expect(bridge.call.mock.calls.at(-1)?.[1].params.action).toBe("unregister");
  // Identical idle activation observations have no new information for React.
  expect(intervalCommits.activate_spot).toBe(0);
  expect(intervalCommits.activate_opportunity).toBe(0);
});

it("publishes idle read errors and their recovery, and still responds to native wakes", async () => {
  let current!: ReturnType<typeof useSpotActivation>;
  let commits = 0;
  function Harness() { current = useSpotActivation(); useLayoutEffect(() => { commits++; }); return null; }
  render(<Harness />); await settle(); const initial = commits;
  bridge.call.mockRejectedValueOnce(new Error("fixture read unavailable"));
  await wake("xlog:spot-activation");
  expect(current.error).toBe("fixture read unavailable");
  expect(commits).toBe(initial + 1);
  await wake("xlog:spot-activation");
  expect(current.error).toBe(""); expect(current.status?.phase).toBe("idle");
  expect(commits).toBe(initial + 2);
  await wake("xlog:spot-activation");
  expect(bridge.wakes).toBe(3);
  expect(commits).toBe(initial + 2);
  expect(bridge.call).toHaveBeenCalledTimes(4);
});

it("retains unresolved-operation recovery and discards a snapshot completed after unmount", async () => {
  const operationId = "00000000-0000-4000-8000-000000000001";
  const preparing = { operationId, phase: "preparing", barrier: null };
  let current!: ReturnType<typeof useSpotActivation>;
  function Harness() { current = useSpotActivation(); return null; }
  const view = render(<Harness />); await settle();
  bridge.call.mockResolvedValueOnce(preparing);
  await wake("xlog:spot-activation");
  expect(current.canActivate()).toBe(false);
  bridge.call.mockResolvedValueOnce({ operationId, phase: "uncertain", reservationActive: true, tuneConfirmed: false, rotor: "not_requested" })
    .mockResolvedValueOnce({ operationId, phase: "confirmed", reservationActive: false, tuneConfirmed: true, rotor: "not_requested" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(bridge.call.mock.calls.slice(-2)).toEqual([["spot_activation_status", { operationId }], ["spot_activation_reconcile", { operationId }]]);
  expect(current.status?.phase).toBe("confirmed"); expect(current.canActivate()).toBe(true);
  let finish!: (value: unknown) => void;
  bridge.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  view.unmount(); const stopped = bridge.call.mock.calls.length;
  await act(async () => { finish(idle()); await vi.advanceTimersByTimeAsync(30_000); });
  expect(current.status?.phase).toBe("confirmed");
  expect(bridge.call.mock.calls.length).toBe(stopped); expect(vi.getTimerCount()).toBe(0);
  expect(bridge.disposed).toBe(1);
});
