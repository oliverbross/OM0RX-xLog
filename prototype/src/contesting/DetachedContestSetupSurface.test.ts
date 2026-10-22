// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contestSetupWindowSize, fittedContestSetupWindowSize, hostActiveContestStartup, isManagedContestSetupWindowSize, loadContestStationSnapshot,
  stopObservedContestRotor } from "./DetachedContestSetupSurface";
import type { RadioID, StationSession } from "../live/stationSession";
import contestSetupOwnerCapability from "../../src-tauri/capabilities/contest-setup-owner.json";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  framed: vi.fn(),
  station: vi.fn(),
  workspace: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("../worker", () => ({ workerRequest: mocks.worker, framedWorkerRequest: mocks.framed }));
vi.mock("../operatingModule", () => ({ operatingModuleStatus: vi.fn(async () => ({ context: "normal_logging" })) }));
vi.mock("../live/stationSession", async importOriginal => {
  const original = await importOriginal<typeof import("../live/stationSession")>();
  return { ...original, loadStationSession: mocks.station };
});
vi.mock("../live/workspaceNavigation", () => ({ connectWorkspaceNavigation: () => () => {}, isContestMenuRoute: () => false }));
vi.mock("./Not1MMContestWorkspace", () => ({ Not1MMContestWorkspace: mocks.workspace }));
vi.mock("./contestSpotTune", () => ({ tuneContestSpot: vi.fn(), stepContestVFO: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const session = (radioId: RadioID, activeRadio: RadioID, frequencyHz?: number): StationSession => ({
  radio_id: radioId,
  active_radio: activeRadio,
  tx_owner: null,
  generation: "workspace",
  revision: 1,
  base_url: "",
  last_receipt: null,
  selection: { provider: "direct_agent", generation: 1, selection_id: "selection" },
  radio: frequencyHz == null ? undefined : {
    provider: "direct_agent",
    selection_id: "selection",
    selection_generation: 1,
    snapshot: { radio: { frequency_hz: frequencyHz } },
  },
});

describe("Contest Setup station projection", () => {
  it("accepts only one exact native host-active startup context", () => {
    const sessionID = "20000000-0000-4000-8000-000000000002";
    const workspaceGeneration = "30000000-0000-4000-8000-000000000003";
    expect(hostActiveContestStartup(new URLSearchParams({startup:"host-active",hostActiveSessionID:sessionID,hostActiveWorkspaceGeneration:workspaceGeneration})))
      .toEqual({sessionID, workspaceGeneration});
    expect(hostActiveContestStartup(new URLSearchParams())).toBeNull();
    expect(() => hostActiveContestStartup(new URLSearchParams("startup=host-active&hostActiveSessionID=bad&hostActiveWorkspaceGeneration=bad")))
      .toThrow("native active contest startup context is invalid");
  });
  it("uses compact PDF-shaped sizes for setup workflows", () => {
    expect(contestSetupWindowSize(null)).toEqual({ width: 600, height: 360 });
    expect(contestSetupWindowSize("New Contest")).toEqual({ width: 560, height: 640 });
    expect(contestSetupWindowSize("Edit Current Contest")).toEqual({ width: 560, height: 640 });
    expect(contestSetupWindowSize("Choose a Contest")).toEqual({ width: 560, height: 420 });
    expect(contestSetupWindowSize("Edit Macros")).toEqual({ width: 880, height: 700 });
    expect(fittedContestSetupWindowSize(null, 300, 1_800, 1_400)).toEqual({ width: 600, height: 360 });
    expect(fittedContestSetupWindowSize("New Contest", 846, 1_800, 1_400)).toEqual({ width: 560, height: 870 });
    expect(fittedContestSetupWindowSize("New Contest", 846, 1_800, 2_160, 1.5)).toEqual({ width: 560, height: 1_305 });
    expect(fittedContestSetupWindowSize("New Contest", 846, 1_800, 2_160, 1.5, 32)).toEqual({ width: 560, height: 1_337 });
    expect(fittedContestSetupWindowSize("Edit Keys", 1_600, 1_800, 1_000)).toEqual({ width: 880, height: 936 });
  });
  it("caps automatic setup fit to a small screen without violating native minimums", () => {
    expect(fittedContestSetupWindowSize("Edit Keys", 1_600, 760, 1_000)).toEqual({ width: 696, height: 936 });
    expect(fittedContestSetupWindowSize("New Contest", 846, 1_800, 600)).toEqual({ width: 560, height: 536 });
    expect(fittedContestSetupWindowSize("Edit Keys", 1_600, 500, 300)).toEqual({ width: 520, height: 320 });
  });
  it("admits native resizing only for the detached Contest Setup owner", () => {
    expect(contestSetupOwnerCapability.windows).toEqual(["contest-setup"]);
    expect(contestSetupOwnerCapability.permissions).toEqual(["core:window:allow-set-size"]);
  });
  it("auto-fits only untouched defaults or its own last fitted size", () => {
    expect(isManagedContestSetupWindowSize({ width: 600, height: 360 }, null)).toBe(true);
    expect(isManagedContestSetupWindowSize({ width: 560, height: 640 }, null)).toBe(true);
    expect(isManagedContestSetupWindowSize({ width: 560, height: 870 }, { width: 560, height: 870 })).toBe(true);
    expect(isManagedContestSetupWindowSize({ width: 900, height: 640 }, { width: 560, height: 870 })).toBe(false);
    expect(isManagedContestSetupWindowSize({ width: 600.6, height: 360 }, null)).toBe(false);
  });
  it("reads the active xLog radio through the native station session", async () => {
    const load = vi.fn(async (radioId: RadioID) => radioId === "radio1"
      ? session("radio1", "radio2") : session("radio2", "radio2", 14_025_000));
    await expect(loadContestStationSnapshot(load)).resolves.toEqual({ radio: { frequency_hz: 14_025_000 } });
    expect(load.mock.calls.map(([radioId]) => radioId)).toEqual(["radio1", "radio2"]);
  });

  it("rejects an active-radio handover and does not invent telemetry", async () => {
    const changing = vi.fn(async (radioId: RadioID) => radioId === "radio1"
      ? session("radio1", "radio2") : session("radio2", "radio1", 7_025_000));
    await expect(loadContestStationSnapshot(changing)).rejects.toThrow("active radio changed");
    await expect(loadContestStationSnapshot(async radioId => session(radioId, radioId))).resolves.toEqual({});
  });

  it("stops only an authoritatively observed rotor through the acknowledged native path",async()=>{
    const context={epoch:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",revision:4,selection:null,
      radio:{available:false,snapshot:null},rotor:{available:true,revision:3,received_at_ms:Date.now(),
        snapshot:{owner:"native_dcu1",generation:7,state:"active"}}};
    const stop=vi.fn(async()=>({owner:"native_dcu1",generation:8,state:"active"}));
    await expect(stopObservedContestRotor(async()=>context,stop)).resolves.toMatchObject({generation:8});
    expect(stop).toHaveBeenCalledExactlyOnceWith(context);
    await expect(stopObservedContestRotor(async()=>({...context,rotor:{available:false,snapshot:null}}),stop)).resolves.toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(stopObservedContestRotor(async()=>({rotor:{available:true}}),stop)).rejects.toThrow("could not be verified");
  });

  it("routes the digital setup snapshot through the native Contest Setup owner", async () => {
    mocks.station.mockResolvedValue(session("radio1", "radio1", 14_025_000));
    mocks.worker.mockImplementation(async (method: string) => {
      if (method === "station_snapshot") throw new Error("raw station snapshot is forbidden");
      if (method === "health") return { result: { mode: "integrated" } };
      if (method === "workspace_status") return { result: { workspace_exists: true } };
      if (method === "settings_load") return { result: { generation: "workspace", settings: { stationCall: "OM0RX" } } };
      if (method === "cluster_snapshot") return { result: { snapshot: { spots: [] } } };
      if (method === "wsjtx_snapshot") return { result: { configuration:{enabled:false,address:"127.0.0.1",port:2237,destination:"ordinary_logbook"},
        running:false,contest_target_supported:true,active_contest:{session_id:"contest",plugin_id:"cq_ww_rtty"} } };
      throw new Error(`unexpected method ${method}`);
    });
    render(React.createElement((await import("./DetachedContestSetupSurface")).DetachedContestSetupSurface));
    await waitFor(() => expect(mocks.station).toHaveBeenCalledWith("radio1"));
    expect(mocks.worker.mock.calls.map(([method]) => method)).not.toContain("station_snapshot");
    const props=mocks.workspace.mock.calls.at(-1)?.[0] as {serviceRequest:(method:string)=>Promise<unknown>};
    await expect(props.serviceRequest("wsjtx_snapshot")).resolves.toMatchObject({
      configuration:{address:"127.0.0.1",port:2237,destination:"ordinary_logbook"},
      contest_target_supported:true,active_contest:{plugin_id:"cq_ww_rtty"},
    });
    expect(mocks.worker).toHaveBeenCalledWith("wsjtx_snapshot",{});
    expect(mocks.framed).not.toHaveBeenCalledWith("wsjtx_snapshot",expect.anything());
  });

  it("uses empty retained observations in Contesting Test without polling blocked station or cluster services", async () => {
    mocks.worker.mockImplementation(async (method: string) => {
      if (method === "health") return { result: { mode: "contesting_test" } };
      if (method === "workspace_status") return { result: { workspace_exists: true } };
      if (method === "settings_load") return { result: { generation: "workspace", settings: { stationCall: "OM0RX" } } };
      throw new Error(`blocked service called: ${method}`);
    });
    render(React.createElement((await import("./DetachedContestSetupSurface")).DetachedContestSetupSurface));
    await waitFor(() => expect(mocks.worker).toHaveBeenCalledWith("settings_load", {}));
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalled());
    expect(mocks.workspace.mock.calls.at(-1)?.[0]).toMatchObject({ contestingTest: true });
    expect(mocks.station).not.toHaveBeenCalled();
    expect(mocks.worker.mock.calls.map(([method]) => method)).not.toContain("cluster_snapshot");
  });
});
