// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeWorkspaceWindowIDs, readWorkspaceWindowsStatus, useWorkspaceWindows } from "./useWorkspaceWindows";
import WorkspaceSettings from "./WorkspaceSettings";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "./workspaceLayoutSession";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const idle = () => ({ supported: ["monitor", "world-map", "band-maps", "dx-cluster", "logbook", "awards"],
  generation: null, revision: null, presetID: null, state: "idle", shown: [], hidden: [], error: "", stopped: false, attempt: 0 });
const applied = () => ({ ...idle(), state: "applied", generation: "01234567-89ab-cdef-0123-456789abcdef", revision: 2, presetID: "desk-1" });
const allNativeRoles = ["callsign-intelligence", "log-qso", "spot-history", "monitor", "world-map", "band-maps", "dx-cluster", "logbook", "awards", "settings", "chaser-dx", "station-control", "cw", "rotor", "station-status", "propagation", "station-identity"];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let wake: (event?: unknown) => void, dispose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.resetAllMocks(); native.isTauri.mockReturnValue(true); dispose = vi.fn();
  native.listen.mockImplementation(async (_event, callback) => { wake = callback; return dispose; });
  native.invoke.mockImplementation(async command => command === "workspace_windows_status" ? idle() : { attempt: 1 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("native workspace status schema", () => {
  it("matches the exact native supported-window registry rather than all workspace roles", () => {
    const source = readFileSync("src-tauri/src/workspace_windows.rs", "utf8");
    const registry = source.slice(source.indexOf("pub const SUPPORTED_WINDOWS:"), source.indexOf("\n];") + 3);
    const roles = [...registry.matchAll(/WindowSpec \{ id: "([^"]+)"/g)].map(match => match[1]);
    expect(roles).toEqual(allNativeRoles);
    expect([...nativeWorkspaceWindowIDs]).toEqual(roles);
    expect(() => readWorkspaceWindowsStatus({ ...idle(), supported: [...workspacePanelIDs] })).toThrow("could not be verified");
  });
  it("accepts the actual native-role payload including new roles shown and hidden", () => {
    const value = { ...applied(), supported: allNativeRoles, shown: ["callsign-intelligence", "log-qso"], hidden: ["spot-history"] };
    expect(readWorkspaceWindowsStatus(value)).toEqual(value);
  });
  it("accepts bounded native observations and a supported subset", () => {
    const value = { ...idle(), supported: ["world-map"], shown: ["world-map"], state: "applied",
      generation: "01234567-89ab-cdef-0123-456789abcdef", revision: 2, presetID: "desk-1" };
    expect(readWorkspaceWindowsStatus(value)).toEqual(value);
    expect(readWorkspaceWindowsStatus({ ...idle(), state: "applying" }).state).toBe("applying");
  });
  it.each([
    { state: "done" }, { supported: ["antenna"] }, { supported: ["monitor", "monitor"] },
    { supported: [...allNativeRoles, "unknown"] }, { shown: ["logbook", "logbook"] }, { hidden: ["antenna"] },
    { supported: ["world-map"], shown: ["monitor"] }, { state: "applied" },
    { ...applied(), generation: null }, { ...applied(), revision: null }, { ...applied(), presetID: null },
    { generation: "bad" }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { presetID: "x".repeat(65) }, { error: "x".repeat(4097) }, { stopped: 1 },
    { attempt: undefined }, { attempt: -1 }, { attempt: 0.5 }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed or unsupported observations %j", change => {
    expect(() => readWorkspaceWindowsStatus({ ...idle(), ...change })).toThrow("could not be verified");
  });
  it("accepts a window shown then hidden by a superseding layout", () => {
    expect(readWorkspaceWindowsStatus({ ...applied(), shown: ["world-map"], hidden: ["world-map"] }))
      .toMatchObject({ state: "applied", shown: ["world-map"], hidden: ["world-map"] });
  });
});

it("renders and saves actual Workspace Settings placements after a complete native read", async () => {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  let snapshot: LayoutSnapshot = { generation: "01234567-89ab-cdef-0123-456789abcdef", revision: 7,
    document: { version: 2, activePresetID: "traditional", presets: ["traditional", "windowed"].map(id => ({
      id, name: id === "traditional" ? "Traditional" : "Windowed", width: 1920, height: 1080, locked: true, snap: true, panels: structuredClone(panels),
    })) } };
  native.invoke.mockResolvedValue({ ...applied(), supported: allNativeRoles, generation: snapshot.generation, revision: snapshot.revision, presetID: "traditional" });
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_apply") snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
    return { status: "applied", layout: structuredClone(snapshot) };
  });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <WorkspaceSettings state={state} session={session} available={["active-qso", "world-map", "band-maps", "dx-cluster", "logbook"]} />;
  }
  render(<Harness />);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("workspace_windows_status"));
  fireEvent.click(screen.getByRole("button", { name: "Duplicate layout" }));
  const placement = await screen.findByLabelText("Logbook placement");
  expect(placement.tagName).toBe("SELECT"); expect((placement as HTMLSelectElement).disabled).toBe(false);
  expect(screen.getByLabelText("Log QSO placement")).toBeTruthy();
  expect(screen.getByLabelText("Spot History placement")).toBeTruthy();
  expect(screen.getByLabelText("Callsign intelligence placement")).toBeTruthy();
  expect(screen.getByLabelText("Rotor placement")).toBeTruthy();
  expect(screen.queryByLabelText("Antenna placement")).toBeNull();
  expect(request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(0);
  fireEvent.change(placement, { target: { value: "window" } });
  fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
  await screen.findByText("Layout saved. Use layout to switch arrangements.");
  expect(snapshot.document.activePresetID).toBe("traditional");
  const saved = snapshot.document.presets.find(preset => !["traditional", "windowed"].includes(preset.id))!;
  expect(saved.panels.find(panel => panel.id === "logbook")?.placement).toBe("window");
  expect(request.mock.calls.every(([method]) => ["workspace_layout_load", "workspace_layout_apply"].includes(method))).toBe(true);
  expect(native.invoke.mock.calls.every(([method]) => method === "workspace_windows_status")).toBe(true);
});

it("is inert outside Tauri, including retry and focus", async () => {
  native.isTauri.mockReturnValue(false);
  const { result } = renderHook(useWorkspaceWindows);
  await act(async () => { await result.current.retry(); window.dispatchEvent(new Event("focus")); });
  expect(result.current).toMatchObject({ status: null, error: "", retrying: false });
  expect(native.invoke).not.toHaveBeenCalled(); expect(native.listen).not.toHaveBeenCalled();
});

it("subscribes before reading and treats wake payload as untrusted", async () => {
  const subscription = deferred<() => void>(); native.listen.mockReturnValue(subscription.promise);
  const { result } = renderHook(useWorkspaceWindows);
  expect(native.invoke).not.toHaveBeenCalled();
  await act(async () => { subscription.resolve(dispose); });
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(native.listen).toHaveBeenCalledWith("xlog:workspace-windows", expect.any(Function));
  native.invoke.mockResolvedValue({ ...applied(), shown: ["world-map"] });
  await act(async () => { native.listen.mock.calls[0][1]({ payload: { state: "error", shown: ["rotor"] } }); });
  await waitFor(() => expect(result.current.status?.shown).toEqual(["world-map"]));
  expect(native.invoke.mock.calls.every(args => args.length === 1 && args[0] === "workspace_windows_status")).toBe(true);
});

it("coalesces burst invalidations and never overlaps status reads", async () => {
  const first = deferred<unknown>(); native.invoke.mockReturnValueOnce(first.promise);
  const { result } = renderHook(useWorkspaceWindows);
  await act(async () => {});
  await act(async () => { for (let index = 0; index < 30; index++) { wake(); window.dispatchEvent(new Event("focus")); } });
  expect(native.invoke).toHaveBeenCalledTimes(1);
  native.invoke.mockResolvedValue(applied());
  await act(async () => { first.resolve({ ...idle(), state: "applying" }); });
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

it("reports read failures and recovers on focus without reconciling", async () => {
  native.invoke.mockRejectedValueOnce(new Error("status failed"));
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.error).toBe("status failed"));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(result.current.error).toBe("");
  expect(native.invoke.mock.calls.every(([command]) => command === "workspace_windows_status")).toBe(true);
});

it("keeps focus fallback after subscription failure", async () => {
  native.listen.mockRejectedValue(new Error("listen failed"));
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  expect(result.current.error).toContain("Refocus to reload");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
});

it("retry queues only the saved snapshot, refreshes, and does not invent completion", async () => {
  const queued = deferred<{ attempt: number }>();
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  native.invoke.mockImplementation(command => command === "workspace_windows_reconcile" ? queued.promise : Promise.resolve({ ...idle(), state: "applying", attempt: 1 }));
  let retry!: Promise<void>;
  act(() => { retry = result.current.retry(); void result.current.retry(); });
  expect(result.current.retrying).toBe(true);
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_windows_reconcile")).toEqual([["workspace_windows_reconcile"]]);
  await act(async () => { queued.resolve({ attempt: 1 }); await retry; });
  expect(result.current.retrying).toBe(true); expect(result.current.status?.state).toBe("applying");
  native.invoke.mockResolvedValue({ ...idle(), state: "error", error: "could not show world-map", shown: [], attempt: 1 });
  act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.state).toBe("error"));
  expect(result.current.status?.error).toContain("could not show");
  expect(result.current.retrying).toBe(false);
});

it("reports retry errors", async () => {
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("idle"));
  native.invoke.mockRejectedValue(new Error("queue failed"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.error).toBe("queue failed"); expect(result.current.retrying).toBe(false);
});

it("keeps a retry pending after an old applied snapshot, applying state, or older terminal outcome", async () => {
  let snapshot = { ...applied(), attempt: 1 };
  native.invoke.mockImplementation(async command => command === "workspace_windows_reconcile" ? { attempt: 3 } : snapshot);
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.retrying).toBe(true);
  for (const next of [{ ...applied(), attempt: 2 }, { ...applied(), state: "applying", attempt: 3 }]) {
    snapshot = next; act(() => { wake(); });
    await waitFor(() => expect(result.current.status).toEqual(next));
    expect(result.current.retrying).toBe(true);
  }
  snapshot = { ...applied(), attempt: 3 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.retrying).toBe(false));
});

it("recognizes fast completion before acknowledgement and a newer coalesced terminal attempt", async () => {
  const queued = deferred<{ attempt: number }>();
  let snapshot = applied();
  native.invoke.mockImplementation(command => command === "workspace_windows_reconcile" ? queued.promise : Promise.resolve(snapshot));
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  let retry!: Promise<void>; act(() => { retry = result.current.retry(); });
  snapshot = { ...applied(), attempt: 5 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.attempt).toBe(5));
  expect(result.current.retrying).toBe(true);
  await act(async () => { queued.resolve({ attempt: 4 }); await retry; });
  expect(result.current.retrying).toBe(false); expect(result.current.status?.attempt).toBe(5);
});

it.each([undefined, {}, { attempt: 0 }, { attempt: -1 }, { attempt: 1.5 }, { attempt: Number.MAX_SAFE_INTEGER + 1 }])
  ("rejects unverified retry acknowledgement %j", async acknowledgement => {
    const { result } = renderHook(useWorkspaceWindows);
    await waitFor(() => expect(result.current.status).not.toBeNull());
    native.invoke.mockResolvedValueOnce(acknowledgement);
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toContain("acknowledgement could not be verified");
    expect(result.current.retrying).toBe(false);
    native.invoke.mockResolvedValue(applied()); act(() => { wake(); });
    await waitFor(() => expect(result.current.status?.state).toBe("applied"));
    expect(result.current.error).toContain("acknowledgement could not be verified");
  });

it("exposes recovery after read failure and retains uncertainty across older applied reads", async () => {
  let failRead = false, snapshot = { ...applied(), attempt: 1 };
  native.invoke.mockImplementation(async command => {
    if (command === "workspace_windows_reconcile") { failRead = true; return { attempt: 2 }; }
    if (failRead) throw new Error("read unavailable");
    return snapshot;
  });
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.retrying).toBe(false); expect(result.current.status).toBeNull();
  expect(result.current.error).toContain("could not be confirmed");
  failRead = false; act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.attempt).toBe(1));
  expect(result.current.error).toContain("could not be confirmed");
  snapshot = { ...applied(), attempt: 2 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.error).toBe(""));
});

it("keeps recovery busy when the old attempt completes before the new enqueue acknowledgement", async () => {
  let failRead = false, snapshot = { ...applied(), attempt: 1 };
  const recovery = deferred<{ attempt: number }>();
  let requests = 0;
  native.invoke.mockImplementation(async command => {
    if (command === "workspace_windows_reconcile") {
      if (++requests === 1) { failRead = true; return { attempt: 2 }; }
      return recovery.promise;
    }
    if (failRead) throw new Error("read unavailable");
    return snapshot;
  });
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.retrying).toBe(false);
  failRead = false;
  let retry!: Promise<void>;
  act(() => { retry = result.current.retry(); });
  snapshot = { ...applied(), attempt: 2 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.attempt).toBe(2));
  expect(result.current.retrying).toBe(true);
  await act(async () => { recovery.resolve({ attempt: 3 }); await retry; });
  expect(result.current.retrying).toBe(true);
  snapshot = { ...applied(), attempt: 3 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.retrying).toBe(false));
  expect(result.current.error).toBe("");
});

it("does not let the old terminal attempt erase a rejected recovery enqueue", async () => {
  let failRead = false, snapshot = { ...applied(), attempt: 1 }, requests = 0;
  native.invoke.mockImplementation(async command => {
    if (command === "workspace_windows_reconcile") {
      if (++requests === 1) { failRead = true; return { attempt: 2 }; }
      throw new Error("recovery queue failed");
    }
    if (failRead) throw new Error("read unavailable");
    return snapshot;
  });
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status?.state).toBe("applied"));
  await act(async () => { await result.current.retry(); });
  failRead = false;
  await act(async () => { await result.current.retry(); });
  expect(result.current.error).toBe("recovery queue failed");
  snapshot = { ...applied(), attempt: 2 }; act(() => { wake(); });
  await waitFor(() => expect(result.current.status?.attempt).toBe(2));
  expect(result.current.error).toBe("recovery queue failed");
  expect(result.current.retrying).toBe(false);
});

it("releases a queued retry on shutdown even when its attempt was never started", async () => {
  let snapshot = applied();
  native.invoke.mockImplementation(async command => command === "workspace_windows_reconcile" ? { attempt: 2 } : snapshot);
  const { result } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status).not.toBeNull());
  await act(async () => { await result.current.retry(); });
  expect(result.current.retrying).toBe(true);
  snapshot = { ...applied(), stopped: true }; act(() => { wake(); });
  await waitFor(() => expect(result.current.retrying).toBe(false));
  expect(result.current.error).toContain("owner has stopped");
});

it("disposes a late subscription and prevents retained retry or focus work", async () => {
  const subscription = deferred<() => void>(); native.listen.mockReturnValue(subscription.promise);
  const { result, unmount } = renderHook(useWorkspaceWindows); const retry = result.current.retry;
  unmount();
  await act(async () => { subscription.resolve(dispose); await retry(); window.dispatchEvent(new Event("focus")); });
  expect(dispose).toHaveBeenCalledTimes(1); expect(native.invoke).not.toHaveBeenCalled();
});

it("drops pending wake and post-retry reads after disposal", async () => {
  const queued = deferred<void>();
  const { result, unmount } = renderHook(useWorkspaceWindows);
  await waitFor(() => expect(result.current.status).not.toBeNull());
  native.invoke.mockReturnValue(queued.promise);
  let retry!: Promise<void>; act(() => { retry = result.current.retry(); wake(); });
  unmount();
  await act(async () => { queued.resolve(); await retry; });
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledTimes(1);
});

it("ignores a late read and its coalesced followup after disposal", async () => {
  const reading = deferred<unknown>(); native.invoke.mockReturnValue(reading.promise);
  const { result, unmount } = renderHook(useWorkspaceWindows);
  await act(async () => {}); act(() => { wake(); }); unmount();
  await act(async () => { reading.resolve(applied()); });
  expect(result.current.status).toBeNull(); expect(native.invoke).toHaveBeenCalledTimes(1);
});
