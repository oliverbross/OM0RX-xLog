// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountryCorrectionReview } from "./CountryCorrectionReview";
import CountryReferenceControl from "./CountryReferenceControl";

afterEach(cleanup);
const generation = "11111111-1111-4111-8111-111111111111", contactID = "22222222-2222-4222-8222-222222222222";
const reviewID = "33333333-3333-4333-8333-333333333333", operationID = "44444444-4444-4444-8444-444444444444";
const row = { contactID, revision: 7, call: "OM0RX/P", start: "2020-01-01T12:00:00Z",
  facts: { status: "resolved", referenceRevision: "fixture-snapshot", matchedRule: "OM" },
  changes: [{ field: "cqZone", retained: "14", proposed: "15", retainedOrigin: "retainedOriginUnknownProtected", reason: "UTC QSO date; explicit operator selection required" }] };
function requestFixture() {
  return vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<any> => {
    switch (method) {
      case "workspace_status": return { generation };
      case "logbook_country_review": return { generation, read_only: true, page: { rows: [row], comparedCount: 101, affectedCount: 1, unresolvedCount: 0, limit: 20, offset: 0, referenceRevision: "fixture-snapshot" } };
      case "logbook_country_correction_preview": return { generation, read_only: true, reviewID, rows: [row], referenceRevision: "fixture-snapshot" };
      case "logbook_country_correction_cancel": return { generation, status: "cancelled", contacts_changed: false };
      case "logbook_country_correction_apply": return { generation, status: "applied", receipts: [{ mutation: { operationID }, contact: { qso: { call: row.call } } }] };
      case "logbook_country_correction_undo": return { generation, status: "applied" };
      default: throw new Error("Unexpected operation " + method);
    }
  });
}
async function openReview(request: ReturnType<typeof requestFixture>) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Read country field differences" }));
  await user.click(await screen.findByRole("checkbox", { name: `Review OM0RX/P ${contactID}` }));
  await user.click(screen.getByRole("button", { name: "Review selected contacts" }));
  await screen.findByRole("group", { name: /OM0RX\/P/ });
  expect(request).toHaveBeenCalledWith("logbook_country_correction_preview", { generation, contacts: [{ contactID, expectedRevision: 7 }] });
  return user;
}

it("reads only on demand and Keep cancels an unselected native review without contact/output calls", async () => {
  const request = requestFixture();
  render(<CountryCorrectionReview onRequest={request} refreshKey={0} />);
  expect(request).not.toHaveBeenCalled();
  const user = await openReview(request);
  expect((screen.getByRole("checkbox", { name: /cqZone: 14/ }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button", { name: "Apply selected country changes" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Keep recorded values" }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("logbook_country_correction_cancel", { generation, reviewID }));
  expect(request.mock.calls.every(([method]) => ["workspace_status", "logbook_country_review", "logbook_country_correction_preview", "logbook_country_correction_cancel"].includes(method))).toBe(true);
});

it("sends only explicitly selected country fields and keeps recovery bound to the receipt workspace", async () => {
  const request = requestFixture(), changed = vi.fn();
  const view = render(<CountryCorrectionReview onRequest={request} refreshKey={0} onChanged={changed} />);
  const user = await openReview(request);
  await user.click(screen.getByRole("checkbox", { name: /cqZone: 14/ }));
  await user.click(screen.getByRole("button", { name: "Apply selected country changes" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith("logbook_country_correction_apply", { generation, reviewID, selection: [{ contactID, fields: ["cqZone"] }] });
  view.rerender(<CountryCorrectionReview onRequest={request} refreshKey={1} onChanged={changed} />);
  await user.click(screen.getByRole("button", { name: "Recover country correction" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  expect(request).toHaveBeenLastCalledWith("logbook_country_correction_undo", { generation, operationID, undoOperationID: expect.any(String) });
  expect(request.mock.calls.some(([method]) => /ptt|cw_|station_|logbook_save/.test(method))).toBe(false);
});

it("rejects a native preview with a different reference before offering apply", async () => {
  const request = requestFixture(), original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => method === "logbook_country_correction_preview"
    ? { generation, read_only: true, reviewID, rows: [row], referenceRevision: "different-snapshot" } : original(method, params));
  render(<CountryCorrectionReview onRequest={request} refreshKey={0} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Read country field differences" }));
  await user.click(await screen.findByRole("checkbox", { name: `Review OM0RX/P ${contactID}` }));
  await user.click(screen.getByRole("button", { name: "Review selected contacts" }));
  expect((await screen.findByRole("alert")).textContent).toContain("country evidence changed");
  expect(screen.queryByRole("button", { name: "Apply selected country changes" })).toBeNull();
});

it("cancels a pending read by its captured native scan scope and ignores its late response", async () => {
  let finish: ((value: unknown) => void) | undefined;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<any> => {
    if (method === "workspace_status") return { generation };
    if (method === "logbook_country_review") return new Promise(resolve => { finish = resolve; });
    if (method === "logbook_country_review_cancel") return { generation, status: "cancelled", contacts_changed: false };
    throw new Error("Unexpected mutation " + method + JSON.stringify(params));
  });
  render(<CountryCorrectionReview onRequest={request} refreshKey={0} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Read country field differences" }));
  await user.click(await screen.findByRole("button", { name: "Cancel country scan" }));
  await screen.findByText("Country scan cancelled. No contacts changed.");
  const captured = request.mock.calls.find(([method]) => method === "logbook_country_review")?.[1];
  expect(request).toHaveBeenLastCalledWith("logbook_country_review_cancel", { generation, scanID: captured?.scanID });
  finish?.({ generation, read_only: true, page: { rows: [row], comparedCount: 1, affectedCount: 1, unresolvedCount: 0, limit: 20, offset: 0, referenceRevision: "fixture-snapshot" } });
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: `Review OM0RX/P ${contactID}` })).toBeNull());
  expect(request.mock.calls.every(([method]) => ["workspace_status", "logbook_country_review", "logbook_country_review_cancel"].includes(method))).toBe(true);
});

it("country reference controls issue only explicit reference actions and never a contact or station mutation", async () => {
  const snapshot = { reference_revision: "fixture", provider: "OK1RR fixture", source_revision: "pinned", source_version: null,
    record_count: 21343, excluded_count: 294, coverage: ["current-and-deleted"], rollback_available: true, country_reference_changed: true };
  const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => snapshot);
  render(<CountryReferenceControl request={request} visible />);
  const user = userEvent.setup();
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Read country snapshot" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Restore previous country snapshot" }) as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByRole("textbox", { name: "Country pack file" }), "/private/tmp/reviewed-pack.json");
  await user.click(screen.getByRole("button", { name: "Validate and import country pack" }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("reference_country_import", { path: "/private/tmp/reviewed-pack.json" }));
  expect(request.mock.calls.every(([method]) => String(method).startsWith("reference_country_"))).toBe(true);
});
