// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import QSOHeader from "./QSOHeader";
import { DeskQSO } from "./OperatorDesk";
import QSOEditor from "./QSOEditor";

afterEach(cleanup);
const evidence = { call: "H49A", rows: [{ kind: "iota", reference: "OC-047", status: "verified", name: "Solomon Islands" }] };
const draft = { id: "fixture", call: "H49A", start: "2026-10-13T01:19:31Z", frequencyHz: 28020000, band: "10m", mode: "CW", iota: "OC-047" };
const props = { draft, setDraft: vi.fn(), save: vi.fn(), clear: vi.fn(), busy: false, lookup: null, previous: [], request: vi.fn(async () => ({})),
  refresh: 0, onEditor: vi.fn(), onReadRadio: vi.fn(async () => {}), follow: false, setFollow: vi.fn(), rotor: null, autoRotor: false, setAutoRotor: vi.fn(), onManualRotor: vi.fn(), referenceEvidence: evidence };

it("keeps reference verification beside the heading without changing its accessible name", () => {
  render(<QSOHeader title="Active QSO" call=" h49a " evidence={evidence} />);
  const heading = screen.getByRole("heading", { name: "Active QSO" });
  expect(within(heading.parentElement!).getByRole("status").textContent).toContain("IOTA OC-047 · Verified: Solomon Islands");
});
it("does not show another call's reference evidence or an empty status", () => {
  const view = render(<QSOHeader title="Active QSO" call="W1AW" evidence={evidence} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<QSOHeader title="Active QSO" call="H49A" evidence={{ call: "H49A", rows: [] }} />);
  expect(screen.queryByRole("status")).toBeNull();
});
it("retains missing directory and unverified reference information alongside verified rows", () => {
  render(<QSOHeader title="Active QSO" call="H49A" evidence={{ call: "H49A", rows: [...evidence.rows,
    { kind: "pota", reference: "XX-0001", status: "not_installed" }, { kind: "sota", reference: "XX/YY-001", status: "not_found" }] }} />);
  expect(screen.getByRole("status").children).toHaveLength(3);
  expect(screen.getByText(/POTA XX-0001 · Directory not installed/)).toBeTruthy();
  expect(screen.getByText(/SOTA XX\/YY-001 · Not found in installed directory/)).toBeTruthy();
});
it.each(["desk", "editor"])("puts evidence inside the %s QSO header, not above the panel", kind => {
  render(kind === "desk" ? <DeskQSO {...props} /> : <QSOEditor {...props} />);
  const heading = screen.getByRole("heading", { name: kind === "desk" ? "Active QSO" : "Active contact" });
  expect(screen.getByRole("status").parentElement).toBe(heading.parentElement);
  expect(heading.parentElement?.closest(kind === "desk" ? ".desk-active" : ".qso-active")).toBeTruthy();
});
it("removes the global tuning status row while retaining the authoritative tune fence and errors", () => {
  const source = readFileSync("src/LiveApp.tsx", "utf8");
  expect(source).not.toContain("waiting for observed radio state");
  expect(source).not.toContain("request accepted; awaiting observation");
  expect(source).not.toContain("referenceEvidence.rows.map");
  expect(source).toContain("confirmed: result.confirmed === true");
  expect(source).toContain("setError(e.message)");
});
