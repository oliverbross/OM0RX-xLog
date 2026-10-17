// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestRequest } from "./types";
import fixture from "../../../docs/contesting/fixtures/arrl-dx-worker-wire.json";

afterEach(cleanup);

it.each(["cw-wve", "cw-dx", "ssb-wve", "ssb-dx"])("creates the %s ARRL DX preview with independent section and directional entry", async key => {
  const life = (fixture as any).scenarios[key], item = life.create, apply = life.applyFirst;
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
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => ids.shift()!}
    digestPayload={async () => digests.shift()!} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  const form = await screen.findByRole("form", { name: "Create contest session" });
  expect(within(form).getAllByRole("option")).toHaveLength(16);
  fireEvent.change(within(form).getByLabelText("Contest"), { target: { value: item.request.payload.ruleIdentity.id } });
  const state = within(form).getByLabelText("Station state or province (W/VE)") as HTMLInputElement;
  const power = within(form).getByLabelText("Station power (DX)") as HTMLInputElement;
  const payload = item.request.payload;
  if (payload.station.exchangeFields.location) {
    fireEvent.change(power, { target: { value: "k" } });
    fireEvent.change(state, { target: { value: payload.station.exchangeFields.location.toLowerCase() } });
    expect(state.value).toBe(payload.station.exchangeFields.location); expect(power.value).toBe("");
  } else {
    fireEvent.change(state, { target: { value: "ca" } });
    fireEvent.change(power, { target: { value: payload.station.exchangeFields.power.toLowerCase() } });
    expect(state.value).toBe(""); expect(power.value).toBe(payload.station.exchangeFields.power);
  }
  fireEvent.change(within(form).getByLabelText("Session name"), { target: { value: payload.name } });
  fireEvent.change(within(form).getByLabelText("Station callsign"), { target: { value: payload.station.callsign } });
  fireEvent.change(within(form).getByLabelText("Operator callsign"), { target: { value: payload.operator.callsign } });
  fireEvent.change(within(form).getByLabelText("CQ zone"), { target: { value: payload.station.cqZone } });
  fireEvent.change(within(form).getByLabelText("DXCC entity"), { target: { value: payload.station.dxccEntity } });
  fireEvent.change(within(form).getByLabelText("Cabrillo section"), { target: { value: payload.station.stationFields.section } });
  fireEvent.click(within(form).getByRole("button", { name: "Create and open" }));
  await screen.findByText(new RegExp(`${item.response.result.session.rule.displayName} · ${payload.name}`));
  const create = request.mock.calls.find(([method]) => method === "contest_create")![1] as any;
  expect(create.payload.station).toEqual(payload.station);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: apply.request.payload.fields.callsign } });
  const receivedLocation = screen.getByLabelText("Received State or province") as HTMLInputElement;
  const receivedPower = screen.getByLabelText("Received Power") as HTMLInputElement;
  const expectedReceived = apply.request.payload.fields.receivedExchangeFields;
  if (expectedReceived.power) {
    fireEvent.change(receivedLocation, { target: { value: "NY" } });
    if (key === "cw-wve") {
      fireEvent.change(receivedPower, { target: { value: "k" } });
      expect(receivedPower.value).toBe("K");
      fireEvent.change(receivedPower, { target: { value: "ki" } });
      expect(receivedPower.value).toBe("KI");
      expect(await screen.findByText("Contest draft does not match the selected rule entry descriptor.")).toBeTruthy();
      expect(receivedPower.value).toBe("KI");
      fireEvent.change(receivedPower, { target: { value: "kil" } });
      expect(receivedPower.value).toBe("KIL");
      fireEvent.change(receivedPower, { target: { value: "kilo" } });
      expect(receivedPower.value).toBe("KILO");
    }
    fireEvent.change(receivedPower, { target: { value: expectedReceived.power.toLowerCase() } });
    expect(receivedLocation.value).toBe(""); expect(receivedPower.value).toBe(expectedReceived.power);
  } else {
    fireEvent.change(receivedPower, { target: { value: "k" } });
    fireEvent.change(receivedLocation, { target: { value: expectedReceived.location.toLowerCase() } });
    expect(receivedPower.value).toBe(""); expect(receivedLocation.value).toBe(expectedReceived.location);
  }
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  const applied = request.mock.calls.find(([method]) => method === "contest_draft_apply")![1] as any;
  expect(applied.payload.fields).toMatchObject({ sentExchange: payload.station.exchangeFields.location || payload.station.exchangeFields.power,
    receivedExchange: expectedReceived.location || expectedReceived.power,
    sentExchangeFields: payload.station.exchangeFields, receivedExchangeFields: expectedReceived });
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
  expect(await screen.findByText(/ARRL DX export is a scoring and format preview/)).toBeTruthy();
  expect(screen.getByLabelText("Cabrillo section")).toHaveProperty("value", payload.station.stationFields.section);
});

it("retains an invalid ARRL DX power correction and accepts the repaired raw token", async () => {
  const life = (fixture as any).scenarios["cw-wve"];
  let session = life.openAfterRestart.response.result.session;
  let currentQSO = life.get.response.result.qso;
  const summary = life.commitFirst.response.result.qso;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_catalog") return (fixture as any).catalog;
    if (method === "contest_sessions") return { id: "sessions", ok: true, result: { sessions: [session] } };
    if (method === "contest_open") return life.openAfterRestart.response;
    if (method === "contest_log_page") return { id: "log", ok: true, result: { sessionID: session.sessionID,
      workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: [summary], total: 1,
      offset: params.offset, limit: params.limit } };
    if (method === "contest_score") return { id: "score", ok: true, result: { ...life.correct.response.result.score,
      revision: session.revision, multiplierLabels: [], multiplierDisplayLabels: [] } };
    if (method === "contest_qso_get") return { ...life.get.response, result: { ...life.get.response.result,
      revision: session.revision, qso: currentQSO } };
    if (method === "contest_qso_correct") {
      session = life.correct.response.result.session;
      currentQSO = { ...currentQSO, ...(params.payload as any).qso };
      return { ...life.correct.response, result: { ...life.correct.response.result, session, currentTarget: currentQSO } };
    }
    if (method === "contest_draft_get") return { id: "draft", ok: true, result: { session,
      draft: { ...life.openAfterRestart.response.result.draft, revision: session.revision } } };
    if (method === "contest_scp_status") return { id: "scp", ok: true, result: { available: false, reason: "No data" } };
    throw new Error(`Unexpected ${method}`);
  });
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => life.correct.request.requestID}
    digestPayload={async () => life.correct.request.payloadDigest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /ARRL DX cw-wve/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit OM0RX" }));
  const editor = await screen.findByRole("form", { name: "Edit OM0RX" });
  const power = within(editor).getByLabelText("Received Power") as HTMLInputElement;
  fireEvent.change(power, { target: { value: "2000" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("Contest correction contains an invalid or oversized field.")).toBeTruthy();
  expect(power.value).toBe("2000");
  expect(request.mock.calls.filter(([method]) => method === "contest_qso_correct")).toHaveLength(0);
  fireEvent.change(power, { target: { value: "100" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Saved OM0RX/);
  const correction = request.mock.calls.find(([method]) => method === "contest_qso_correct")![1] as any;
  expect(correction.payload.qso).toMatchObject({ receivedExchange: "100", normalizedReceivedExchange: "100",
    receivedExchangeFields: { location: "", power: "100" } });
});
