// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestRequest } from "./types";
import fixture from "../../../docs/contesting/fixtures/sst-worker-acceptance-wire.json";

afterEach(cleanup);

it("creates the packaged SST archive preview through the shared structured workspace", async () => {
  const item = (fixture as any).create;
  const payload = item.request.payload;
  const session = item.response.result.session;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return (fixture as any).catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [] } };
    if (method === "contest_create") return item.response;
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [], total: 0,
      offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: 0, points: 0,
      multipliers: 0, claimedScore: 0, multiplierLabels: [], multiplierDisplayLabels: [], sourceVerification: "provisional" } };
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  const ids = [item.request.sessionID, item.request.requestID];
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => ids.shift()!}
    digestPayload={async () => item.request.payloadDigest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);

  const form = await screen.findByRole("form", { name: "Create contest session" });
  expect(within(form).getAllByRole("option")).toHaveLength(24);
  fireEvent.change(within(form).getByLabelText("Contest"), { target: { value: "k1usn-sst" } });
  fireEvent.change(within(form).getByLabelText("Session name"), { target: { value: payload.name } });
  fireEvent.change(within(form).getByLabelText("Station callsign"), { target: { value: payload.station.callsign } });
  fireEvent.change(within(form).getByLabelText("Operator callsign"), { target: { value: payload.operator.callsign } });
  fireEvent.change(within(form).getByLabelText("CQ zone"), { target: { value: payload.station.cqZone } });
  fireEvent.change(within(form).getByLabelText("DXCC entity"), { target: { value: payload.station.dxccEntity } });
  fireEvent.change(within(form).getByLabelText("Station name"), { target: { value: payload.station.exchangeFields.name } });
  fireEvent.change(within(form).getByLabelText("Station state, province, or DX"),
    { target: { value: payload.station.exchangeFields.location } });
  fireEvent.click(within(form).getByRole("button", { name: "Create and open" }));

  expect(await screen.findByText(/K1USN SST Operator Archive Preview · SST Worker Acceptance/)).toBeTruthy();
  expect(await screen.findByLabelText("Operating style")).toBeTruthy();
  expect(screen.queryByLabelText("Sent report")).toBeNull();
  expect(screen.getByLabelText("Sent exchange").textContent).toContain("DAVE");
  expect(screen.getByLabelText("Sent exchange").textContent).toContain("MA");
  const create = request.mock.calls.find(([method]) => method === "contest_create")![1] as any;
  expect(create.payload).toEqual(payload);
  expect(create.payload.station).toEqual({ callsign: "K1USN", cqZone: "5", dxccEntity: "UNITED STATES",
    exchangeFields: { name: "DAVE", location: "MA" } });

  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  expect(await screen.findByText("Prepare an operator archive")).toBeTruthy();
  expect(within(screen.getByRole("dialog", { name: "Export contest log" }))
    .getByText(/not marked sponsor-submission ready/)).toBeTruthy();
});
