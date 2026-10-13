// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture } from "./operator-draft-fixture";

const bridge = vi.hoisted(() => ({ request: vi.fn(), tune: null as null | ((value: any) => void), rotorGeneration: 4,
  telemetry: vi.fn(), stationTelemetry: vi.fn(), selectTelemetry: vi.fn(), intentId: null as string | null, deferMotion: false, motion: null as null | { resolve: (value: any) => void; reject: (cause: Error) => void } }));
vi.mock("../src/live/rotorTelemetry", () => ({ connectRotorTelemetry: bridge.telemetry }));
vi.mock("../src/live/stationTelemetry", () => ({ connectStationTelemetry: bridge.stationTelemetry, selectStationTelemetry: bridge.selectTelemetry }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: bridge.request }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await bridge.request(method, params)).result }));
vi.mock("../src/Map", () => ({ default: () => <div>Map</div> }));
vi.mock("../src/live/Conditions", () => ({ default: () => <div>Conditions</div> }));
vi.mock("../src/live/BandMaps", async original => ({ ...await original<typeof import("../src/live/BandMaps")>(),
  default: ({ preferences: view, onPreferencesChange }: any) => <div><output data-testid="map-font">{view?.fontScale}</output><button disabled={!view} onClick={() => onPreferencesChange?.({ ...view, fontScale: Number((view.fontScale + 0.1).toFixed(1)) })}>Increase map font</button></div> }));
vi.mock("../src/live/ClusterPanel", () => ({ ClusterPanel: ({ onSelect }: any) => <button onClick={() => onSelect({ id: "spot", callsign: "K1ABC", frequencyKHz: 14074, mode: "FT8", band: "20m" })}>Select test spot</button> }));
const preferences = { deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"], deskBandMapFollowsRadio: false, detachedBandMapFollowsRadio: false, detachedBandMapLayout: "Single row", bandMapFontScale: 1, intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false };
function controlOneSecondPolls() {
  // Control only the app's 1000ms snapshot intervals. Keep Testing Library's
  // 50ms waits, lookup debounces and all other timers real; no wall-clock sleeps
  // or shortened application poll periods are needed to prove poll/reply order.
  const callbacks = new Map<number, () => void>(); let nextId = -1000;
  const interval = globalThis.setInterval, clear = globalThis.clearInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 1000 && typeof callback === "function") {
      const id = nextId--; callbacks.set(id, () => callback(...args)); return id;
    }
    return interval(callback, delay, ...args);
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((id: ReturnType<typeof setInterval>) => {
    if (!callbacks.delete(id as unknown as number)) clear(id);
  }) as typeof clearInterval);
  return async () => {
    const before = bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot").length;
    await act(async () => { for (const callback of [...callbacks.values()]) callback(); });
    expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot").length).toBeGreaterThan(before);
  };
}
async function openRotorSettings() {
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Rotator" }));
  return screen.findByRole("region", { name: "Independent rotor" });
}
beforeEach(() => {
  localStorage.clear(); bridge.request.mockReset(); bridge.tune = null; bridge.rotorGeneration = 4; bridge.intentId = null; bridge.deferMotion = false; bridge.motion = null;
  bridge.telemetry.mockReset(); bridge.telemetry.mockReturnValue(null);
  bridge.stationTelemetry.mockReset(); bridge.stationTelemetry.mockReturnValue(null); bridge.selectTelemetry.mockReset(); bridge.selectTelemetry.mockResolvedValue(undefined);
  const sharedDraft = operatorDraftFixture({ id: "draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, mode: "FT8", band: "20m" });
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = sharedDraft(method, params);
    if (shared) return { result: shared };
    if (method === "station_tune") return new Promise(resolve => { bridge.tune = result => resolve({ result }); });
    if (method === "rotor_stop") { bridge.rotorGeneration++; bridge.intentId = null; }
    if (method === "rotor_goto") {
      bridge.rotorGeneration++; bridge.intentId = params.intent_id ?? null;
      if (bridge.deferMotion) return new Promise((resolve, reject) => { bridge.motion = { resolve: result => resolve({ result }), reject }; });
    }
    const result = method === "workspace_status" ? { workspace_exists: true, native_log_exists: true }
      : method === "workspace_preferences_load" ? { preferences, stored: true }
      : method === "settings_load" ? { settings: { stationCall: "OM0RX", gridSquare: "JN88" } }
      : method === "logbook_stats" ? { stats: { qso_count: 1 } }
      : method === "logbook_draft" ? { qso: { id: "draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, mode: "FT8", band: "20m" } }
      : method === "station_snapshot" ? { source: params.provider, generated_at: Date.now() / 1000, radio: { connected: true, observed: true, frequency_hz: 14074000, mode: "DIGU" } }
      : ["rotor_snapshot", "rotor_stop", "rotor_goto"].includes(method) ? { owner: "native_dcu1", generation: bridge.rotorGeneration, intent_id: bridge.intentId, state: "active", backend_available: true, backend: { connected: true, name: "Antenna", azimuth: 53 } }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "lookup_call" ? { call: params.call, bearing: 90, country: "United States" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { result };
  });
});

it("follows native radio telemetry without polling but Read radio still uses explicit readback", async () => {
  let update!: (value: any) => void, unavailable!: () => void;
  const stop = vi.fn();
  bridge.stationTelemetry.mockImplementation((_provider, changed, failed) => { update = changed; unavailable = failed; return stop; });
  const view = render(<LiveApp />);
  await screen.findByLabelText("Desk Frequency MHz");
  await act(async () => update({ source: "direct_agent", radio: { connected: true, observed: true, frequency_hz: 7050000, mode: "CW" } }));
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("7.050000");
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_snapshot")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14.074000"));
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_snapshot")).toHaveLength(1);
  await act(async () => unavailable());
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14.074000");
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_tune")).toHaveLength(0);
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it("uses native rotor telemetry without a renderer poller and disarms on loss", async () => {
  let update!: (value: any) => void, unavailable!: () => void;
  const stop = vi.fn();
  bridge.telemetry.mockImplementation((changed, failed) => { update = changed; unavailable = failed; return stop; });
  const view = render(<LiveApp />);
  await act(async () => update({ owner: "native_dcu1", generation: 4, state: "active", backend_available: true,
    backend: { connected: true, name: "Antenna", azimuth: 53 } }));
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(automatic); expect((automatic as HTMLInputElement).checked).toBe(true);
  await act(async () => unavailable());
  expect((automatic as HTMLInputElement).checked).toBe(false);
  expect((automatic as HTMLInputElement).disabled).toBe(true);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot")).toHaveLength(0);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(0);
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it.each(["before", "after"])("keeps auto armed when its own identified motion is polled %s the reply", async order => {
  const poll = controlOneSecondPolls();
  bridge.deferMotion = true;
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  await waitFor(() => expect(bridge.motion).not.toBeNull());
  const reply = { owner: "native_dcu1", generation: 5, intent_id: bridge.intentId, state: "active", backend: { accepted: true } };
  if (order === "before") await poll();
  await act(async () => { bridge.motion?.resolve(reply); });
  if (order === "after") await poll();
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect((await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).checked).toBe(true);
});

it.each(["rejected", "late success"])("manual monitor motion disarms pending auto and cannot rearm from %s", async outcome => {
  const poll = controlOneSecondPolls();
  bridge.deferMotion = true;
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  await waitFor(() => expect(bridge.motion).not.toBeNull());
  const ownId = bridge.intentId;
  // Same expected generation belongs to a competing manual intent, or a second
  // generation after this auto turn. Neither observation is ours.
  bridge.intentId = null;
  if (outcome === "late success") bridge.rotorGeneration++;
  await poll();
  await act(async () => {
    if (outcome === "rejected") bridge.motion?.reject(new Error("Rotor generation changed"));
    else bridge.motion?.resolve({ owner: "native_dcu1", generation: 5, intent_id: ownId, state: "active", backend: { accepted: true } });
  });
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect((await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).checked).toBe(false);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(1);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("never turns from a late lookup after an unconfirmed spot tune", async () => {
  const base = bridge.request.getMockImplementation()!;
  let lookupReply: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "lookup_call"
    ? new Promise(resolve => { lookupReply = result => resolve({ result }); }) : base(method, params));
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await act(async () => bridge.tune?.({ accepted: true, confirmed: false }));
  await waitFor(() => expect(lookupReply).toBeDefined());
  await act(async () => lookupReply?.({ call: "K1ABC", bearing: 90 }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
});

it("transfers selected spot references without replacing edits made during validation", async () => {
  const base = bridge.request.getMockImplementation()!;
  let resolveReferences: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "reference_resolve") return new Promise(resolve => { resolveReferences = result => resolve({ result }); });
    return base(method, params);
  });
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(resolveReferences).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  fireEvent.change(screen.getByLabelText("Desk POTA"), { target: { value: "US-9999" } });
  fireEvent.change(screen.getByLabelText("Desk IOTA"), { target: { value: "EU-001" } });
  fireEvent.change(screen.getByLabelText("Desk IOTA"), { target: { value: "" } });
  await act(async () => resolveReferences?.({ fields: { sotaReference: "FL/VO-209", potaReference: "US-0001", iota: "EU-002" },
    references: [{ kind: "sota", reference: "FL/VO-209", status: "verified", name: "Summit" }] }));
  expect((screen.getByLabelText("Desk SOTA") as HTMLInputElement).value).toBe("FL/VO-209");
  expect((screen.getByLabelText("Desk POTA") as HTMLInputElement).value).toBe("US-9999");
  expect((screen.getByLabelText("Desk IOTA") as HTMLInputElement).value).toBe("");
  expect(screen.getByText(/SOTA FL\/VO-209 · Verified: Summit/)).toBeTruthy();
});

it("discards reference results when the operator has changed the callsign", async () => {
  const base = bridge.request.getMockImplementation()!;
  let resolveReferences: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "reference_resolve"
    ? new Promise(resolve => { resolveReferences = result => resolve({ result }); }) : base(method, params));
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(resolveReferences).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "EA7EU" } });
  await act(async () => resolveReferences?.({ fields: { sotaReference: "FL/VO-209" }, references: [] }));
  expect((screen.getByLabelText("Desk SOTA") as HTMLInputElement).value).toBe("");
});

it("turns once for a typed resolved call when auto is enabled and never repeats on polling", async () => {
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "EA7EU" } });
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("lookup_call", { call: "EA7EU" }));
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
  fireEvent.click(automatic);
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_goto", expect.objectContaining({ label: "EA7EU", bearing: 90 })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "OM0AAO" } });
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_goto", expect.objectContaining({ label: "OM0AAO" })));
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(2);
});

it.each(["Operator Desk", "Log QSO"])("saves exactly once on Command-Enter in %s without a global shortcut duplicate", async view => {
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "logbook_save" ? { result: { qso: params.qso } } : base(method, params));
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  if (view === "Log QSO") fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: view }));
  const input = await screen.findByLabelText(view === "Log QSO" ? "Callsign" : "Desk Callsign");
  fireEvent.change(input, { target: { value: "K1ABC" } });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await waitFor(() => expect(bridge.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1));
  expect(bridge.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
});

it("passes authentic observed radio and configured station provenance to the full editor", async () => {
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Log QSO" }));
  await screen.findByText("Station context");
  expect(screen.getAllByText("configured")).toHaveLength(2);
  expect(screen.getAllByText("observed")).toHaveLength(2);
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
});

it("does not write an old explicit radio readback into a newly cleared QSO draft", async () => {
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  const base = bridge.request.getMockImplementation()!;
  let read: null | ((value: any) => void) = null;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "station_snapshot") return new Promise(resolve => { read = result => resolve({ result }); });
    if (method === "logbook_draft") return { result: { qso: { id: "new-draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, band: "20m", mode: "FT8" } } };
    return base(method, params);
  });
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "K1ABC" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(read).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" }));
  await waitFor(() => expect((screen.getByLabelText("Desk Callsign") as HTMLInputElement).value).toBe(""));
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "21.100000" } });
  await act(async () => { (read as unknown as (value: any) => void)({ radio: { connected: true, observed: true, frequency_hz: 7025000, mode: "CW" } }); });
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("21.100000");
  expect((screen.getByLabelText("Desk Band") as HTMLSelectElement).value).toBe("15m");
});

it("does not overwrite a newer preference save with a late failed-save recovery load", async () => {
  const base = bridge.request.getMockImplementation()!;
  let loads = 0, saves = 0;
  let recovery: null | ((value: any) => void) = null;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "workspace_preferences_load" && ++loads > 1) return new Promise(resolve => { recovery = value => resolve({ result: value }); });
    if (method === "workspace_preferences_save") {
      if (++saves === 1) throw new Error("Save unavailable");
      return { result: { preferences: params.preferences } };
    }
    return base(method, params);
  });
  render(<LiveApp />);
  await waitFor(() => expect(screen.getByTestId("map-font").textContent).toBe("1"));
  fireEvent.click(screen.getByRole("button", { name: "Increase map font" }));
  await waitFor(() => expect(recovery).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Increase map font" }));
  await waitFor(() => expect(saves).toBe(2));
  await act(async () => { (recovery as unknown as (value: any) => void)({ preferences, stored: true }); });
  expect(screen.getByTestId("map-font").textContent).toBe("1.2");
});

it("cancels pending automatic motion on independent stop and never replays it", async () => {
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  expect(bridge.request.mock.calls.some(([method]) => ["rotor_connect", "rotor_goto"].includes(method))).toBe(false);
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await openRotorSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Stop rotor" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 4 }));
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect((await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).checked).toBe(false);
});

it("stops the fresh same-owner generation while a goto reply is in flight and never rearms from that reply", async () => {
  bridge.deferMotion = true;
  render(<LiveApp />);
  const automatic = await screen.findByRole("checkbox", { name: "Auto rotor" });
  await waitFor(() => expect((automatic as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  await waitFor(() => expect(bridge.motion).not.toBeNull());
  const ownId = bridge.intentId;
  await openRotorSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Stop rotor" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 5 }));
  await act(async () => { bridge.motion?.resolve({ owner: "native_dcu1", generation: 5, intent_id: ownId, state: "active", backend: { accepted: true } }); });
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect((await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).checked).toBe(false);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_stop")).toHaveLength(1);
});

it("does not retry or redirect an explicit Stop across an owner switch", async () => {
  render(<LiveApp />);
  await waitFor(() => expect((screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).disabled).toBe(false));
  await openRotorSettings();
  const stop = await screen.findByRole("button", { name: "Stop rotor" });
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "rotor_snapshot"
    ? { result: { owner: "hamlib", generation: 5, state: "active", backend: { fields: { position: { Azimuth: "80" } } } } }
    : base(method, params));
  // Capture the rendered old owner, then switch the preflight response and
  // click in one turn. Awaiting a selector after switching lets a background
  // poll legitimately update the button to the new owner on slower runners.
  fireEvent.click(stop);
  await waitFor(() => expect(screen.getAllByText(/Rotor owner changed/).length).toBeGreaterThan(0));
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_stop")).toBe(false);
});

it("preserves rotor ownership across radio handover and clears only the stale guidance", async () => {
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(screen.getByRole("button", { name: "Station Control" }));
  fireEvent.click(await screen.findByRole("button", { name: "Direct FLEX · LAN" }));
  expect(bridge.request.mock.calls.some(([method]) => method === "station_disconnect")).toBe(false);
  expect(screen.getByText(/Viewing only. Apply radio selection/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply radio selection" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("station_disconnect", { provider: "direct_agent" }));
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_disconnect")).toHaveLength(1);
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_disconnect")).toBe(false);
  await waitFor(() => expect(screen.queryByText("Previous radio disconnected. Connect the selected radio explicitly.")).toBeNull());
  expect(screen.queryByRole("region", { name: "Independent rotor" })).toBeNull();
  await openRotorSettings();
  expect(screen.getByRole("region", { name: "Independent rotor" })).toBeTruthy();
  expect(screen.getByText("053°")).toBeTruthy();
});

it("browses inactive radio tabs without disconnecting or changing the active poll provider", async () => {
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(screen.getByRole("button", { name: "Station Control" }));
  fireEvent.click(screen.getByRole("button", { name: "Local station · Hamlib" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" }).hasAttribute("disabled")).toBe(true));
  expect(bridge.request.mock.calls.some(([method]) => method === "hamlib_status")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Direct FLEX · LAN" }));
  expect(bridge.request.mock.calls.some(([method]) => method === "station_disconnect" || method === "hamlib_disconnect")).toBe(false);
  expect(localStorage.getItem("xlog.integration.provider")).toBeNull();
  await waitFor(() => expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_agent")).toBe(true));
  expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_flex_lan")).toBe(false);

  fireEvent.change(screen.getByRole("textbox", { name: "Private radio IP address" }), { target: { value: "192.168.1.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect FLEX" }));
  await waitFor(() => expect(screen.getByText(/Apply this radio selection before connecting/)).toBeTruthy());
  expect(bridge.request.mock.calls.some(([method]) => method === "station_connect")).toBe(false);
});

it("keeps the prior active radio if explicit selection retirement fails", async () => {
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "station_disconnect") throw new Error("Owned release unconfirmed");
    return base(method, params);
  });
  render(<LiveApp />);
  await screen.findByRole("checkbox", { name: "Auto rotor" });
  fireEvent.click(screen.getByRole("button", { name: "Station Control" }));
  fireEvent.click(screen.getByRole("button", { name: "Direct FLEX · LAN" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply radio selection" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Owned release unconfirmed"));
  expect(screen.getByRole("button", { name: "Apply radio selection" })).toBeTruthy();
  expect(localStorage.getItem("xlog.integration.provider")).toBeNull();
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_disconnect")).toHaveLength(1);
  expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_flex_lan")).toBe(false);
});
