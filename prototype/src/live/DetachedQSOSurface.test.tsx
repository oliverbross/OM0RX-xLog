// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedQSOSurface, detachedQSOJournalKey } from "./DetachedQSOSurface";
import { testWorkspaceGeneration } from "../../tests/operator-draft-fixture";
import type { DraftMutation, DraftPowerState, DraftSnapshot } from "./operatorDraftSession";
import { loadWindowSurface } from "../windowSurface";

const api = vi.hoisted(() => ({ draft: vi.fn(), read: vi.fn(), invoke: vi.fn(), reconcile: vi.fn(), changes: vi.fn(), protect: vi.fn(), dock: vi.fn(),
  readiness: null as null | ((snapshot: any) => { ready: boolean }),
  refresh: null as (() => Promise<void>) | null, blocked: null as (() => boolean) | null, explain: null as (() => void) | null,
  closeState: null as ((value: boolean) => void) | null }));
vi.mock("./operatorDraftTransport", () => ({ requestOperatorDraft: api.draft }));
vi.mock("../worker", () => ({ workerRequest: api.read }));
vi.mock("./operatorDraftWindows", () => ({ connectOperatorDraftChanges: api.changes, protectOperatorDraftClose: api.protect }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => false }));
vi.mock("./useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: (_participants: any[], readiness: (snapshot: any) => { ready: boolean }) => { api.readiness = readiness; return {
  status: { phase: "uncertain", tuneConfirmed: false, rotor: "uncertain" }, error: "Global activation warning", reconcile: api.reconcile,
}; } }));

const copy = <T,>(value: T): T => structuredClone(value);
function backend() {
  const id = crypto.randomUUID();
  const qso = { id, call: "K1ABC", start: "2026-10-14T00:00:00Z", end: null, band: "20m", mode: "CW",
    frequencyHz: 14_025_000, txPower: "100", notes: "", name: "", rstSent: "599", rstReceived: "599", extraFields: { OTHER: "keep" } };
  const power: DraftPowerState = { revision: 0, enabled: true, fallback: "100", manualOverride: false, selectedValue: "100",
    contact: { workspaceID: testWorkspaceGeneration, draftID: id, call: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000 } };
  let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, qso, power };
  const receipts = new Map<string, any>(), contacts: any[] = [];
  const request = async (method: string, params: any = {}) => {
    if (method === "logbook_operator_draft") return { draft: copy(current) };
    if (params.generation !== current.generation) return { status: "workspace_changed", generation: current.generation };
    if (method === "logbook_operator_draft_receipt") return { receipt: copy(receipts.get(params.operationID) ?? null) };
    if (method !== "logbook_operator_draft_apply") throw new Error(`Unexpected ${method}`);
    const mutation = params as DraftMutation;
    if (receipts.has(mutation.operationID)) return { status: "applied", receipt: copy(receipts.get(mutation.operationID)) };
    if (mutation.draftID !== current.qso.id || mutation.expectedRevision !== current.revision) return { status: "conflict", draft: copy(current) };
    const savedQSO = mutation.action === "save" ? copy(current.qso) : null;
    if (savedQSO) contacts.push(savedQSO);
    const next = mutation.action === "replace" ? copy(mutation.qso!) : { ...qso, id: crypto.randomUUID(), call: "" };
    const nextPower = copy(current.power!);
    nextPower.contact = { workspaceID: testWorkspaceGeneration, draftID: next.id, call: String(next.call).trim().toUpperCase(),
      band: next.band, mode: next.mode, frequencyHz: next.frequencyHz };
    if (mutation.powerIntent || mutation.action !== "replace") {
      nextPower.revision++; nextPower.selectedSample = null; nextPower.selectedContext = null; nextPower.selectedContact = null;
      nextPower.activeScope = null; nextPower.sessionPeak = null; nextPower.lastObservedAt = null;
    }
    if (mutation.powerIntent?.action === "manual") { nextPower.manualOverride = true; nextPower.selectedValue = mutation.powerIntent.value; }
    if (mutation.powerIntent?.action === "automatic" || mutation.action !== "replace") { nextPower.manualOverride = false; nextPower.selectedValue = nextPower.fallback; }
    next.txPower = nextPower.selectedValue;
    current = { generation: testWorkspaceGeneration, revision: current.revision + 1, qso: next, power: nextPower };
    const receipt = { mutation: copy(mutation), draft: copy(current), savedQSO };
    receipts.set(mutation.operationID, receipt);
    return { status: "applied", receipt: copy(receipt) };
  };
  const meter = (watts: number) => {
    const sessionID = crypto.randomUUID(), time = "2026-10-14T00:00:01Z";
    const sample = { source: "kpa500_output" as const, unit: "W" as const, watts, sessionID,
      observedAt: time, radioObservedAt: time, receivedAt: time, amplifierObservedAt: time };
    const context = { providerID: "fixture", selectionID: "fixture", sessionID, sessionStartedAt: "2026-10-14T00:00:00Z",
      source: "direct_agent" as const, meterSource: "kpa500_output" as const };
    current = { ...current, qso: { ...current.qso, txPower: String(watts) }, power: { ...current.power!,
      revision: current.power!.revision + 1, selectedValue: String(watts), selectedSample: sample,
      selectedContext: context, selectedContact: copy(current.power!.contact), lastContext: context } };
  };
  return { request, contacts, meter, get current() { return current; }, change: (draft: DraftSnapshot) => { current = copy(draft); } };
}
function journal() { return JSON.parse(localStorage.getItem(detachedQSOJournalKey) || "null"); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); api.refresh = null; api.blocked = null; api.explain = null; api.closeState = null;
  api.changes.mockImplementation(refresh => { api.refresh = refresh; void refresh(); return vi.fn(); });
  api.protect.mockImplementation((blocked, explain, _failed, closeState) => { api.blocked = blocked; api.explain = explain; api.closeState = closeState; return vi.fn(); });
  api.dock.mockResolvedValue(undefined);
  api.reconcile.mockResolvedValue(true);
  api.read.mockImplementation(async (method, params) => ({ result: method === "lookup_call" ? { call: params.call, source: "Local fixture" }
    : method === "logbook_previous" ? { qsos: [] } : { cells: [] } }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(["Simple", "Full"])("flushes valid %s edits before a typed Read radio and reconciles the canonical result", async mode => {
  const f = backend(); api.draft.mockImplementation(f.request);
  api.invoke.mockImplementation(async (command, { operationId }) => {
    expect(command).toBe("operator_draft_read_radio");
    expect(f.current.qso.name).toBe("Keep operator text");
    f.change({ ...f.current, revision: f.current.revision + 1, qso: { ...f.current.qso, frequencyHz: 7_100_000, band: "40m", mode: "SSB" },
      power: { ...f.current.power!, contact: { ...f.current.power!.contact, frequencyHz: 7_100_000, band: "40m", mode: "SSB" } } });
    return { operationId, phase: "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" };
  });
  api.reconcile.mockImplementation(async () => { await api.refresh!(); return true; });
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  if (mode === "Simple") fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  fireEvent.change(screen.getByLabelText(mode === "Simple" ? "Desk Name" : "Name"), { target: { value: "Keep operator text" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(api.reconcile).toHaveBeenCalledOnce());
  await screen.findByDisplayValue("7.100000");
  expect(api.invoke).toHaveBeenCalledOnce();
  expect(api.invoke.mock.calls[0][1].operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(api.read.mock.calls.some(([method]) => method === "station_snapshot")).toBe(false);
  expect(screen.queryByText("Follow radio")).toBeNull();
  expect(f.current.qso.name).toBe("Keep operator text");
});

it.each(["Simple", "Full"])("retains unfinished %s buffers without invoking Read radio", async mode => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  if (mode === "Simple") fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  const field = screen.getByLabelText(mode === "Simple" ? "Desk Frequency MHz" : "Frequency MHz");
  fireEvent.change(field, { target: { value: "14.0250007" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Finish the draft fields and resolve pending QSO changes before reading/);
  expect(api.invoke).not.toHaveBeenCalled(); expect((field as HTMLInputElement).value).toBe("14.0250007");
});

it("retains an uncertain Read radio operation and never creates a retry operation", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  api.invoke.mockRejectedValue(new Error("Read reply lost; check activation"));
  const view = render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText("Read reply lost; check activation");
  expect(api.blocked!()).toBe(true);
  view.unmount(); render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Check the existing Read radio activation before reading again/);
  expect(api.invoke).toHaveBeenCalledOnce();
  const journal = JSON.parse(localStorage.getItem(`${detachedQSOJournalKey}.readRadio`)!);
  expect(api.readiness?.({ operationId: crypto.randomUUID(), phase: "preparing" }).ready).toBe(false);
  expect(api.readiness?.({ operationId: journal.operationId, phase: "preparing" }).ready).toBe(true);
});

it("retains detached Read radio recovery when canonical editor reconciliation fails", async () => {
  const f = backend(); api.draft.mockImplementation(f.request); api.reconcile.mockResolvedValue(false);
  api.invoke.mockImplementation(async (_command, { operationId }) => ({ operationId, phase: "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" }));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Read radio editor reconciliation is incomplete/);
  expect(api.blocked!()).toBe(true);
  expect(localStorage.getItem(`${detachedQSOJournalKey}.readRadio`)).not.toBeNull();
});

it.each(["confirmed", "blocked"])("recovers a detached %s receipt after native status reset without another read", async phase => {
  const f = backend(); api.draft.mockImplementation(f.request);
  const operationId = crypto.randomUUID();
  localStorage.setItem(`${detachedQSOJournalKey}.readRadio`, JSON.stringify({ operationId, generation: testWorkspaceGeneration }));
  api.invoke.mockImplementation(async (command, params) => {
    expect(command).toBe("operator_draft_read_radio_recover"); expect(params).toEqual({ operationId, generation: testWorkspaceGeneration });
    return { operationId, phase, reservationActive: false, tuneConfirmed: false, rotor: "not-requested" };
  });
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Check Read radio" }));
  await waitFor(() => expect(localStorage.getItem(`${detachedQSOJournalKey}.readRadio`)).toBeNull());
  expect(api.invoke).toHaveBeenCalledOnce(); expect(api.blocked!()).toBe(false);
});

it("vetoes Read radio when the workspace changes during its edit flush", async () => {
  const f = backend();
  api.draft.mockImplementation(async (method, params) => {
    const result = await f.request(method, params);
    if (method === "logbook_operator_draft_apply") return { ...result, receipt: { ...result.receipt, draft: { ...result.receipt.draft, generation: crypto.randomUUID() } } };
    return result;
  });
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "retained" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(api.draft.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "Read radio" }).textContent).toBe(" Read radio"));
  expect(api.invoke).not.toHaveBeenCalled();
});

it.each(["mismatched", "uncertain"])("keeps a %s native outcome protected without issuing a new operation", async outcome => {
  const f = backend(); api.draft.mockImplementation(f.request);
  api.invoke.mockImplementation(async (_command, { operationId }) => ({ operationId: outcome === "mismatched" ? crypto.randomUUID() : operationId,
    phase: outcome === "uncertain" ? "uncertain" : "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" }));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(outcome === "mismatched" ? /Read radio outcome could not be verified/ : /Read radio was not confirmed/);
  expect(api.blocked!()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Check the existing Read radio activation before reading again/);
  expect(api.invoke).toHaveBeenCalledOnce();
  expect(api.reconcile).toHaveBeenCalledTimes(outcome === "uncertain" ? 1 : 0);
});

it("loads the canonical full editor with read-only context, no main controller, and closes an acknowledged draft", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  const Surface = await loadWindowSurface("?view=log-qso");
  const view = render(<Surface />);
  await screen.findByDisplayValue("K1ABC");
  expect(screen.getByRole("main", { name: "Detached Log QSO" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check activation" })).toBeNull();
  expect(document.querySelector(".station-rail")).toBeNull();
  expect(document.querySelector(".qso-editor")).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Contact context" })).toBeNull();
  expect(screen.queryByText("Previous QSOs")).toBeNull();
  expect(screen.queryByText("Callsign intelligence")).toBeNull();
  expect(screen.getByRole("button", { name: "Full" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(screen.queryByText("Follow radio")).toBeNull(); expect(screen.getByRole("button", { name: /Read radio/i })).toBeTruthy();
  expect(api.blocked!()).toBe(false);
  expect(api.changes.mock.invocationCallOrder[0]).toBeLessThan(api.draft.mock.invocationCallOrder[0]);
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1")).toBeNull();
  await waitFor(() => expect(api.read.mock.calls.some(([method]) => method === "lookup_call")).toBe(true));
  await waitFor(() => expect(api.read).toHaveBeenCalledWith("logbook_duplicate", { call: "K1ABC", band: "20m", mode: "CW" }));
  expect(api.read.mock.calls.every(([method]) => ["lookup_call", "logbook_previous", "logbook_duplicate", "logbook_matrix", "cluster_history"].includes(method))).toBe(true);
  expect(api.dock).not.toHaveBeenCalled();
  view.unmount();
  expect(api.changes.mock.results[0].value).toHaveBeenCalledOnce(); expect(api.protect.mock.results[0].value).toHaveBeenCalledOnce();
});

it("journals and autosaves notes, blocking Close/Dock until the exact Replace is acknowledged", async () => {
  const f = backend(), held = deferred<void>();
  api.draft.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply") await held.promise;
    return f.request(method, params);
  });
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "retained note" } });
  expect(journal().draft.notes).toBe("retained note"); expect(api.blocked!()).toBe(true);
  act(() => api.explain!()); expect(api.dock).not.toHaveBeenCalled();
  await screen.findByText(/Finish the draft fields/);
  await waitFor(() => expect(journal().pending?.action).toBe("replace"));
  expect(api.blocked!()).toBe(true);
  await act(async () => { held.resolve(); });
  await waitFor(() => expect(api.blocked!()).toBe(false));
  expect(f.current.qso.notes).toBe("retained note"); expect(f.current.qso.extraFields).toEqual({ OTHER: "keep" });
});

it("switches Simple and Full over one draft, retaining hidden fields and saving exactly once", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "full-only note" } });
  fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  expect(screen.getByRole("button", { name: "Simple" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByLabelText("QSO note")).toBeNull();
  expect(screen.getByRole("button", { name: /Read radio/i })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Desk Name"), { target: { value: "Simple operator" } });
  const id = journal().draft.id;
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Simple operator");
  expect((screen.getByLabelText("QSO note") as HTMLTextAreaElement).value).toBe("full-only note");
  expect(journal().draft.id).toBe(id);
  fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  await waitFor(() => expect(api.blocked!()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  await waitFor(() => expect(f.contacts).toHaveLength(1));
  expect(f.contacts[0]).toMatchObject({ id, notes: "full-only note", name: "Simple operator", extraFields: { OTHER: "keep" } });
  expect(api.protect).toHaveBeenCalledOnce();
});

it.each(["Simple", "Full"])("shows one brief overlay after an acknowledged save in %s", async mode => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  if (mode === "Simple") fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Log QSO" })); });
  expect(f.contacts).toHaveLength(1);
  expect(screen.getAllByText("QSO logged")).toHaveLength(1);
  expect(document.querySelector(".qso-feedback-area > .qso-logged-toast")).toBeTruthy();
  expect(screen.queryByText(/saved to the local logbook/)).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByText("QSO logged")).toBeNull();
  expect(screen.queryByText("Global activation warning")).toBeNull();
});

it.each([
  ["full", "Frequency MHz", "14.", "14.025000"],
  ["full", "Start UTC date", "", "2026-10-14"],
  ["full", "Start UTC time", "", "00:00:00"],
  ["full", "RX frequency MHz", "14.", ""],
  ["full", "DXCC", "-1", ""],
  ["simple", "Desk Frequency MHz", "14.0250007", "14.025000"],
  ["simple", "Desk UTC date", "", "2026-10-14"],
  ["simple", "Desk UTC time", "", "00:00:00"],
])("keeps unfinished %s %s text mounted when switching modes", async (mode, label, unfinished, restored) => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  if (mode === "simple") fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  const destination = mode === "simple" ? "Full" : "Simple";
  fireEvent.change(screen.getByLabelText(label), { target: { value: unfinished } });
  fireEvent.click(screen.getByRole("button", { name: destination }));
  expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(unfinished);
  expect(screen.getByRole("button", { name: destination }).getAttribute("aria-pressed")).toBe("false");
  expect(api.blocked!()).toBe(true);
  expect(screen.getByText("Finish the buffered fields before changing editor modes.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(label), { target: { value: restored } });
  await waitFor(() => expect(api.blocked!()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: destination }));
  expect(screen.getByRole("button", { name: destination }).getAttribute("aria-pressed")).toBe("true");
});

it("retains explicit lookup Fill in Simple without overwriting entered fields", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  api.read.mockImplementation(async (method, params) => ({ result: method === "lookup_call"
    ? { call: params.call, name: "Lookup operator", country: "United States", dxcc: 291 } : { cells: [] } }));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  fireEvent.change(screen.getByLabelText("Desk Name"), { target: { value: "Entered operator" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill empty fields from lookup" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Fill empty fields from lookup" }));
  expect(journal().draft).toMatchObject({ name: "Entered operator", country: "United States", dxcc: 291 });
  expect(screen.queryByText("Previous QSOs")).toBeNull();
});

it("retains an uncertain Save across remount and checks its receipt without creating a second QSO", async () => {
  const f = backend(); let lose = true, receiptAvailable = false;
  api.draft.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_receipt" && !receiptAvailable) throw new Error("Receipt transport unavailable");
    const result = await f.request(method, params);
    if (method === "logbook_operator_draft_apply" && params.action === "save" && lose) { lose = false; throw new Error("Lost acknowledgement"); }
    return result;
  });
  const first = render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  await waitFor(() => expect(journal().pending?.action).toBe("save"));
  await screen.findByText(/Draft acknowledgement unavailable/);
  expect(f.contacts).toHaveLength(1); expect(api.blocked!()).toBe(true);
  const operation = journal().pending.operationID;
  receiptAvailable = true;
  first.unmount(); render(<DetachedQSOSurface />);
  await waitFor(() => expect(journal().pending).toBeNull());
  expect(f.contacts).toHaveLength(1); expect(api.blocked!()).toBe(false);
  expect(api.draft.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1);
  expect(api.draft).toHaveBeenCalledWith("logbook_operator_draft_receipt", expect.objectContaining({ operationID: operation }));
});

it("retains local text on another-window conflict and requires explicit shared-draft recovery", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "my text" } });
  f.change({ ...f.current, revision: 1, qso: { ...f.current.qso, notes: "other window" } });
  await act(async () => { await api.refresh!(); });
  await screen.findByText(/local text is retained/);
  expect(screen.getByLabelText("QSO note").getAttribute("value") ?? (screen.getByLabelText("QSO note") as HTMLTextAreaElement).value).toBe("my text");
  expect(api.blocked!()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use shared draft" }));
  await screen.findByDisplayValue("other window"); expect(api.blocked!()).toBe(false);
});

it("sends explicit same/blank manual power intents and resumes canonical automatic power", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.input(screen.getByLabelText("TX power W"), { target: { value: "100" } });
  expect(journal().powerIntent).toEqual({ action: "manual", value: "100" });
  fireEvent.input(screen.getByLabelText("TX power W"), { target: { value: "" } });
  expect(journal().powerIntent).toEqual({ action: "manual", value: "" });
  await waitFor(() => expect(f.current.power?.manualOverride).toBe(true));
  expect(f.current.qso.txPower).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Use automatic" }));
  await waitFor(() => expect(f.current.power?.manualOverride).toBe(false));
  expect(f.current.qso.txPower).toBe("100");
  expect(api.draft.mock.calls.some(([method, params]) => method === "logbook_operator_draft_apply" && params.powerIntent?.action === "automatic")).toBe(true);
});

it("merges native power-only wake updates without replacing dirty notes or issuing station work", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "typing through power" } });
  f.meter(550);
  await act(async () => { await api.refresh!(); });
  expect((screen.getByLabelText("QSO note") as HTMLTextAreaElement).value).toBe("typing through power");
  expect((screen.getByLabelText("TX power W") as HTMLInputElement).value).toBe("550");
  expect(screen.queryByRole("button", { name: "Use shared draft" })).toBeNull();
  await waitFor(() => expect(f.current.qso.notes).toBe("typing through power"));
  expect(f.current.qso.txPower).toBe("550");
});

it("protects incomplete editor-only buffers and clears idempotently through the shared draft", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14." } });
  expect(api.blocked!()).toBe(true);
  act(() => api.explain!()); expect(api.dock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14.025000" } });
  await waitFor(() => expect(api.blocked!()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" }));
  await waitFor(() => expect(f.current.qso.call).toBe(""));
  expect(f.contacts).toHaveLength(0);
  expect(api.draft.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "clear")).toHaveLength(1);
});

it("fences restored-workspace responses and disables the old editor until explicit review", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  f.change({ ...f.current, generation: crypto.randomUUID(), qso: { ...f.current.qso, notes: "restored workspace" } });
  await act(async () => { await api.refresh!(); });
  await screen.findByRole("button", { name: "Load current workspace draft" });
  expect(api.blocked!()).toBe(true);
  expect(screen.getByRole("button", { name: "Log QSO" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Load current workspace draft" }));
  await screen.findByDisplayValue("restored workspace");
  await waitFor(() => expect(api.blocked!()).toBe(false));
  expect(api.draft.mock.calls.every(([method]) => method !== "logbook_operator_draft_apply")).toBe(true);
});

it("does not apply a delayed old-call lookup or history to the new shared contact", async () => {
  const f = backend(), oldLookup = deferred<Record<string, any>>(); api.draft.mockImplementation(f.request);
  api.read.mockImplementation(async (method, params) => ({ result: method === "lookup_call"
    ? params.call === "K1ABC" ? await oldLookup.promise : { call: params.call, name: "Current operator", source: "Fixture" }
    : method === "logbook_previous" ? { qsos: [] } : { cells: [] } }));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  await waitFor(() => expect(api.read).toHaveBeenCalledWith("lookup_call", { call: "K1ABC" }));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "JA1ABC" } });
  await act(async () => { oldLookup.resolve({ call: "K1ABC", name: "Old operator", country: "Old country" }); });
  await waitFor(() => expect(api.read).toHaveBeenCalledWith("lookup_call", { call: "JA1ABC" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill empty fields from lookup" }).hasAttribute("disabled")).toBe(false));
  expect(screen.queryByDisplayValue("Old operator")).toBeNull();
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("JA1ABC");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Fill empty fields from lookup" }));
  await waitFor(() => expect(f.current.qso.name).toBe("Current operator"));
  expect(f.current.qso.call).toBe("JA1ABC");
});

it("keeps delayed lookup display-only after close approval while explicit Fill remains available", async () => {
  const f = backend(), lookup = deferred<Record<string, any>>(); api.draft.mockImplementation(f.request);
  api.read.mockImplementation(async (method, params) => ({ result: method === "lookup_call" ? await lookup.promise
    : method === "logbook_previous" ? { qsos: [] } : { cells: [] } }));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  await waitFor(() => expect(api.read).toHaveBeenCalledWith("lookup_call", { call: "K1ABC" }));
  expect(api.blocked!()).toBe(false);
  await act(async () => { lookup.resolve({ call: "K1ABC", name: "Late operator", source: "Fixture" }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill empty fields from lookup" }).hasAttribute("disabled")).toBe(false));
  expect(api.blocked!()).toBe(false); expect(f.current.qso.name).toBe("");
  expect(api.draft.mock.calls.every(([method]) => method !== "logbook_operator_draft_apply")).toBe(true);
  const fill = screen.getByRole("button", { name: "Fill empty fields from lookup" });
  expect(fill.hasAttribute("disabled")).toBe(false);
  fireEvent.click(fill);
  expect(api.blocked!()).toBe(true);
  await waitFor(() => expect(f.current.qso.name).toBe("Late operator"));
  expect(api.blocked!()).toBe(false);
});

it.each([
  ["Start UTC date", "", "2026-10-14"],
  ["Start UTC time", "", "00:00:00"],
  ["DXCC", "-1", ""],
])("protects unfinished '%s' text that has not entered the canonical draft", async (label, incomplete, restored) => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  const before = copy(f.current.qso);
  fireEvent.change(screen.getByLabelText(label), { target: { value: incomplete } });
  expect(api.blocked!()).toBe(true); expect(f.current.qso).toEqual(before);
  act(() => api.explain!()); expect(api.dock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(label), { target: { value: restored } });
  await waitFor(() => expect(api.blocked!()).toBe(false));
});

it("defers a remote Clear wake while unfinished editor-only text is retained", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14." } });
  const readCount = api.draft.mock.calls.filter(([method]) => method === "logbook_operator_draft").length;
  const nextID = crypto.randomUUID();
  f.change({ ...f.current, revision: 1, qso: { ...f.current.qso, id: nextID, call: "" },
    power: { ...f.current.power!, contact: { ...f.current.power!.contact, draftID: nextID, call: "" } } });
  await act(async () => { await api.refresh!(); });
  expect(api.draft.mock.calls.filter(([method]) => method === "logbook_operator_draft")).toHaveLength(readCount);
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("14.");
  expect(api.blocked!()).toBe(true);
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14.025000" } });
  await act(async () => { await api.refresh!(); });
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
});

it("rejects an already-in-flight identity replacement when an unfinished buffer appears", async () => {
  const f = backend(), held = deferred<any>(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  api.draft.mockImplementation((method, params) => method === "logbook_operator_draft" ? held.promise : f.request(method, params));
  let refresh!: Promise<void>;
  await act(async () => { refresh = api.refresh!(); });
  fireEvent.change(screen.getByLabelText("Start UTC date"), { target: { value: "" } });
  const nextID = crypto.randomUUID(), next = { ...f.current, revision: 1, qso: { ...f.current.qso, id: nextID, call: "" },
    power: { ...f.current.power!, contact: { ...f.current.power!.contact, draftID: nextID, call: "" } } };
  await act(async () => { held.resolve({ draft: next }); await expect(refresh).rejects.toThrow("Finish the draft fields"); });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect((screen.getByLabelText("Start UTC date") as HTMLInputElement).value).toBe("");
  expect(api.blocked!()).toBe(true);
});

it("leaves window navigation to the native lifecycle and keeps close protection registered", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  expect(screen.queryByRole("button", { name: /Show Desk|Dock back|Close window/ })).toBeNull();
  expect(api.protect).toHaveBeenCalledOnce(); expect(api.blocked!()).toBe(false);
  expect(api.dock).not.toHaveBeenCalled();
});

it("freezes immediately on approved Close and thaws only after native close failure", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  expect(api.blocked!()).toBe(false);
  act(() => api.closeState!(true));
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "close race" } });
  fireEvent.input(screen.getByLabelText("TX power W"), { target: { value: "900" } });
  expect(journal().draft.notes).toBe(""); expect(journal().powerIntent).toBeUndefined();
  expect(document.querySelector(".qso-editor-main form")?.hasAttribute("inert")).toBe(true);
  act(() => api.closeState!(false));
  fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "retained after failed close" } });
  expect(journal().draft.notes).toBe("retained after failed close");
});

it.each([
  ["Frequency MHz", "14.026", "frequencyHz", 14_027_000, "14.027000"],
  ["RX frequency MHz", "14.026", "receiveFrequencyHz", 14_027_000, "14.027000"],
  ["Start UTC date", "2026-10-15", "start", "2026-10-16T00:00:00Z", "2026-10-16"],
  ["Start UTC time", "00:01:00", "start", "2026-10-14T00:02:00Z", "00:02:00"],
  ["DXCC", "281", "dxcc", 339, "339"],
])("replaces acknowledged '%s' buffers when another window changes the same draft ID", async (label, entered, key, changed, visible) => {
  const f = backend(); api.draft.mockImplementation(f.request);
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText(label), { target: { value: entered } });
  await waitFor(() => expect(api.blocked!()).toBe(false));
  const remoteQSO = { ...f.current.qso, [key]: changed };
  f.change({ ...f.current, revision: f.current.revision + 1, qso: remoteQSO,
    power: { ...f.current.power!, contact: { ...f.current.power!.contact, frequencyHz: remoteQSO.frequencyHz } } });
  await act(async () => { await api.refresh!(); });
  await waitFor(() => expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(visible));
  expect(api.blocked!()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  await waitFor(() => expect(f.contacts).toHaveLength(1));
  expect(f.contacts[0][key]).toBe(changed);
});
