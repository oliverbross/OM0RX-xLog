// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LogbookContactReview } from "./LogbookContactReview";
import type { DraftSnapshot } from "./operatorDraftSession";

afterEach(cleanup);
const id = "11111111-1111-1111-1111-111111111111", generation = "22222222-2222-2222-2222-222222222222";
const qso = { id, call: "OM0RX", updatedAt: "2026-10-16T10:00:00Z" };
const contact = { generation, revision: 7, qso };
const evidence = { field: "dxcc", value: "305", source: "storedFieldOriginUnknown", date: null, dateRole: "fieldOriginUnknown", rawDate: null, referenceSource: null, referenceVersion: null };
const report = { contactID: id, contactRevision: 7, contactStart: "2026-10-15T00:00:00Z", recordUpdatedAtNotFieldOrigin: qso.updatedAt,
  retainedFields: [evidence], referenceStatus: "resolved", referenceComparison: { ...evidence, value: "517", source: "suppliedCTYReference", dateRole: "referenceSourceDate", referenceSource: "bundled_cty" },
  retainedPowerObservation: null, findings: [{ kind: "storedDXCCDisagreesWithReference", field: "dxcc", severity: "warning", message: "Stored override remains authoritative.", retained: evidence,
    comparison: { ...evidence, value: "517", source: "suppliedCTYReference", dateRole: "referenceSourceDate" }, reviewImpacts: ["dxccDependentViewsAndRules"] }] };
const response = { generation, read_only: true, duplicate_review: "notPerformed", conflict_review: "notRequested", data_quality: report };
const renderContact = (value: DraftSnapshot) => <p>Canonical {value.qso.call} · {value.revision}</p>;
function props(request: any) { return { contactID: id, call: "OM0RX", onRequest: request, pageContext: "page-1", renderContact }; }
describe("canonical Logbook Details quality review", () => {
  it("loads once, then requests findings only on demand using that exact scope", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : response);
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7");
    expect(request.mock.calls).toHaveLength(1);
    fireEvent.click(screen.getByText("Read findings"));
    await screen.findByText("Stored override remains authoritative.");
    expect(request).toHaveBeenLastCalledWith("logbook_data_quality", { contactID: id, generation, expectedRevision: 7 });
    expect(request.mock.calls).toHaveLength(2);
    expect(screen.getByText("DXCC-dependent views and rules", { exact: false })).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Field origin date").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reference source date").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /correct|apply|resolve|refresh provider/i })).toBeNull();
  });
  it.each(["contact_changed", "workspace_changed", "missing"])("retires scope and evidence after %s without upgrading or retrying", async status => {
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } :
      status === "missing" ? { generation, read_only: true, data_quality: null } : { generation, read_only: true, status });
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Canonical OM0RX · 7")).toBeNull();
    expect((screen.getByText("Read findings") as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls).toHaveLength(2);
  });
  it("rejects unavailable and mismatched canonical contact reads", async () => {
    const request = vi.fn(async () => ({ generation, contact: { ...contact, generation: id } }));
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByRole("alert"); expect((screen.getByText("Read findings") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Canonical OM0RX · 7")).toBeNull();
  });
  it("discards pending findings on close and page refresh, with no automatic finding read", async () => {
    let finish!: (value: unknown) => void;
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : new Promise(resolve => { finish = resolve; }));
    const view = render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    view.rerender(<LogbookContactReview {...props(request)} pageContext="page-2" />);
    await screen.findByText("Canonical OM0RX · 7"); await act(async () => finish(response));
    expect(screen.queryByText("Stored override remains authoritative.")).toBeNull();
    expect(request.mock.calls.filter(([method]) => method === "logbook_data_quality")).toHaveLength(1);
    fireEvent.click(screen.getByText("Read findings")); view.unmount(); await act(async () => finish(response));
    expect(screen.queryByLabelText("Read-only data quality")).toBeNull();
  });
  it("clears displayed findings before reading again and rejects malformed evidence", async () => {
    let count = 0;
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : ++count === 1 ? response : { ...response, data_quality: { ...report, findings: [{}] } });
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    await screen.findByText("Stored override remains authoritative."); fireEvent.click(screen.getByText("Read findings"));
    expect(screen.queryByText("Stored override remains authoritative.")).toBeNull(); await screen.findByRole("alert");
  });
  it("keeps a loading shell during page refresh and does not read or upgrade scope until the page settles", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : response);
    const view = render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    await screen.findByText("Stored override remains authoritative.");
    view.rerender(<LogbookContactReview {...props(request)} pageLoading />);
    expect(screen.getByLabelText("Details for OM0RX")).toBeTruthy();
    expect(screen.queryByText("Stored override remains authoritative.")).toBeNull();
    expect(request.mock.calls).toHaveLength(2);
    view.rerender(<LogbookContactReview {...props(request)} pageContext="settled-page" />);
    await screen.findByText("Canonical OM0RX · 7");
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls.filter(([method]) => method === "logbook_data_quality")).toHaveLength(1);
  });
  it("retires pending canonical and finding responses on selection changes", async () => {
    let finishContact!: (value: unknown) => void, finishFindings!: (value: unknown) => void;
    const nextID = "33333333-3333-3333-3333-333333333333";
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "logbook_contact"
      ? params?.contactID === id ? new Promise(resolve => { finishContact = resolve; }) : { generation, contact: { ...contact, qso: { ...qso, id: nextID, call: "W1AW" } } }
      : new Promise(resolve => { finishFindings = resolve; }));
    const view = render(<LogbookContactReview {...props(request)} />);
    view.rerender(<LogbookContactReview {...props(request)} contactID={nextID} call="W1AW" />);
    await screen.findByText("Canonical W1AW · 7"); await act(async () => finishContact({ generation, contact }));
    expect(screen.queryByText("Canonical OM0RX · 7")).toBeNull();
    fireEvent.click(screen.getByText("Read findings"));
    view.rerender(<LogbookContactReview {...props(request)} />);
    await act(async () => finishFindings({ ...response, data_quality: { ...report, contactID: nextID } }));
    expect(screen.queryByText("Stored override remains authoritative.")).toBeNull();
  });
  it.each(["complete", "truncated", "unknown"])("shows bounded duplicate state %s without offering mutations", async status => {
    const candidates = Array.from({ length: status === "truncated" ? 5 : status === "unknown" ? 0 : 1 }, (_, index) => ({
      contactID: `33333333-3333-3333-3333-33333333333${index}`, contactRevision: index + 1, call: "OM0RX/P", band: "20m", mode: "CW", contactStart: "2026-10-16T10:00:01Z",
    }));
    const duplicateReview = { rule: "nativePossibleDuplicate600SecondsV1", windowSeconds: 600, candidateLimit: 5, status,
      unresolvedRequirements: status === "unknown" ? ["missingBand"] : [], candidates };
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : { ...response, data_quality: { ...report, duplicateReview } });
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    const section = await screen.findByLabelText("Read-only possible duplicate review");
    expect(section.textContent).toContain(status === "truncated" ? "Total candidate count unknown" : status === "unknown" ? "Missing band" : "Complete for this bounded rule");
    expect(section.querySelectorAll("li")).toHaveLength(candidates.length);
    expect(section.querySelectorAll("button")).toHaveLength(0);
    if (candidates.length) expect(section.textContent).toContain("original field source/date unknown");
  });
  it.each(["self", "overLimit"])("rejects %s duplicate candidates rather than displaying them", async invalid => {
    const duplicateReview = { rule: "nativePossibleDuplicate600SecondsV1", windowSeconds: 600, candidateLimit: 5, status: "complete", unresolvedRequirements: [],
      candidates: [{ contactID: id, contactRevision: 7, call: "OM0RX", band: "20m", mode: "CW", contactStart: "2026-10-16T10:00:00Z" }] };
    if (invalid === "overLimit") duplicateReview.candidates = Array.from({ length: 6 }, (_, index) => ({ ...duplicateReview.candidates[0], contactID: `33333333-3333-3333-3333-33333333333${index}` }));
    const request = vi.fn(async (method: string) => method === "logbook_contact" ? { generation, contact } : { ...response, data_quality: { ...report, duplicateReview } });
    render(<LogbookContactReview {...props(request)} />);
    await screen.findByText("Canonical OM0RX · 7"); fireEvent.click(screen.getByText("Read findings"));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Read-only possible duplicate review")).toBeNull();
  });
});
