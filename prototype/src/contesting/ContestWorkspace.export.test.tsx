// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestWorkspace } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestDraftSnapshot, ContestRequest, ContestRuleMetadata, ContestSessionSummary } from "./types";
import { reviewedOperatorCapabilityDigest } from "./operatorCapabilities.generated";

const identity: ContestRuleMetadata["identity"] = { id: "cq-wpx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" };
const rule: ContestRuleMetadata = { identity,
  displayName: "CQ WPX CW", mode: "CW", entryDescriptorVersion: 1, entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2", report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 }, exchange: { sent: "serialNumber", received: "serialNumber", sentDefault: "reservedSerial", adifFields: "stxSrx" }, serial: { requirement: "requiredForCommit", allowedScopes: ["session", "band", "transmitter"] } }, referenceDataVersion: "cty", sourceVerification: "provisional", sourceNote: "Preview" };
rule.operatorCapability = { version: 1, auditDigest: reviewedOperatorCapabilityDigest(identity)!, policy: "simulated-run-sp-v1", output: "simulation-only",
  styles: ["run", "search-and-pounce"], macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"] };
const session: ContestSessionSummary = { sessionID: "20000000-0000-4000-8000-000000000002", workspaceGeneration: "30000000-0000-4000-8000-000000000003",
  revision: 7, name: "WPX", rule, referenceDataVersion: "cty", station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovakia" },
  operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 2, updatedAt: "2026-10-18T00:00:00.000Z" };
const draft: ContestDraftSnapshot = { draftID: "draft", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: 7,
  fields: { callsign: "N0CALL", sentReport: "599", sentExchange: "007", receivedReport: "599", receivedExchange: "1", frequencyHz: 14_025_000, band: "20m", mode: "CW" },
  reservedSerial: 7, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" }, updatedAt: session.updatedAt,
  operatorReadiness: { capabilityDigest: rule.operatorCapability.auditDigest, callsign: "ready", exchange: "ready", canSendCQ: false,
    canSendCall: true, canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: true } };
const other = { ...session, sessionID: "20000000-0000-4000-8000-000000000004", name: "WPX Two", qsoCount: 0 };
const otherDraft = { ...draft, draftID: "draft-two", sessionID: other.sessionID, reservedSerial: null };
afterEach(cleanup);

function fixture(delay?: Promise<void>) {
  const calls: [string, Record<string, unknown>][] = [];
  const request = (vi.fn(async (method, params = {}) => {
    calls.push([method, params]); const ok = (result: unknown) => ({ id: "frame", ok: true as const, result });
    if (method === "contest_catalog") return ok({ workspaceGeneration: session.workspaceGeneration, rules: [rule] });
    if (method === "contest_sessions") return ok({ sessions: [session, other] });
    if (method === "contest_open" || method === "contest_draft_get") return params.sessionID === other.sessionID ? ok({ session: other, draft: otherDraft }) : ok({ session, draft });
    if (method === "contest_log_page") return ok({ sessionID: params.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: [], total: 0, offset: 0, limit: 20 });
    if (method === "contest_score") return ok({ sessionID: params.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: params.sessionID === session.sessionID ? 2 : 0, points: 6, multipliers: 2, claimedScore: 12, multiplierLabels: ["K"], sourceVerification: "provisional" });
    if (method === "contest_export_prepare") { await delay; return ok({ artifactID: params.exportID, sessionID: params.sessionID, workspaceGeneration: params.workspaceGeneration,
      revision: params.expectedRevision, format: params.format, inputSchemaVersion: "1", formatterVersion: params.format === "cabrillo" ? "pilot-2" : "pilot-1",
      generatedAtUTC: params.generatedAtUTC, qsoCount: 2, totalPoints: 6, multiplierCount: 2, claimedScore: 12, byteLength: 450,
      sha256: "a".repeat(64), chunkLimit: 64, expiresAfterSeconds: 60 }); }
    if (method === "contest_export_release") return ok({ artifactID: params.exportID, released: true });
    throw new Error(`Unexpected ${method}`);
  }) as ContestRequest);
  return { request, calls };
}
async function open(request: ContestRequest, save: any) {
  render(<ContestWorkspace request={request} exportSave={save} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /WPX.*2 QSOs/ })); await screen.findByRole("form", { name: "CW contest entry" });
}
async function prepare() {
  const exportButton = screen.getByRole("button", { name: "Export…" });
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(exportButton);
  const location = await screen.findByLabelText("Location");
  fireEvent.change(location, { target: { value: "DX" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Operator" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare export" }));
}

it("preserves the operating draft and reserved serial through cancellation", async () => {
  const { request } = fixture(); const save = vi.fn(async (value: any) => ({ status: "cancelled", artifactID: value.artifactID, sha256: value.sha256 })); await open(request, save);
  await prepare(); await screen.findByText("Cabrillo submission preview"); fireEvent.click(screen.getByRole("button", { name: "Save…" })); await screen.findByText("Save cancelled.");
  expect((screen.getByRole("textbox", { name: "Contest callsign" }) as HTMLInputElement).value).toBe("N0CALL");
  expect(screen.getByRole("button", { name: "Serial 7" })).toBeTruthy();
});

it("releases a prepared result that arrives after close and session switch", async () => {
  let resolve!: () => void; const gate = new Promise<void>(done => { resolve = done; }); const { request, calls } = fixture(gate);
  await open(request, vi.fn()); await prepare(); await waitFor(() => expect(calls.some(([method]) => method === "contest_export_prepare")).toBe(true));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); fireEvent.click(screen.getByRole("button", { name: "Contest Manager" }));
  fireEvent.click(screen.getByRole("button", { name: /WPX Two/ })); await screen.findByRole("heading", { name: /WPX Two/ }); resolve();
  await waitFor(() => expect(calls.some(([method]) => method === "contest_export_release")).toBe(true));
  expect(screen.queryByRole("dialog")).toBeNull();
});
