// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestRequest } from "./types";
import arrlFixtureJSON from "../../../docs/contesting/fixtures/arrl-rtty-worker-wire.json";

const fixture = arrlFixtureJSON as any;
afterEach(cleanup);

function setup(branch: "wve" | "dx") {
  const item = fixture[branch], createIDs = [item.createRequest.sessionID, item.createRequest.requestID];
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return fixture.catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [] } };
    if (method === "contest_create") return item.createResponse;
    const session = item.createResponse.result.session;
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [], total: 0, offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: 0, points: 0, multipliers: 0,
      claimedScore: 0, multiplierLabels: [], multiplierDisplayLabels: [], sourceVerification: "provisional" } };
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => createIDs.shift()!}
    digestPayload={async () => item.createRequest.payloadDigest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  return request;
}

async function fillARRL(branch: "wve" | "dx") {
  const payload = fixture[branch].createRequest.payload;
  await screen.findByRole("form", { name: "Create contest session" });
  fireEvent.change(screen.getByLabelText("Contest"), { target: { value: "arrl-rtty-roundup" } });
  const labels = [...document.querySelectorAll(".contest-create-fields label")].map(node => node.textContent);
  expect(labels.slice(-2)).toEqual(["Station state or province", "Cabrillo section"]);
  expect(screen.queryByLabelText("Station Serial")).toBeNull();
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: payload.name } });
  fireEvent.change(screen.getByLabelText("Station callsign"), { target: { value: payload.station.callsign } });
  fireEvent.change(screen.getByLabelText("Operator callsign"), { target: { value: payload.operator.callsign } });
  fireEvent.change(screen.getByLabelText("CQ zone"), { target: { value: payload.station.cqZone } });
  fireEvent.change(screen.getByLabelText("DXCC entity"), { target: { value: payload.station.dxccEntity } });
  if (payload.station.exchangeFields.location) fireEvent.change(screen.getByLabelText("Station state or province"), { target: { value: payload.station.exchangeFields.location } });
  fireEvent.change(screen.getByLabelText("Cabrillo section"), { target: { value: payload.station.stationFields.section } });
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
}

it("creates a W/VE session from generic descriptors without exposing serial reservation", async () => {
  const request = setup("wve"); await fillARRL("wve");
  await screen.findByText(/ARRL RTTY Roundup Preview · ARRL RTTY WVE/);
  expect(screen.queryByRole("button", { name: "Reserve serial" })).toBeNull();
  const create = request.mock.calls.find(call => call[0] === "contest_create")![1] as any;
  expect(create.payload.station).toEqual({ callsign: "K1AAA", cqZone: "5", dxccEntity: "UNITED STATES",
    exchangeFields: { location: "CA", serial: "" }, stationFields: { section: "EB" } });
});

it("shows reservation only from the authoritative DX resolved policy", async () => {
  setup("dx"); await fillARRL("dx");
  await waitFor(() => expect(screen.getByRole("button", { name: "Reserve serial" })).toBeTruthy());
  expect((screen.getByLabelText("Sent report") as HTMLInputElement).value).toBe("599");
  expect((screen.getByLabelText("Received report") as HTMLInputElement).value).toBe("599");
  expect(screen.getByLabelText("Received State, province, or serial")).toBeTruthy();
});

it("renders nondefault reports for structured ARRL correction while NAQP remains report-free", async () => {
  const item = fixture.dx, session = item.openResponse.result.session;
  const qsoSummary = item.commitResponse.result.qso;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return fixture.catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [session] } };
    if (method === "contest_open") return item.openResponse;
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [qsoSummary], total: 1,
      offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { ...item.commitResponse.result.score,
      revision: session.revision, multiplierLabels: [qsoSummary.multiplier], multiplierDisplayLabels: qsoSummary.multiplierDisplayLabels } };
    if (method === "contest_qso_get") return item.getResponse;
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  render(<ContestWorkspace request={request as ContestRequest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /ARRL RTTY DX/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1AAA" }));
  const editor = await screen.findByRole("form", { name: "Edit K1AAA" });
  expect((within(editor).getByLabelText("Sent report") as HTMLInputElement).value).toBe("589");
  expect((within(editor).getByLabelText("Received report") as HTMLInputElement).value).toBe("579");
  expect(within(editor).getByLabelText("Received State, province, or serial")).toBeTruthy();
});
