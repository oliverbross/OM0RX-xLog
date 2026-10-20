// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contestSetupWindowSize, fittedContestSetupWindowSize, loadContestStationSnapshot } from "./DetachedContestSetupSurface";
import type { RadioID, StationSession } from "../live/stationSession";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  station: vi.fn(),
}));

vi.mock("../worker", () => ({ workerRequest: mocks.worker, framedWorkerRequest: vi.fn() }));
vi.mock("../operatingModule", () => ({ operatingModuleStatus: vi.fn(async () => ({ context: "normal_logging" })) }));
vi.mock("../live/stationSession", async importOriginal => {
  const original = await importOriginal<typeof import("../live/stationSession")>();
  return { ...original, loadStationSession: mocks.station };
});
vi.mock("../live/workspaceNavigation", () => ({ connectWorkspaceNavigation: () => () => {}, isContestMenuRoute: () => false }));
vi.mock("./Not1MMContestWorkspace", () => ({ Not1MMContestWorkspace: () => null }));
vi.mock("./contestSpotTune", () => ({ tuneContestSpot: vi.fn() }));

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
  it("uses compact PDF-shaped sizes for setup workflows", () => {
    expect(contestSetupWindowSize(null)).toEqual({ width: 600, height: 360 });
    expect(contestSetupWindowSize("New Contest")).toEqual({ width: 560, height: 640 });
    expect(contestSetupWindowSize("Edit Current Contest")).toEqual({ width: 560, height: 640 });
    expect(contestSetupWindowSize("Choose a Contest")).toEqual({ width: 560, height: 420 });
    expect(contestSetupWindowSize("Edit Macros")).toEqual({ width: 880, height: 700 });
    expect(fittedContestSetupWindowSize(null, 300, 1_400)).toEqual({ width: 600, height: 360 });
    expect(fittedContestSetupWindowSize("New Contest", 846, 1_400)).toEqual({ width: 560, height: 870 });
    expect(fittedContestSetupWindowSize("Edit Keys", 1_600, 1_000)).toEqual({ width: 880, height: 936 });
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

  it("bootstraps through native station ownership and never calls raw station_snapshot", async () => {
    mocks.station.mockResolvedValue(session("radio1", "radio1", 14_025_000));
    mocks.worker.mockImplementation(async (method: string) => {
      if (method === "station_snapshot") throw new Error("raw station snapshot is forbidden");
      if (method === "workspace_status") return { result: { workspace_exists: true } };
      if (method === "settings_load") return { result: { generation: "workspace", settings: { stationCall: "OM0RX" } } };
      if (method === "cluster_snapshot") return { result: { snapshot: { spots: [] } } };
      throw new Error(`unexpected method ${method}`);
    });
    render(React.createElement((await import("./DetachedContestSetupSurface")).DetachedContestSetupSurface));
    await waitFor(() => expect(mocks.station).toHaveBeenCalledWith("radio1"));
    expect(mocks.worker.mock.calls.map(([method]) => method)).not.toContain("station_snapshot");
  });
});
