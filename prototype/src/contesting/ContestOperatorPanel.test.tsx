// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import workerFixtureJSON from "../../../docs/contesting/fixtures/contesting-worker-wire.json";
import exportFixtureJSON from "../../../docs/contesting/fixtures/contest-export-worker-wire.json";
import { ContestMutationUncertain } from "./client";
import { ContestOperatorPanel, type ContestOperatorRecovery, type ContestSimulationAdapter } from "./ContestOperatorPanel";
import type { ContestCommitResult, ContestDraftResult, ContestDraftSnapshot, ContestSessionSummary } from "./types";

const SOURCE = "7c8b499225a73f7f8f792246881bd7aefc05452f";
type WorkerDraftFixture = { responses: Record<string, { result?: { draft?: ContestDraftSnapshot } }> };
const workerFixture = workerFixtureJSON as unknown as WorkerDraftFixture;
const exportFixture = exportFixtureJSON as unknown as WorkerDraftFixture;
const WPX_BLANK_ERRORS = workerFixture.responses.commit.result!.draft!.validation.errors;
const WW_BLANK_ERRORS = exportFixture.responses.openAfterPrepare.result!.draft!.validation.errors;
const rule = (mode: "CW" | "SSB", serial: boolean): ContestSessionSummary["rule"] => ({
  identity: { id: serial ? mode === "CW" ? "cq-wpx-cw" : "cq-wpx-ssb" : mode === "CW" ? "cq-ww-cw" : "cq-ww-ssb", version: "1.0.0-source-spike",
    edition: "source-26.10.11", sourceRevision: SOURCE }, displayName: serial ? `CQ WPX ${mode}` : `CQ WW ${mode}`, mode,
  entryDescriptorVersion: 1, entry: { mode, adifMode: mode, cabrilloQSOType: mode === "CW" ? "CW" : "PH",
    cabrilloFormatterVersion: mode === "CW" ? "pilot-1" : "ssb-pilot-1",
    cabrilloProjectionFormatterVersion: mode === "CW" ? "pilot-2" : "ssb-pilot-2",
    report: { format: mode === "CW" ? "cwRST" : "phoneRS", defaultSent: mode === "CW" ? "599" : "59",
      defaultReceived: mode === "CW" ? "599" : "59", maximumUTF8Bytes: mode === "CW" ? 3 : 2 },
    exchange: { sent: serial ? "serialNumber" : "cqZone", received: serial ? "serialNumber" : "cqZone",
      sentDefault: serial ? "reservedSerial" : "stationSnapshot", adifFields: serial ? "stxSrx" : "none" },
    serial: { requirement: serial ? "requiredForCommit" : "none", allowedScopes: serial ? ["session", "band", "transmitter"] : [] } },
  referenceDataVersion: "cty-test", sourceVerification: "verified", sourceNote: "Pinned test rule",
});
function session(mode: "CW" | "SSB", serial = false): ContestSessionSummary {
  const selected = rule(mode, serial);
  return { sessionID: "11111111-1111-4111-8111-111111111111", workspaceGeneration: "22222222-2222-4222-8222-222222222222",
    revision: 1, name: "Operator flow", rule: selected, referenceDataVersion: selected.referenceDataVersion,
    station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" },
    qsoCount: 0, updatedAt: "2026-10-18T00:00:00.000Z" };
}
function draft(value: ContestSessionSummary, overrides: Partial<ContestDraftSnapshot["fields"]> = {}): ContestDraftSnapshot {
  const report = value.rule.entry.report.defaultSent;
  return { draftID: "33333333-3333-4333-8333-333333333333", sessionID: value.sessionID, workspaceGeneration: value.workspaceGeneration,
    revision: value.revision, fields: { callsign: "", sentReport: report, sentExchange: value.rule.entry.serial.requirement === "none" ? "15" : "",
      receivedReport: report, receivedExchange: "", frequencyHz: 14_025_000, band: "20m", mode: value.rule.mode, ...overrides },
    reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" }, updatedAt: value.updatedAt };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function draftResult(current: ContestSessionSummary, next: ContestDraftSnapshot): ContestDraftResult {
  return { session: { ...current, revision: next.revision }, draft: next,
    receipt: { requestID: "44444444-4444-4444-8444-444444444444",
      payloadDigest: "a".repeat(64), committedRevision: next.revision, committedAt: "2026-10-18T00:00:01.000Z" } };
}
afterEach(cleanup);

function Harness({ mode, serial = false, duplicate = false, invalid = false, unchecked = false, workerBlank = false,
  workerMissingExchange = false, workerMissingSerial = false, invalidCall = "", uncertainCommit = false, reserveReplyGate, simulate }:
  { mode: "CW" | "SSB"; serial?: boolean; duplicate?: boolean; invalid?: boolean; unchecked?: boolean;
    workerBlank?: boolean; workerMissingExchange?: boolean; workerMissingSerial?: boolean; invalidCall?: string;
    uncertainCommit?: boolean; reserveReplyGate?: Promise<void>; simulate?: ContestSimulationAdapter }) {
  const [active, setActive] = useState(() => session(mode, serial));
  const [current, setCurrent] = useState(() => ({ ...draft(active), ...(duplicate ? { fields: { ...draft(active).fields, callsign: "K1ABC" }, dupe: { state: "duplicate" as const, reason: "Worked" } } : {}) }));
  const [editGeneration, setEditGeneration] = useState(0), [reserveCount, setReserveCount] = useState(0), [commitCount, setCommitCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState<ContestOperatorRecovery>(null);
  const uncertainThrown = useRef(false);
  const ownerDirty = useRef(false);
  const admittedDraft = useRef(current);
  admittedDraft.current = current;
  const root = useRef<HTMLFormElement>(null);
  const reserve = async () => {
    setReserveCount(value => value + 1);
    const revision = current.revision + 1, next = { ...current, revision, reservedSerial: 7, fields: { ...current.fields, sentExchange: "007" },
      validation: { errors: current.fields.receivedExchange ? [] : ["Received serial must be a positive integer."], warnings: [] },
      dupe: { state: "clear" as const, reason: "Clear" } };
    admittedDraft.current = next; setActive(value => ({ ...value, revision })); setCurrent(next); await reserveReplyGate;
    return draftResult({ ...active, revision }, next);
  };
  const commit = async () => {
    setCommitCount(value => value + 1);
    if (uncertainCommit && !uncertainThrown.current) {
      uncertainThrown.current = true;
      throw new ContestMutationUncertain({ method: "contest_qso_commit", scope: { sessionID: active.sessionID,
        workspaceGeneration: active.workspaceGeneration, requestID: "77777777-7777-4777-8777-777777777777", expectedRevision: active.revision,
        draftID: current.draftID, payloadDigest: "b".repeat(64), operationTimestamp: "2026-10-18T00:00:01.000Z" }, payload: {} }, new Error("lost reply"));
    }
    const revision = current.revision + 1, next = { ...current, draftID: "55555555-5555-4555-8555-555555555555", revision,
      fields: { ...current.fields, callsign: "", receivedExchange: "", sentExchange: serial ? "" : current.fields.sentExchange }, reservedSerial: null,
      validation: { errors: serial ? WPX_BLANK_ERRORS : WW_BLANK_ERRORS, warnings: [] },
      dupe: { state: "unchecked" as const, reason: "Reload the contest session to check duplicate state." } };
    const result = { ...draftResult({ ...active, revision, qsoCount: active.qsoCount + 1 }, next),
      qso: { qsoID: "66666666-6666-4666-8666-666666666666", sessionID: active.sessionID, workedAt: "2026-10-18T00:00:01.000Z",
        callsign: current.fields.callsign, band: current.fields.band, mode, sentExchange: current.fields.sentExchange,
        receivedExchange: current.fields.receivedExchange, points: 3, multiplier: "K", isDupe: false },
      score: { sessionID: active.sessionID, workspaceGeneration: active.workspaceGeneration, revision, qsos: 1,
        points: 3, multipliers: 1, claimedScore: 3, sourceVerification: "verified" as const } } satisfies ContestCommitResult;
    admittedDraft.current = next; setActive(result.session); setCurrent(next); return result;
  };
  const recover = (exact: boolean) => { const revision = current.revision + 1, next = { ...current, draftID: "88888888-8888-4888-8888-888888888888", revision,
    fields: { ...current.fields, callsign: "", receivedExchange: "" } }; setActive(value => ({ ...value, revision, qsoCount: value.qsoCount + 1 }));
    setCurrent(next); setRecovery({ sequence: exact ? 2 : 1, method: "contest_qso_commit", sessionID: active.sessionID,
      workspaceGeneration: active.workspaceGeneration, requestID: exact ? "77777777-7777-4777-8777-777777777777" : "99999999-9999-4999-8999-999999999999",
      payloadDigest: exact ? "b".repeat(64) : "c".repeat(64) }); };
  useEffect(() => {
    if (!invalid && !unchecked && !workerBlank && !workerMissingExchange && !workerMissingSerial && !invalidCall) return;
    setCurrent(value => ({ ...value, fields: { ...value.fields,
      callsign: workerBlank ? "" : invalidCall || "K1ABC", receivedExchange: workerBlank || workerMissingExchange ? "" : workerMissingSerial ? "123" : "99",
      ...(workerMissingSerial ? { sentExchange: "" } : {}) },
      validation: { errors: workerBlank ? (serial ? WPX_BLANK_ERRORS : WW_BLANK_ERRORS) : invalidCall ? ["A valid callsign is required."] :
        workerMissingExchange ? [serial ? "Received serial must be a positive integer." : "CQ zone must be an integer from 1 through 40."] :
        workerMissingSerial ? ["Sent serial must be a positive integer."] : invalid ? ["CQ zone must be an integer from 1 through 40."] : [], warnings: [] },
      dupe: workerBlank || unchecked || invalidCall ? { state: "unchecked", reason: "Awaiting authoritative dupe check" } : value.dupe }));
  }, [invalid, invalidCall, serial, unchecked, workerBlank, workerMissingExchange, workerMissingSerial]);
  return <><form ref={root}><ContestOperatorPanel session={active} draft={current} entryRoot={root} editGeneration={editGeneration}
    disabled={blocked} recovery={recovery} reserveSerial={reserve} commitQSO={commit}
    admitIntent={identity => !ownerDirty.current && `${admittedDraft.current.draftID}@${admittedDraft.current.revision}` === identity}
    guardFormSubmit={() => {}}
    focusField={field => document.querySelector<HTMLInputElement>(`[data-contest-operator-field=${field}]`)?.focus()} simulateOutput={simulate}/>
    <input aria-label="Call" data-contest-operator-field="callsign" value={current.fields.callsign} onChange={event => { setEditGeneration(value => value + 1);
      const next = { ...admittedDraft.current, fields: { ...admittedDraft.current.fields, callsign: event.target.value.toUpperCase() } }; admittedDraft.current = next; setCurrent(next); }}/>
    <input aria-label="Exchange" data-contest-operator-field="exchange" value={current.fields.receivedExchange} onChange={event => { setEditGeneration(value => value + 1);
      const next = { ...admittedDraft.current, fields: { ...admittedDraft.current.fields, receivedExchange: event.target.value } }; admittedDraft.current = next; setCurrent(next); }}/>
    <input aria-label="Unrelated note" defaultValue="notes"/>
    </form><button onClick={() => setBlocked(true)}>Block entry</button><button onClick={() => setBlocked(false)}>Unblock entry</button><button onClick={() => { ownerDirty.current = true;
      setEditGeneration(value => value + 1); setCurrent(value => ({ ...value, fields: { ...value.fields, callsign: "K1ABD" } })); }}>Edit before admission</button>
      <output data-testid="owner-draft">{current.revision}/{current.reservedSerial ?? "none"}</output>
      {uncertainCommit && <><button onClick={() => recover(false)}>Recover wrong mutation</button>
      <button onClick={() => recover(true)}>Recover mutation</button></>}<output data-testid="calls">{reserveCount}/{commitCount}</output></>;
}

describe("ContestOperatorPanel simulated owner integration", () => {
  it.each(["CW", "SSB"] as const)("runs and logs a corrected %s contact only through visible simulation", async mode => {
    const sent: string[] = []; render(<Harness mode={mode} simulate={async entry => { sent.push(`${entry.macro}:${entry.text}`); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); const call = screen.getByLabelText("Call");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(call, { key: "Enter" }); await waitFor(() => expect(sent.map(x => x.split(":")[0])).toEqual(["HISCALL", "EXCH"]));
    fireEvent.change(call, { target: { value: "K1ABD" } }); const exchange = screen.getByLabelText("Exchange"); fireEvent.change(exchange, { target: { value: "05" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("0/1"));
    expect(sent.map(x => x.split(":")[0])).toEqual(["HISCALL", "EXCH", "HISCALL", "QRZ"]);
    expect(screen.getByText(/no CW, voice, PTT, audio, or radio output/i)).toBeTruthy();
  });

  it.each(["CW", "SSB"] as const)("waits for a WPX %s serial successor, ignores double Enter, then commits S&P", async mode => {
    const gate = deferred(), sent: string[] = [];
    const view = render(<Harness mode={mode} serial simulate={async entry => { sent.push(entry.macro); if (entry.macro === "EXCH") await gate.promise; }}/ >);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } }); fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } }); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" }); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(`${mode === "CW" ? "599" : "59"} 007`, { selector: ".contest-operator-trace strong" })).toBeTruthy());
    expect(screen.getByTestId("calls").textContent).toBe("1/0");
    await act(async () => gate.resolve()); await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]); view.unmount();
  });

  it("continues from an owner successor that rendered before the reserve reply settles", async () => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/0"));
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    expect(sent).toEqual([]);
    await act(async () => reply.resolve());
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]);
  });

  it("waits for the owner to become enabled after the reserved successor and reply are both ready", async () => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    fireEvent.click(screen.getByRole("button", { name: "Block entry" }));
    await act(async () => reply.resolve());
    expect(sent).toEqual([]); expect(screen.getByTestId("calls").textContent).toBe("1/0");
    fireEvent.click(screen.getByRole("button", { name: "Unblock entry" }));
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]);
  });

  it.each(["edit", "escape"] as const)("revokes the reserved continuation on delayed-reply %s", async action => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    if (action === "edit") fireEvent.click(screen.getByRole("button", { name: "Edit before admission" }));
    else fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Escape" });
    await act(async () => reply.resolve()); await act(async () => {});
    expect(sent).toEqual([]); expect(screen.getByTestId("calls").textContent).toBe("1/0");
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy();
  });

  it("sends QSOB4 for a duplicate and never mutates the contest", async () => {
    const sent: string[] = []; render(<Harness mode="CW" duplicate simulate={async entry => { sent.push(entry.macro); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent).toEqual(["QSOB4"])); expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("stops a delayed sequence on Escape and guards repeat, IME, and unrelated inputs", async () => {
    const gate = deferred(), sent: string[] = []; render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); await gate.promise; }}/ >);
    const call = screen.getByLabelText("Call"); fireEvent.keyDown(call, { key: "Enter", repeat: true }); fireEvent.keyDown(call, { key: "Enter", isComposing: true });
    fireEvent.keyDown(screen.getByLabelText("Unrelated note"), { key: "F1" });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" }); fireEvent.keyDown(call, { key: "Escape" });
    await act(async () => gate.resolve()); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy(); expect(screen.getByText("stopped", { selector: ".contest-operator-trace small" })).toBeTruthy();
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("maps function keys only from guarded contest entry fields", async () => {
    const sent: string[] = []; render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Unrelated note"), { key: "F1" });
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "F1" }); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("rejects authoritative validation failures and indeterminate duplicate state", async () => {
    const invalidOutput = vi.fn(); const invalidView = render(<Harness mode="CW" invalid simulate={invalidOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Exchange") as HTMLInputElement).value).toBe("99"));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    expect(invalidOutput).not.toHaveBeenCalled(); expect(screen.getByTestId("calls").textContent).toBe("0/0"); invalidView.unmount();
    const uncheckedOutput = vi.fn(); render(<Harness mode="CW" unchecked simulate={uncheckedOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Call") as HTMLInputElement).value).toBe("K1ABC"));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    expect(uncheckedOutput).not.toHaveBeenCalled(); expect(screen.getByTestId("calls").textContent).toBe("0/0");
    cleanup();
    for (const invalidCall of ["ABC", "K1ABC//P"]) {
      const malformedOutput = vi.fn(), view = render(<Harness mode="CW" invalidCall={invalidCall} simulate={malformedOutput}/>); await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
      expect(malformedOutput).not.toHaveBeenCalled(); view.unmount();
    }
  });

  it.each([["CW", false], ["SSB", false], ["CW", true], ["SSB", true]] as const)(
    "admits blank %s CQ from the complete worker fixture validation set (serial=%s)", async (mode, serial) => {
    const cqOutput = vi.fn(); render(<Harness mode={mode} serial={serial} workerBlank simulate={cqOutput}/>); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(cqOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "CQ" })));
  });

  it("admits incomplete AGN from a worker-shaped partial draft", async () => {
    const agnOutput = vi.fn(); const agn = render(<Harness mode="CW" workerMissingExchange simulate={agnOutput}/>); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(agnOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "AGN" }))); agn.unmount();
  });

  it.each([["CW", false], ["SSB", false], ["CW", true], ["SSB", true]] as const)(
    "can call CQ from the actual blank successor after a confirmed %s commit (serial=%s)", async (mode, serial) => {
    const sent: string[] = []; render(<Harness mode={mode} serial={serial} simulate={async entry => { sent.push(entry.macro); }}/>);
    const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: serial ? "123" : "05" } });
    if (serial) fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toMatch(/\/1$/));
    await waitFor(() => expect((call as HTMLInputElement).value).toBe(""));
    if (serial) fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "run" } });
    const arm = screen.queryByRole("button", { name: "Arm simulation" }); if (arm) fireEvent.click(arm);
    fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(sent.at(-1)).toBe("CQ"));
  });

  it.each(["CW", "SSB"] as const)("auto-reserves WPX %s in Run before receiving the exchange", async mode => {
    const wpxOutput = vi.fn(); render(<Harness mode={mode} serial unchecked workerMissingExchange workerMissingSerial simulate={wpxOutput}/>);
    await act(async () => {});
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/0"));
    expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "HISCALL" }));
    expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "EXCH", text: expect.stringContaining("007") }));
  });

  it("auto-reserves WPX S&P with a completed received exchange", async () => {
    const wpxOutput = vi.fn(); render(<Harness mode="CW" serial unchecked workerMissingSerial simulate={wpxOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Exchange") as HTMLInputElement).value).toBe("123"));
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "EXCH", text: expect.stringContaining("007") }));
  });

  it("blocks armed keys when the owner becomes busy", () => {
    const simulate = vi.fn(); render(<Harness mode="CW" simulate={simulate}/>);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.click(screen.getByRole("button", { name: "Block entry" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" }); expect(simulate).not.toHaveBeenCalled();
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("does not reserve or commit an edited draft after keyboard intent capture", async () => {
    render(<Harness mode="CW" serial/>); const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    act(() => { fireEvent.keyDown(exchange, { key: "Enter" }); fireEvent.click(screen.getByRole("button", { name: "Edit before admission" })); });
    await act(async () => {}); expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("disarms and cancels the remaining sequence when operating style changes", async () => {
    const gate = deferred(), sent: string[] = []; render(<Harness mode="SSB" simulate={async entry => { sent.push(entry.macro); await gate.promise; }}/ >);
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    await act(async () => gate.resolve()); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy(); expect(screen.getByLabelText("Operating style")).toHaveProperty("value", "search-and-pounce");
  });

  it("settles a delayed send cancelled by an edit and can be armed again", async () => {
    const gate = deferred(), sent: string[] = []; let first = true;
    render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); if (first) { first = false; await gate.promise; } }}/>);
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(call, { key: "Enter" }); fireEvent.change(call, { target: { value: "K1ABC" } }); await act(async () => gate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(sent).toEqual(["CQ", "HISCALL", "EXCH"]));
  });

  it("keeps an uncertain commit owned until the same mutation is reconciled", async () => {
    render(<Harness mode="CW" uncertainCommit/>); const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "05" } }); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await screen.findByText(/Mutation outcome unknown/); expect(screen.getByTestId("calls").textContent).toBe("0/1");
    fireEvent.keyDown(exchange, { key: "Enter" }); expect(screen.getByTestId("calls").textContent).toBe("0/1");
    fireEvent.click(screen.getByRole("button", { name: "Recover wrong mutation" }));
    expect(screen.getByText(/Mutation outcome unknown/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recover mutation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy());
    expect((call as HTMLInputElement).value).toBe("");
  });

  it("keeps unaudited profiles on Plain Log with an explicit boundary", () => {
    const active = session("CW"); active.rule = { ...active.rule, identity: { ...active.rule.identity, id: "sac-cw" } }; const current = draft(active); const root = { current: null };
    render(<ContestOperatorPanel session={active} draft={current} entryRoot={root} editGeneration={0} disabled={false} recovery={null}
      reserveSerial={vi.fn()} commitQSO={vi.fn()} admitIntent={() => true} guardFormSubmit={() => {}} focusField={vi.fn()}/>);
    expect(screen.getByText(/currently limited to the audited CQ WW and CQ WPX/)).toBeTruthy();
  });
});
