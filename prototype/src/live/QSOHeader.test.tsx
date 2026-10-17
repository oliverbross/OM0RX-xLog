// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import QSOHeader, { ReferenceEvidenceStatus } from "./QSOHeader";
import { DeskQSO } from "./OperatorDesk";
import QSOEditor from "./QSOEditor";
import { SpotActivationClient, activationMessage } from "./spotActivationClient";
import { SpotActivationStatus } from "./SpotActivationStatus";

afterEach(cleanup);
const evidence = { call: "H49A", rows: [{ kind: "iota", reference: "OC-047", status: "verified", name: "Solomon Islands" }] };
const draft = { id: "fixture", call: "H49A", start: "2026-10-13T01:19:31Z", frequencyHz: 28020000, band: "10m", mode: "CW", iota: "OC-047" };
const props = { draft, setDraft: vi.fn(), save: vi.fn(), clear: vi.fn(), busy: false, lookup: null, previous: [], request: vi.fn(async () => ({})),
  refresh: 0, onEditor: vi.fn(), onReadRadio: vi.fn(async () => {}), follow: false, setFollow: vi.fn(), rotor: null, autoRotor: false, setAutoRotor: vi.fn(), onManualRotor: vi.fn(), referenceEvidence: evidence };

it("keeps reference verification call-fenced without changing the heading's accessible name", () => {
  render(<><QSOHeader title="Active QSO" /><ReferenceEvidenceStatus call=" h49a " evidence={evidence} /></>);
  expect(screen.getByRole("heading", { name: "Active QSO" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("IOTA OC-047 · Verified: Solomon Islands");
});
it("does not show another call's reference evidence or an empty status", () => {
  const view = render(<><QSOHeader title="Active QSO" /><ReferenceEvidenceStatus call="W1AW" evidence={evidence} /></>);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<><QSOHeader title="Active QSO" /><ReferenceEvidenceStatus call="H49A" evidence={{ call: "H49A", rows: [] }} /></>);
  expect(screen.queryByRole("status")).toBeNull();
});
it("retains missing directory and unverified reference information alongside verified rows", () => {
  render(<ReferenceEvidenceStatus call="H49A" evidence={{ call: "H49A", rows: [...evidence.rows,
    { kind: "pota", reference: "XX-0001", status: "not_installed" }, { kind: "sota", reference: "XX/YY-001", status: "not_found" }] }} />);
  expect(screen.getByRole("status").children).toHaveLength(3);
  expect(screen.getByText(/POTA XX-0001 · Directory not installed/)).toBeTruthy();
  expect(screen.getByText(/SOTA XX\/YY-001 · Not found in installed directory/)).toBeTruthy();
});
it.each(["desk", "editor"])("puts evidence beneath the %s reference fields instead of in the header", kind => {
  render(kind === "desk" ? <DeskQSO {...props} /> : <QSOEditor {...props} />);
  const heading = screen.getByRole("heading", { name: kind === "desk" ? "Active QSO" : "Active contact" });
  const status = screen.getByRole("status");
  expect(status.parentElement).not.toBe(heading.parentElement);
  expect(status.closest(kind === "desk" ? ".desk-active-references" : ".qso-fields")).toBeTruthy();
});
it("contains the live long POTA evidence in a stable two-line narrow-desk slot", () => {
  const view = render(<DeskQSO {...props} referenceEvidence={null} />);
  const slot = view.container.querySelector(".desk-ref-slot")!;
  const actions = view.container.querySelector(".desk-active-actions")!;
  expect(slot).toBeTruthy();
  expect(slot.querySelector('[role="status"]')).toBeNull();
  view.rerender(<DeskQSO {...props} referenceEvidence={{ call: "H49A", rows: [{ kind: "pota", reference: "DE-1081", status: "verified", name: "Wangerland Bird Sanctuary" }] }} />);
  expect(view.container.querySelector(".desk-ref-slot")).toBe(slot);
  expect(view.container.querySelector(".desk-active-actions")).toBe(actions);
  expect(slot.querySelector('[role="status"]')?.textContent).toBe("POTA DE-1081 · Verified: Wangerland Bird Sanctuary");
  const css = readFileSync("src/live/OperatorDesk.css", "utf8");
  expect(css).toMatch(/\.desk-active \{[^}]*max-width: 100%;[^}]*overflow-x: hidden;/);
  expect(css).toMatch(/\.desk-active form \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow-x: hidden;/);
  expect(css).toMatch(/\.desk-active-references \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow-x: hidden;/);
  expect(css).toMatch(/\.desk-ref-slot \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*block-size: 2\.8em;[^}]*overflow: hidden;[^}]*contain: inline-size paint;/);
  expect(css).toMatch(/\.desk-ref-slot > \.qso-reference-status \{[^}]*display: -webkit-box;[^}]*height: 100%;[^}]*overflow: hidden;[^}]*-webkit-box-orient: vertical;[^}]*-webkit-line-clamp: 2;/);
  expect(css).toMatch(/\.desk-ref-slot \.qso-reference-status > span \{[^}]*min-width: 0;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  expect(css).toMatch(/\.desk-active-actions \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*flex: 0 0 auto;/);
});
it("removes the global tuning status row while retaining the authoritative tune fence and errors", async () => {
  const source = readFileSync("src/LiveApp.tsx", "utf8");
  expect(source).not.toContain("waiting for observed radio state");
  expect(source).not.toContain("request accepted; awaiting observation");
  expect(source).not.toContain("referenceEvidence.rows.map");
  expect(source).not.toContain('request("station_tune"');
  const operationId = "00000000-0000-4000-8000-000000000001";
  const activation = { sourceEpoch: "00000000-0000-4000-8000-000000000002", spotVersion: "00000000-0000-4000-8000-000000000003" };
  const call = vi.fn(async (command: string) => {
    if (command === "activate_spot") throw new Error("Native acknowledgement lost");
    return { operationId, phase: "confirmed", tuneConfirmed: false, rotor: "not_requested", reservationActive: false };
  });
  const client = new SpotActivationClient(call, () => operationId);
  await client.activate({ id: "native-report", activation, frequencyKHz: 28020, mode: "CW" });
  expect(call).toHaveBeenNthCalledWith(1, "activate_spot", { operationId, spotId: "native-report", ...activation });
  expect(call).toHaveBeenNthCalledWith(2, "spot_activation_reconcile", { operationId });
  render(<SpotActivationStatus status={client.getSnapshot().status} error={client.getSnapshot().error} reconcile={() => {}} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Check activation" })).toBeNull();
  expect(client.getSnapshot().status).toMatchObject({ tuneConfirmed: false });
  expect(activationMessage(client.getSnapshot().status)).toContain("radio tune is not confirmed");
  expect(call.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1);
  client.dispose();
});
