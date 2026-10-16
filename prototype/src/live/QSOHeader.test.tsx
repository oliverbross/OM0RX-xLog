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
  await expect(client.activate({ id: "native-report", activation, frequencyKHz: 28020, mode: "CW" })).rejects.toThrow("lost");
  expect(call).toHaveBeenCalledExactlyOnceWith("activate_spot", { operationId, spotId: "native-report", ...activation });
  render(<SpotActivationStatus status={client.getSnapshot().status} error={client.getSnapshot().error} reconcile={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain("Activation acknowledgement unavailable");
  expect(screen.getByRole("button", { name: "Check activation" })).toBeTruthy();
  await client.refresh();
  expect(call).toHaveBeenLastCalledWith("spot_activation_status", { operationId });
  expect(client.getSnapshot().status).toMatchObject({ tuneConfirmed: false });
  expect(activationMessage(client.getSnapshot().status)).toContain("radio tune is not confirmed");
  expect(call.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1);
  client.dispose();
});
