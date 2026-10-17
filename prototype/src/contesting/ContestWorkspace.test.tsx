// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestDraftSnapshot, ContestRequest, ContestRuleMetadata, ContestSessionSummary } from "./types";

const rules: ContestRuleMetadata[] = [
  { identity: { id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "contest-sw@1" }, displayName: "CQ WW CW", mode: "CW", referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Pilot comparison pending" },
  { identity: { id: "cq-wpx-cw", version: "2026.2", edition: "2026", sourceRevision: "contest-sw@2" }, displayName: "CQ WPX CW", mode: "CW", referenceDataVersion: "cty-2026.10", sourceVerification: "verified", sourceNote: "Fixture checked" },
];
const sessions: ContestSessionSummary[] = rules.map((rule, index) => ({ sessionID: `session-${index + 1}`, workspaceGeneration: "generation-1", revision: 1, name: index ? "WPX May" : "WW November", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 0, updatedAt: "2026-10-17T01:00:00Z" }));
function draftFor(session: ContestSessionSummary, callsign = "") : ContestDraftSnapshot { return { draftID: `draft-${session.sessionID}`, sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, reservedSerial: null, updatedAt: "2026-10-17T01:00:00Z", fields: { callsign, sentReport: "599", sentExchange: session.rule.identity.id === "cq-ww-cw" ? "15" : "001", receivedReport: "599", receivedExchange: callsign ? "05" : "", frequencyHz: 14025000, band: "20m", mode: "CW" }, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Not worked on 20m." } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

function fixture(options: { firstApply?: Promise<void>; firstApplyReject?: boolean; commit?: Promise<void>; loseCreate?: boolean; staleApply?: boolean; openDelay?: Record<string, Promise<void>>; openGenerationMismatch?: string } = {}) {
  const state = new Map(sessions.map(item => [item.sessionID, { session: { ...item }, draft: draftFor(item) }]));
  const calls: [string, Record<string, unknown>][] = []; let sequence = 0, applyCount = 0, createLost = false;
  const receipt = (params: Record<string, unknown>, revision: number) => ({ requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: revision, committedAt: "2026-10-17T02:00:00Z" });
  const request: ContestRequest = vi.fn(async (method, params = {}) => {
    calls.push([method, params]); const ok = (result: unknown) => ({ id: `frame-${++sequence}`, ok: true as const, result });
    if (method === "contest_catalog") return ok({ workspaceGeneration: "generation-1", rules });
    if (method === "contest_sessions") return ok({ sessions: [...state.values()].map(x => x.session) });
    if (method === "contest_open" || method === "contest_draft_get") {
      const id = params.sessionID as string; await options.openDelay?.[id]; const value = state.get(id)!;
      if (method === "contest_open" && options.openGenerationMismatch === id) return ok({ session: { ...value.session, workspaceGeneration: "generation-B" }, draft: { ...value.draft, workspaceGeneration: "generation-B" } });
      return ok(value);
    }
    if (method === "contest_create") {
      if (options.loseCreate && !createLost) { createLost = true; throw new Error("reply lost"); }
      const payload = params.payload as Record<string, unknown>, identity = payload.ruleIdentity as ContestRuleMetadata["identity"];
      const rule = rules.find(x => x.identity.id === identity.id)!; const sessionID = params.sessionID as string;
      const session: ContestSessionSummary = { ...sessions[0], sessionID, name: payload.name as string, rule, referenceDataVersion: payload.referenceDataVersion as string, station: payload.station as ContestSessionSummary["station"], operator: payload.operator as ContestSessionSummary["operator"], revision: 1 };
      const value = { session, draft: draftFor(session), receipt: receipt(params, 1) }; state.set(sessionID, { session, draft: value.draft }); return ok(value);
    }
    const current = state.get(params.sessionID as string)!;
    if (method === "contest_draft_apply") {
      if (applyCount++ === 0) { await options.firstApply; if (options.firstApplyReject) throw new Error("draft reply lost"); }
      if (options.staleApply) return { id: "frame", ok: false as const, error: { code: "stale_revision", message: "Draft changed elsewhere.", outcome: "confirmed" as const } };
      const fields = (params.payload as { fields: ContestDraftSnapshot["fields"] }).fields, revision = current.session.revision + 1;
      current.session = { ...current.session, revision }; current.draft = { ...current.draft, revision, fields };
      return ok({ ...current, receipt: receipt(params, revision) });
    }
    if (method === "contest_serial_reserve") { const revision = current.session.revision + 1; current.session = { ...current.session, revision }; current.draft = { ...current.draft, revision, reservedSerial: 1 }; return ok({ ...current, receipt: receipt(params, revision) }); }
    if (method === "contest_qso_commit") {
      await options.commit; const old = current.draft, revision = current.session.revision + 1; current.session = { ...current.session, revision, qsoCount: current.session.qsoCount + 1 }; current.draft = draftFor(current.session);
      return ok({ ...current, qso: { qsoID: `qso-${revision}`, sessionID: current.session.sessionID, workedAt: "2026-10-17T02:00:00Z", callsign: old.fields.callsign, band: old.fields.band, mode: "CW", sentExchange: old.fields.sentExchange, receivedExchange: old.fields.receivedExchange, points: 3, multiplier: "K", isDupe: false }, score: score(current.session), receipt: receipt(params, revision) });
    }
    if (method === "contest_operation_receipt") return ok({ status: "not_found" });
    if (method === "contest_log_page") return ok({ sessionID: current.session.sessionID, workspaceGeneration: current.session.workspaceGeneration, revision: params.expectedRevision, qsos: [], total: current.session.qsoCount, offset: params.offset, limit: params.limit });
    if (method === "contest_score") return ok({ ...score(current.session), revision: params.expectedRevision });
    throw new Error(`Unexpected ${method}`);
  }) as ContestRequest;
  return { request, calls, state };
}
function score(session: ContestSessionSummary) { return { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: session.qsoCount, points: session.qsoCount * 3, multipliers: session.qsoCount, claimedScore: session.qsoCount * 3, multiplierLabels: session.qsoCount ? ["K"] : [], sourceVerification: "provisional" as const }; }
function ids() { let value = 0; return () => `id-${++value}`; }
const digest = async (payload: unknown) => `digest:${JSON.stringify(payload)}`;
afterEach(cleanup);

async function open(request: ContestRequest, storage = new MemoryContestRecoveryStorage()) {
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ })); await screen.findByRole("form", { name: "CW contest entry" }); return view;
}

it("drains edits made during a delayed save before an immediate Log", async () => {
  const gate = deferred(), { request, calls, state } = fixture({ firstApply: gate.promise }); await open(request);
  const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1A" } });
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_draft_apply")).toHaveLength(1));
  fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" }));
  await act(async () => gate.resolve());
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_qso_commit")).toHaveLength(1));
  expect(calls.filter(([m]) => m === "contest_draft_apply").map(([,p]) => ((p.payload as {fields: ContestDraftSnapshot["fields"]}).fields.callsign))).toEqual(["K1A", "K1ABC"]);
  expect(state.get("session-1")!.session.qsoCount).toBe(1);
});

it("blocks session context changes until a delayed commit settles", async () => {
  const gate = deferred(), { request, calls } = fixture({ commit: gate.promise }); await open(request);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } }); await waitFor(() => expect(calls.some(([m]) => m === "contest_draft_apply")).toBe(true));
  fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" })); await waitFor(() => expect(calls.some(([m]) => m === "contest_qso_commit")).toBe(true));
  const manager = screen.getByRole("button", { name: "Contest Manager" }) as HTMLButtonElement; expect(manager.disabled).toBe(true); fireEvent.click(manager);
  expect(calls.some(([m,p]) => m === "contest_open" && p.sessionID === "session-2")).toBe(false);
  await act(async () => gate.resolve()); await screen.findByText(/Logged K1ABC/); expect(screen.getByRole("heading", { name: /CQ WW CW/ })).toBeTruthy();
});

it("rejects an old mount's delayed open after a remount opens another session", async () => {
  const gate = deferred(), { request, calls } = fixture({ openDelay: { "session-1": gate.promise } });
  const first = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(calls.some(([method, params]) => method === "contest_open" && params.sessionID === "session-1")).toBe(true)); first.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WPX May"); fireEvent.click(screen.getByRole("button", { name: /WPX May/ })); await screen.findByRole("heading", { name: /CQ WPX CW · WPX May/ });
  await act(async () => gate.resolve());
  await waitFor(() => expect(screen.getByRole("heading", { name: /CQ WPX CW · WPX May/ })).toBeTruthy());
  expect(screen.queryByRole("heading", { name: /CQ WW CW · WW November/ })).toBeNull();
});

it("rejects an open response from another workspace generation without activation or journaling", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ openGenerationMismatch: "session-1" });
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await screen.findByText("Malformed or stale contest_open response.");
  expect(screen.queryByRole("form", { name: "CW contest entry" })).toBeNull();
  expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(false);
  expect(storage.getItem("xlog.contesting.local-test-workspace.v2:generation-B")).toBeNull();
});

it("pins lost create across double submit and remount recovery", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ loseCreate: true });
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>); await screen.findByRole("option", { name: "CQ WW CW · 2026" });
  for (const [label, value] of [["Session name","WW Test"],["Station callsign","OM0RX"],["Operator callsign","OM0RX"],["CQ zone","15"],["DXCC entity","Slovak Republic"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const button = screen.getByRole("button", { name: "Create and open" }); fireEvent.click(button); fireEvent.click(button); await screen.findByText("Save status unknown");
  expect(calls.filter(([m]) => m === "contest_create")).toHaveLength(1); const original = calls.find(([m]) => m === "contest_create")![1];
  view.unmount(); render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>); await screen.findByText("Save status unknown"); fireEvent.click(screen.getByRole("button", { name: "Retry same operation" }));
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_create")).toHaveLength(2)); expect(calls.filter(([m]) => m === "contest_create")[1][1]).toEqual(original);
});

it("recovers an unflushed edit after remount and pumps it to the backend", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, state, calls } = fixture();
  const view = await open(request, storage);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  view.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(state.get("session-1")!.draft.fields.callsign).toBe("K1ABC"));
  expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("keeps one shared in-flight draft operation across unmount and remount", async () => {
  const gate = deferred(), storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ firstApply: gate.promise });
  const view = await open(request, storage); fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1)); view.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("Save in progress"); expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
  await act(async () => gate.resolve()); await waitFor(() => expect(screen.queryByText("Save in progress")).toBeNull());
  expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("does not mint a second draft operation when the first reply is lost before the next timer", async () => {
  const gate = deferred(), { request, calls } = fixture({ firstApply: gate.promise, firstApplyReject: true }); await open(request);
  const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1A" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1));
  fireEvent.change(call, { target: { value: "K1ABC" } }); await act(async () => gate.resolve()); await screen.findByText("Save status unknown");
  await new Promise(resolve => setTimeout(resolve, 240)); expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("preserves a recovered draft for session A while opening B after a restart", async () => {
  const storage = new MemoryContestRecoveryStorage(), first = fixture(); const view = await open(first.request, storage);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } }); view.unmount();
  const restarted = fixture(); render(<ContestWorkspace request={restarted.request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WPX May"); fireEvent.click(screen.getByRole("button", { name: /WPX May/ })); await screen.findByRole("form", { name: "CW contest entry" });
  fireEvent.click(screen.getByRole("button", { name: "Contest Manager" })); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(restarted.state.get("session-1")!.draft.fields.callsign).toBe("K1ABC"));
});

it("preserves invalid frequency text through an unrelated delayed draft revision and resets it on context switch", async () => {
  const gate = deferred(), { request, calls } = fixture({ firstApply: gate.promise }); await open(request);
  const frequency = screen.getByLabelText("Frequency Hz") as HTMLInputElement; fireEvent.change(frequency, { target: { value: "abc" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1)); await act(async () => gate.resolve());
  await waitFor(() => expect((screen.getByLabelText("Frequency Hz") as HTMLInputElement).value).toBe("abc"));
  fireEvent.click(screen.getByRole("button", { name: "Contest Manager" })); fireEvent.click(screen.getByRole("button", { name: /WPX May/ }));
  await waitFor(() => expect((screen.getByLabelText("Frequency Hz") as HTMLInputElement).value).toBe("14025000"));
  expect(screen.queryByText("Frequency must contain digits only.")).toBeNull();
});

it("keeps confirmed stale edits visible and offers refresh instead of uncertainty", async () => {
  const { request } = fixture({ staleApply: true }); await open(request); const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1ABC" } });
  await screen.findByText("Draft changed elsewhere."); expect(screen.queryByText("Save status unknown")).toBeNull(); expect((call as HTMLInputElement).value).toBe("K1ABC"); expect(screen.getByRole("button", { name: "Refresh draft" })).toBeTruthy();
});

it("keeps invalid frequency text editable without sending a transformed value", async () => {
  const { request, calls } = fixture(); await open(request); const before = calls.filter(([m]) => m === "contest_draft_apply").length;
  const frequency = screen.getByLabelText("Frequency Hz") as HTMLInputElement; fireEvent.change(frequency, { target: { value: "abc" } }); expect(frequency.value).toBe("abc"); await screen.findByText("Frequency must contain digits only.");
  await new Promise(resolve => setTimeout(resolve, 220)); expect(calls.filter(([m]) => m === "contest_draft_apply")).toHaveLength(before);
});

it("renders the responsive contest regions without transmit or ESM controls", async () => {
  const { request, calls } = fixture(); await open(request);
  expect(screen.getByRole("form", { name: "CW contest entry" })).toBeTruthy(); expect(screen.getByRole("region", { name: "Contest log" })).toBeTruthy(); expect(screen.getByRole("complementary", { name: "Score and multipliers" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /ESM|Transmit|Send CW|PTT/i })).toBeNull(); expect(calls.every(([method]) => method.startsWith("contest_"))).toBe(true);
});
