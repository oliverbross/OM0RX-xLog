// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LiveApp from "../src/LiveApp";
import { testWorkspaceGeneration } from "./operator-draft-fixture";
import type { DraftMutation, DraftSnapshot } from "../src/live/operatorDraftSession";

const calls = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: calls.request, openMonitor: vi.fn() }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await calls.request(method, params)).result }));
vi.mock("../src/Map", () => ({ default: () => <div>Map fixture</div> }));
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); calls.request.mockReset(); });

it("periodically merges measured power with unsaved notes and wires same-value manual intent and resume", async () => {
  localStorage.clear(); vi.useFakeTimers();
  const id = "power-draft", sessionID = "00000000-0000-4000-8000-000000000002";
  let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0,
    qso: { id, call: "K1ABC", start: "2026-10-12T00:00:00Z", band: "20m", mode: "CW", frequencyHz: 14_025_000, txPower: "100", notes: "", extraFields: {} },
    power: { revision: 0, enabled: true, fallback: "100", manualOverride: false, selectedValue: "100",
      contact: { workspaceID: testWorkspaceGeneration, draftID: id, call: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000 } } };
  const receipts = new Map<string, any>();
  calls.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "logbook_operator_draft") return { result: { draft: structuredClone(current), power_capture_status: "waiting" } };
    if (method === "logbook_operator_draft_receipt") return { result: { receipt: structuredClone(receipts.get(params.operationID) ?? null) } };
    if (method === "logbook_operator_draft_apply") {
      const mutation = params as DraftMutation, power = structuredClone(current.power!);
      if (mutation.expectedRevision !== current.revision) return { result: { status: "conflict", draft: structuredClone(current) } };
      if (mutation.action !== "replace") throw new Error("Unexpected draft action");
      if (mutation.powerIntent) {
        power.revision++; power.manualOverride = mutation.powerIntent.action === "manual";
        power.selectedValue = mutation.powerIntent.action === "manual" ? mutation.powerIntent.value : power.fallback;
        power.selectedSample = null; power.selectedContext = null; power.selectedContact = null;
      }
      current = { ...current, revision: current.revision + 1, power, qso: { ...mutation.qso!, txPower: power.selectedValue } };
      const receipt = { mutation: structuredClone(mutation), draft: structuredClone(current), savedQSO: null };
      receipts.set(mutation.operationID, receipt);
      return { result: { status: "applied", receipt } };
    }
    const result = method === "workspace_status" ? { workspace_exists: true, native_log_exists: false }
      : method === "settings_load" ? { settings: { stationCall: "", gridSquare: "", automaticTransmitPower: true, defaultPower: "100" } }
      : method === "workspace_preferences_load" ? { stored: false }
      : method === "station_snapshot" ? { source: "direct_agent", available: false, radio: null }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "logbook_stats" ? { stats: { qso_count: 0 } }
      : method === "lookup_call" ? { source: "No match" }
      : method === "logbook_previous" ? { qsos: [] }
      : method === "logbook_matrix" ? { cells: [] } : {};
    return { ok: true, result };
  });
  await act(async () => { render(<LiveApp />); });
  await act(async () => { fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Log QSO" })); });
  expect((screen.getByLabelText("TX power W") as HTMLInputElement).value).toBe("100");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "Unfinished note survives meter updates." } });
  const context = { providerID: "station-1", selectionID: "radio-1", sessionID, sessionStartedAt: "2026-10-14T00:00:00Z",
    source: "direct_agent" as const, meterSource: "kpa500_output" as const };
  current = { ...current, qso: { ...current.qso, txPower: "550" }, power: { ...current.power!, revision: 1, selectedValue: "550",
    selectedSample: { source: "kpa500_output", unit: "W", watts: 550, sessionID,
      observedAt: "2026-10-14T00:00:01Z", radioObservedAt: "2026-10-14T00:00:01Z", amplifierObservedAt: "2026-10-13T23:59:56Z", receivedAt: "2026-10-14T00:00:01Z" },
    selectedContext: context, selectedContact: structuredClone(current.power!.contact), lastContext: context } };
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect((screen.getByLabelText("TX power W") as HTMLInputElement).value).toBe("550");
  expect((screen.getByLabelText("QSO note") as HTMLTextAreaElement).value).toBe("Unfinished note survives meter updates.");
  expect(screen.getByText("Captured KPA500 output · retained for this contact.")).toBeTruthy();
  expect(screen.queryByText(/shared draft changed in another window/i)).toBeNull();
  fireEvent.input(screen.getByLabelText("TX power W"), { target: { value: "550" } });
  expect(JSON.parse(localStorage.getItem("xlog.integration.operatorDraft.main.v1")!).powerIntent).toEqual({ action: "manual", value: "550" });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(current.power?.manualOverride).toBe(true); expect(screen.getByText("Manual override.")).toBeTruthy();
  const manual = calls.request.mock.calls.filter(([method]) => method === "logbook_operator_draft_apply").at(-1)![1];
  expect(manual.powerIntent).toEqual({ action: "manual", value: "550" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use automatic" })); });
  expect(current.power?.manualOverride).toBe(false);
  expect((screen.getByLabelText("TX power W") as HTMLInputElement).value).toBe("100");
  expect((screen.getByLabelText("QSO note") as HTMLTextAreaElement).value).toBe("Unfinished note survives meter updates.");
  expect(screen.getByText("Default fallback · measured output unavailable.")).toBeTruthy();
});
