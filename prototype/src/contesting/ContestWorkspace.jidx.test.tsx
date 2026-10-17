// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestRequest } from "./types";
import fixture from "../../../docs/contesting/fixtures/jidx-worker-wire.json";

afterEach(cleanup);

it("creates an entityless JIDX maritime preview through the shared structured UI", async () => {
  const item = (fixture as any).creates.mm, apply = (fixture as any).singleDigitLifecycle.applyFirst;
  let session = item.response.result.session;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return (fixture as any).catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [] } };
    if (method === "contest_create") return item.response;
    if (method === "contest_draft_apply") { session = apply.response.result.session; return apply.response; }
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [], total: 0,
      offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: 0, points: 0,
      multipliers: 0, claimedScore: 0, multiplierLabels: [], multiplierDisplayLabels: [], sourceVerification: "provisional" } };
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  const ids = [item.request.sessionID, item.request.requestID, apply.request.requestID];
  const digests = [item.request.payloadDigest, apply.request.payloadDigest];
  render(<ContestWorkspace request={request as ContestRequest}
    createRequestID={() => ids.shift()!}
    digestPayload={async () => digests.shift()!} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  const form = await screen.findByRole("form", { name: "Create contest session" });
  expect(within(form).getAllByRole("option")).toHaveLength(14);
  fireEvent.change(within(form).getByLabelText("Contest"), { target: { value: "jidx-cw" } });
  expect(within(form).getByLabelText("Station prefecture or CQ Zone")).toBeTruthy();
  const payload = item.request.payload;
  fireEvent.change(within(form).getByLabelText("Session name"), { target: { value: payload.name } });
  fireEvent.change(within(form).getByLabelText("Station callsign"), { target: { value: payload.station.callsign } });
  fireEvent.change(within(form).getByLabelText("Operator callsign"), { target: { value: payload.operator.callsign } });
  fireEvent.change(within(form).getByLabelText("CQ zone"), { target: { value: payload.station.cqZone } });
  fireEvent.change(within(form).getByLabelText("Station prefecture or CQ Zone"), { target: { value: payload.station.exchangeFields.number } });
  fireEvent.click(within(form).getByRole("button", { name: "Create and open" }));
  await screen.findByText(/JIDX CW Preview · JIDX CW MM/);
  expect(screen.getByText("Maritime mobile")).toBeTruthy();
  const sent = screen.getByLabelText("Sent exchange");
  expect(within(sent).getByText("Sent Prefecture or CQ Zone")).toBeTruthy();
  expect(within(sent).getByText("3")).toBeTruthy();
  const create = request.mock.calls.find(([method]) => method === "contest_create")![1] as any;
  expect(create.payload.station).toEqual({ callsign: "OM0RX/MM", cqZone: "3", dxccEntity: "", exchangeFields: { number: "3" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "JA1AAA" } });
  const received = screen.getByLabelText("Received Prefecture or CQ Zone");
  fireEvent.change(received, { target: { value: "3" } });
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  const applied = request.mock.calls.find(([method]) => method === "contest_draft_apply")![1] as any;
  expect(applied.payload.fields).toMatchObject({ sentExchange: "3", receivedExchange: "3",
    sentExchangeFields: { number: "3" }, receivedExchangeFields: { number: "3" } });
  expect((received as HTMLInputElement).value).toBe("3");
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  expect(await screen.findByText(/Sponsor acceptance of the maritime-mobile ENTITY token/)).toBeTruthy();
  await waitFor(() => expect(ids).toHaveLength(0));
});

it("normalizes a single-digit JIDX correction while preserving raw evidence", async () => {
  const lifecycle = (fixture as any).singleDigitLifecycle;
  let session = lifecycle.openAfterRestart.response.result.session;
  let currentQSO = lifecycle.get.response.result.qso;
  const summary = lifecycle.commitSecond.response.result.qso;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return (fixture as any).catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [session] } };
    if (method === "contest_open") return lifecycle.openAfterRestart.response;
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [summary], total: 1,
      offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { ...lifecycle.correct.response.result.score,
      revision: session.revision, multiplierLabels: [summary.multiplier], multiplierDisplayLabels: summary.multiplierDisplayLabels } };
    if (method === "contest_qso_get") return { ...lifecycle.get.response, result: { ...lifecycle.get.response.result,
      revision: session.revision, qso: currentQSO } };
    if (method === "contest_qso_correct") {
      session = lifecycle.correct.response.result.session;
      currentQSO = lifecycle.correct.response.result.currentTarget;
      return lifecycle.correct.response;
    }
    if (method === "contest_draft_get") return { id: "draft", ok: true, result: { session,
      draft: { ...lifecycle.openAfterRestart.response.result.draft, revision: session.revision } } };
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => lifecycle.correct.request.requestID}
    digestPayload={async () => lifecycle.correct.request.payloadDigest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /JIDX CW MM/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit JA1BBB" }));
  const editor = await screen.findByRole("form", { name: "Edit JA1BBB" });
  const number = within(editor).getByLabelText("Received Prefecture or CQ Zone") as HTMLInputElement;
  expect(number.value).toBe("4");
  fireEvent.change(number, { target: { value: "5" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Saved JA1BBB/);
  const correction = request.mock.calls.find(([method]) => method === "contest_qso_correct")![1] as any;
  expect(correction.payload.qso).toMatchObject({ sentExchange: "3", normalizedSentExchange: "03",
    receivedExchange: "5", normalizedReceivedExchange: "05",
    sentExchangeFields: { number: "3" }, receivedExchangeFields: { number: "5" } });
  expect(currentQSO).toMatchObject({ sentExchange: "3", normalizedSentExchange: "03",
    receivedExchange: "5", normalizedReceivedExchange: "05" });
});
