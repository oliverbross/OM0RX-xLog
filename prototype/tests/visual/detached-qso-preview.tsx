// Actual detached surface, isolated browser storage and memory-only native IPC.
// Unknown commands fail closed; no station, sync, files, credentials or network.
import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit, TauriEvent } from "@tauri-apps/api/event";
import type { DraftSnapshot } from "../../src/live/operatorDraftSession";
import "../../src/surfaceStyles";
import "../../src/live/live.css";
import "../../src/style.css";

const generation = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const initial = { id, call: "TEST0/P", start: "2026-10-14T01:20:30Z", end: null, band: "20m", mode: "CW",
  frequencyHz: 14_025_000, receiveFrequencyHz: null, rstSent: "599", rstReceived: "579", txPower: "100",
  name: "Synthetic fixture operator", country: "Synthetic country", dxcc: 1, continent: "EU", gridSquare: "JN88AA",
  cqZone: "15", ituZone: "28", qth: "Synthetic test location", notes: "Synthetic contact only. No live logbook or station access.",
  stationLocation: "Synthetic station", operatorCall: "TEST0", myCall: "TEST0", myGrid: "JN88AA",
  qslSent: "N", qslReceived: "N", lotwSent: "N", lotwReceived: "N", extraFields: { APP_FIXTURE: "SYNTHETIC ONLY" } };
let draft: DraftSnapshot = { revision: 0, generation, qso: structuredClone(initial), power: {
  revision: 0, enabled: true, fallback: "100", selectedValue: "100", manualOverride: false,
  contact: { workspaceID: generation, draftID: id, call: initial.call, band: "20m", mode: "CW", frequencyHz: initial.frequencyHz },
} };
const receipts = new Map<string, unknown>();
const contacts: unknown[] = [], requests: string[] = [];
let closed = false, docked = false;

function worker(method: string, params: Record<string, any> = {}) {
  requests.push(method);
  if (method === "logbook_operator_draft") return { draft: structuredClone(draft) };
  if (method === "logbook_operator_draft_receipt") return { receipt: structuredClone(receipts.get(params.operationID) ?? null) };
  if (method === "lookup_call") return { call: params.call, name: "Synthetic lookup operator", country: "Synthetic country", dxcc: 1,
    gridSquare: "JN88AA", source: "Synthetic readonly lookup", qth: "Synthetic test location" };
  if (method === "logbook_previous") return { qsos: [{ id: "fixture-previous", call: params.call,
    start: "2026-09-01T09:15:00Z", band: "20m", mode: "CW", qslReceived: "Y" }] };
  if (method === "logbook_matrix") return { cells: [{ band: "20m", mode: "CW", worked: true, confirmed: true }] };
  if (method === "cluster_history") return { history: { call: params.call, adif: params.adif,
    matrix: [{ band: "20m", mode: "CW", worked: true, confirmed: true }] } };
  if (method !== "logbook_operator_draft_apply") throw new Error(`Fixture forbids ${method}`);
  if (params.generation !== generation) return { status: "workspace_changed", generation };
  if (receipts.has(params.operationID)) return { status: "applied", receipt: structuredClone(receipts.get(params.operationID)) };
  if (params.expectedRevision !== draft.revision || params.draftID !== draft.qso.id) return { status: "conflict", draft: structuredClone(draft) };
  if (!["replace", "save", "clear"].includes(params.action)) throw new Error("Unsupported fixture draft action");
  const savedQSO = params.action === "save" ? structuredClone(draft.qso) : null;
  if (savedQSO) contacts.push(savedQSO);
  const qso = params.action === "replace" ? structuredClone(params.qso) : { ...structuredClone(initial), id: crypto.randomUUID(), call: "", notes: "" };
  const power = structuredClone(draft.power!);
  if (params.powerIntent || params.action !== "replace") {
    power.revision++; power.selectedSample = null; power.selectedContext = null; power.selectedContact = null;
    power.activeScope = null; power.sessionPeak = null; power.lastObservedAt = null;
  }
  if (params.powerIntent?.action === "manual") { power.manualOverride = true; power.selectedValue = params.powerIntent.value; }
  if (params.powerIntent?.action === "automatic" || params.action !== "replace") { power.manualOverride = false; power.selectedValue = power.fallback; }
  power.contact = { ...power.contact, draftID: qso.id, call: String(qso.call).trim().toUpperCase(), band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz };
  qso.txPower = power.selectedValue;
  draft = { revision: draft.revision + 1, generation, qso, power };
  const receipt = { mutation: structuredClone(params), draft: structuredClone(draft), savedQSO };
  receipts.set(params.operationID, receipt);
  return { status: "applied", receipt };
}

mockWindows("log-qso");
Object.assign(globalThis, { isTauri: true });
mockIPC((command, args) => {
  if (command === "worker_request") {
    const request = (args as Record<string, unknown>)?.request as { id: string; method: string; params: Record<string, any> };
    return { id: request.id, ok: true, result: worker(request.method, request.params) };
  }
  if (["spot_editor_register", "spot_activation_snapshot", "spot_activation_reconcile"].includes(command)) {
    return { operationId: null, phase: "idle", barrier: null };
  }
  if (command === "spot_editor_state") return { draft: structuredClone(draft) };
  if (["spot_editor_ack", "spot_editor_unregister"].includes(command)) return null;
  if (command === "dock_detached_window") { docked = true; return null; }
  if (command === "close_qso_window") { closed = true; return null; }
  throw new Error(`Fixture forbids native command ${command}`);
}, { shouldMockEvents: true });
localStorage.removeItem("xlog.integration.operatorDraft.log-qso.v1");
Object.assign(window, { qsoVisualFixture: {
  snapshot: () => structuredClone({ draft, contacts, requests, closed, docked }),
  requestClose: () => emit(TauriEvent.WINDOW_CLOSE_REQUESTED),
  wake: () => emit("xlog:operator-draft-changed"),
} });
const { DetachedQSOSurface } = await import("../../src/live/DetachedQSOSurface");
createRoot(document.getElementById("root")!).render(<React.StrictMode><DetachedQSOSurface /></React.StrictMode>);
