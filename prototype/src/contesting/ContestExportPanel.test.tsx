// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { ContestExportPanel } from "./ContestExportPanel";
import { ContestExportSaveOwner, type ContestExportSaveAdapter } from "./contestExportSave";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import type { ContestPreparedExport, ContestSessionSummary } from "./types";

const session: ContestSessionSummary = { sessionID: "20000000-0000-4000-8000-000000000002", workspaceGeneration: "30000000-0000-4000-8000-000000000003",
  revision: 7, name: "WW", rule: { identity: { id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "fixture" },
    displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1, entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2", report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 }, exchange: { sent: "cqZone", received: "cqZone", sentDefault: "stationSnapshot", adifFields: "none" }, serial: { requirement: "none", allowedScopes: [] } }, referenceDataVersion: "cty", sourceVerification: "provisional", sourceNote: "Preview" },
  referenceDataVersion: "cty", station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovakia" },
  operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 2, updatedAt: "2026-10-18T00:00:00.000Z" };
const prepared: ContestPreparedExport = { artifactID: "10000000-0000-4000-8000-000000000001", sessionID: session.sessionID,
  workspaceGeneration: session.workspaceGeneration, revision: 7, format: "cabrillo", inputSchemaVersion: "1", formatterVersion: "pilot-2",
  generatedAtUTC: "2026-10-18T00:00:00.000Z", qsoCount: 2, totalPoints: 6, multiplierCount: 2, claimedScore: 12,
  byteLength: 450, sha256: "a".repeat(64), chunkLimit: 64, expiresAfterSeconds: 60 };
afterEach(cleanup);

function setup(adapter?: ContestExportSaveAdapter, category = "Single Operator", selectedSession = session) {
  adapter ??= vi.fn(async () => ({ status: "saved" as const, artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "ww.cbr" }));
  const opener = createRef<HTMLButtonElement>(); document.body.append(Object.assign(document.createElement("button"), { textContent: "Export" }));
  opener.current = document.body.lastElementChild as HTMLButtonElement; opener.current.focus();
  const prepare = vi.fn(async () => prepared), release = vi.fn(async () => ({})), onClose = vi.fn(), onSaved = vi.fn();
  const owner = new ContestExportSaveOwner(adapter, new MemoryContestRecoveryStorage());
  const view = render(<ContestExportPanel session={{ ...selectedSession, operator: { ...selectedSession.operator, category } }} opener={opener} saveOwner={owner}
    prepare={prepare} release={release} onClose={onClose} onSaved={onSaved}/>);
  return { view, owner, prepare, release, onClose, onSaved, adapter, opener };
}
function fillAndPrepare() { fireEvent.change(screen.getByLabelText("Location"), { target: { value: "DX" } }); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Operator" } }); fireEvent.click(screen.getByRole("button", { name: "Prepare export" })); }

it("uses fixed preview categories, prepares once, and shows a compact non-sensitive summary", async () => {
  const { prepare } = setup();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })); fillAndPrepare();
  await screen.findByRole("region", { name: "Prepared export summary" });
  expect(prepare).toHaveBeenCalledWith("cabrillo", expect.objectContaining({ callsign: "OM0RX", categoryOperator: "SINGLE-OP", categoryMode: "CW", categoryTransmitter: "ONE", operators: ["OM0RX"], location: "DX", name: "Operator" }));
  expect(screen.getByText("Revision").nextSibling?.textContent).toBe("7");
  expect(screen.queryByText(prepared.artifactID)).toBeNull(); expect(screen.queryByText(prepared.sha256)).toBeNull();
});

it("derives the SSB Cabrillo mode from the pinned entry descriptor", async () => {
  const ssb = { ...session, rule: { ...session.rule, identity: { ...session.rule.identity, id: "cq-ww-ssb" as const },
    displayName: "CQ WW SSB" as const, mode: "SSB" as const,
    entry: { ...session.rule.entry, mode: "SSB" as const, adifMode: "SSB" as const, cabrilloQSOType: "PH" as const,
      cabrilloFormatterVersion: "ssb-pilot-1" as const, cabrilloProjectionFormatterVersion: "ssb-pilot-2" as const,
      report: { format: "phoneRS" as const, defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2 as const } } } };
  const { prepare } = setup(undefined, "Single Operator", ssb);
  fillAndPrepare();
  await screen.findByRole("region", { name: "Prepared export summary" });
  expect(prepare).toHaveBeenCalledWith("cabrillo", expect.objectContaining({ categoryMode: "SSB" }));
});

it("keeps SAC Cabrillo output visibly practice-only before and after preparation", async () => {
  const sac = { ...session, rule: { ...session.rule,
    identity: { id: "sac-cw" as const, version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" },
    displayName: "Scandinavian Activity Contest CW" as const,
    entry: { ...session.rule.entry, exchange: { sent: "serialNumber" as const, received: "serialNumber" as const,
      sentDefault: "reservedSerial" as const, adifFields: "exchangeStrings" as const },
      serial: { requirement: "requiredForCommit" as const, allowedScopes: ["session" as const, "band" as const, "transmitter" as const] } } } };
  setup(undefined, "Single Operator", sac);
  expect(screen.getByRole("heading", { name: "Prepare a practice export" })).toBeTruthy();
  expect(screen.getByText(/not sponsor-submission ready/)).toBeTruthy();
  fillAndPrepare();
  expect(await screen.findByText("Cabrillo practice export")).toBeTruthy();
  expect(screen.queryByText("Cabrillo submission preview")).toBeNull();
});

it("does not relabel unsupported stored categories", () => {
  setup(undefined, "Multi Operator");
  expect(screen.getByRole("alert").textContent).toMatch(/unavailable.*Multi Operator.*Single Operator/i);
  expect(screen.queryByRole("button", { name: "Prepare export" })).toBeNull();
});

it("keeps an immutable prepared revision after the live session advances", async () => {
  const { view, owner, prepare, release, onClose, onSaved, opener } = setup(); fillAndPrepare(); await screen.findByText("Cabrillo submission preview");
  view.rerender(<ContestExportPanel session={{ ...session, revision: 8 }} opener={opener} saveOwner={owner} prepare={prepare} release={release} onClose={onClose} onSaved={onSaved}/>);
  expect(screen.getByText("Revision").nextSibling?.textContent).toBe("7"); expect(prepare).toHaveBeenCalledTimes(1);
});

it("saves once, releases, and restores focus without confirmation ceremony", async () => {
  const { adapter, release, onSaved, opener } = setup(); fillAndPrepare(); await screen.findByText("Cabrillo submission preview");
  const save = screen.getByRole("button", { name: "Save…" }); fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("ww.cbr")); expect(adapter).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledWith(prepared);
  cleanup(); expect(document.activeElement).toBe(opener.current);
});

it("Escape closes and restores focus", () => {
  const { onClose, opener } = setup(); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(onClose).toHaveBeenCalledTimes(1);
  cleanup(); expect(document.activeElement).toBe(opener.current);
});

it("keeps one shared native save across close and remount", async () => {
  let resolve!: (value: { status: "saved"; artifactID: string; sha256: string; filename: string }) => void;
  const reply = new Promise<{ status: "saved"; artifactID: string; sha256: string; filename: string }>(done => { resolve = done; });
  const adapter: ContestExportSaveAdapter = vi.fn(() => reply), first = setup(adapter); fillAndPrepare(); await screen.findByText("Cabrillo submission preview");
  fireEvent.click(screen.getByRole("button", { name: "Save…" })); await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); first.view.unmount();
  expect(first.release).not.toHaveBeenCalled();
  const opener = first.opener;
  const second = render(<ContestExportPanel session={session} opener={opener} saveOwner={first.owner} prepare={first.prepare}
    release={first.release} onClose={vi.fn()} onSaved={first.onSaved}/>);
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Saving…" })); expect(adapter).toHaveBeenCalledTimes(1);
  resolve({ status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "ww.cbr" });
  await waitFor(() => expect(first.onSaved).toHaveBeenCalledWith("ww.cbr")); second.unmount();
});

it("releases a ready unsaved artifact when the panel unmounts", async () => {
  const { view, release } = setup(); fillAndPrepare(); await screen.findByText("Cabrillo submission preview");
  view.unmount();
  await waitFor(() => expect(release).toHaveBeenCalledWith(prepared));
});

it("does not attribute or retry another session's failed export", async () => {
  const adapter = vi.fn(async () => ({ status: "failed" as const, artifactID: prepared.artifactID,
    sha256: prepared.sha256, message: "Artifact expired." }));
  const owner = new ContestExportSaveOwner(adapter, new MemoryContestRecoveryStorage()), release = vi.fn(async () => ({}));
  await owner.save(prepared, release);
  const other = { ...session, sessionID: "40000000-0000-4000-8000-000000000004" };
  const opener = createRef<HTMLButtonElement>(); opener.current = document.body.appendChild(document.createElement("button"));
  const onSaved = vi.fn();
  render(<ContestExportPanel session={other} opener={opener} saveOwner={owner} prepare={vi.fn()} release={release} onClose={vi.fn()} onSaved={onSaved}/>);
  expect(screen.getByText("Another contest export needs attention")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry Save…" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(adapter).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
  await waitFor(() => expect(release).toHaveBeenCalledWith(prepared));
  expect(screen.getByRole("button", { name: "Prepare export" })).toBeTruthy();
});

it("does not attribute another session's late successful completion", async () => {
  let resolve!: (value: { status: "saved"; artifactID: string; sha256: string; filename: string }) => void;
  const adapter = vi.fn(() => new Promise<{ status: "saved"; artifactID: string; sha256: string; filename: string }>(done => { resolve = done; }));
  const owner = new ContestExportSaveOwner(adapter, new MemoryContestRecoveryStorage()), release = vi.fn(async () => ({}));
  const pending = owner.save(prepared, release);
  const other = { ...session, sessionID: "40000000-0000-4000-8000-000000000004" };
  const opener = createRef<HTMLButtonElement>(); opener.current = document.body.appendChild(document.createElement("button"));
  const onSaved = vi.fn();
  render(<ContestExportPanel session={other} opener={opener} saveOwner={owner} prepare={vi.fn()} release={release} onClose={vi.fn()} onSaved={onSaved}/>);
  expect(screen.getByText("Another contest export needs attention")).toBeTruthy();
  resolve({ status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename: "ww.cbr" }); await pending;
  await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy());
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onSaved).not.toHaveBeenCalled();
});

it("can discard a definite failed artifact and prepare a fresh one", async () => {
  const fresh = { ...prepared, artifactID: "50000000-0000-4000-8000-000000000005", sha256: "b".repeat(64) };
  let attempt = 0;
  const adapter = vi.fn<ContestExportSaveAdapter>(async value => ++attempt === 1
    ? { status: "failed" as const, artifactID: value.artifactID, sha256: value.sha256, message: "Artifact expired." }
    : { status: "saved" as const, artifactID: value.artifactID, sha256: value.sha256, filename: "fresh.cbr" });
  const fixture = setup(adapter); fixture.prepare.mockResolvedValueOnce(prepared).mockResolvedValueOnce(fresh);
  fillAndPrepare(); await screen.findByText("Cabrillo submission preview"); fireEvent.click(screen.getByRole("button", { name: "Save…" }));
  await screen.findByText("Artifact expired."); fireEvent.click(screen.getByRole("button", { name: "Prepare again" }));
  await waitFor(() => expect(fixture.release).toHaveBeenCalledWith(prepared));
  fireEvent.click(screen.getByRole("button", { name: "Prepare export" })); await screen.findByText("Cabrillo submission preview");
  fireEvent.click(screen.getByRole("button", { name: "Save…" }));
  await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledWith("fresh.cbr"));
  expect(adapter).toHaveBeenCalledTimes(2); expect(adapter.mock.calls[1]?.[0].artifactID).toBe(fresh.artifactID);
});
