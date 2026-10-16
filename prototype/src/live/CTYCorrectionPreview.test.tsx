// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CTYCorrectionPreview } from "./CTYCorrectionPreview";
import { LogbookPanel } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";

afterEach(cleanup);
const row = { id: "qso-identity", call: "PJ2T", start: "2025-06-15T12:30:00Z", previousADIF: 305, previousCountry: "BANGLADESH", currentADIF: 517, currentCountry: "CURACAO" };
function snapshot(offset = 0) {
  return { source: "bundled", preview: { rows: [{ ...row, id: `qso-${offset}`, call: offset ? "PJ9UNKNOWN" : "PJ2T", ...(offset ? { currentADIF: undefined, currentCountry: undefined } : {}) }], affectedCount: 21, protectedOverrideCount: 3, limit: 20, offset } };
}

it("opens from the shared Logbook toolbar only on explicit request and closes without writes", async () => {
  const request = vi.fn(async (method: string) => method === "logbook_cty_preview" ? snapshot()
    : { qsos: [], total: 0, offset: 0, limit: 20 });
  render(<LogbookPanel onRequest={request} refreshKey={0} onEdit={vi.fn()}
    mutations={new LogbookMutationSession(request, () => {})} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_list", expect.anything()));
  expect(request.mock.calls.some(([method]) => method === "logbook_cty_preview")).toBe(false);
  const toggle = screen.getByRole("button", { name: "PJ country preview" });
  fireEvent.click(toggle);
  await screen.findByText("CURACAO (517)");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(toggle);
  expect(screen.queryByRole("region", { name: "PJ country inference preview" })).toBeNull();
  expect(request.mock.calls.every(([method]) => ["logbook_list", "logbook_cty_preview"].includes(method))).toBe(true);
});

it("shows inferred before/after values, protected count and identity, paging with only the read route", async () => {
  const request = vi.fn(async (_method, params) => ({ result: snapshot(params.offset) }));
  render(<CTYCorrectionPreview onRequest={request} refreshKey={0} />);
  expect(await screen.findByText("CURACAO (517)")).toBeTruthy();
  expect(screen.getByText("BANGLADESH (305)")).toBeTruthy();
  expect(screen.getByText(/3 PJ contacts protected by stored DXCC/)).toBeTruthy();
  expect(screen.getByText("qso-0")).toBeTruthy();
  expect(screen.getByText("2025-06-15 12:30:00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next preview page" }));
  expect(await screen.findByText("Unresolved")).toBeTruthy();
  expect(request).toHaveBeenLastCalledWith("logbook_cty_preview", { limit: 20, offset: 20 });
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  await screen.findByText("CURACAO (517)");
  expect(request.mock.calls.every(([method]) => method === "logbook_cty_preview")).toBe(true);
  expect(screen.queryByRole("button", { name: /apply|correct|fix/i })).toBeNull();
});

it("clears stale results, reports errors and supports an empty retry", async () => {
  const request = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error("workspace closed"))
    .mockResolvedValueOnce({ source: "downloaded", preview: { rows: [], affectedCount: 0, protectedOverrideCount: 0, limit: 20, offset: 0 } });
  const view = render(<CTYCorrectionPreview onRequest={request} refreshKey={0} />);
  await screen.findByText("CURACAO (517)");
  view.rerender(<CTYCorrectionPreview onRequest={request} refreshKey={1} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("CURACAO (517)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  await waitFor(() => expect(screen.getByText(/No inferred PJ classifications differ/)).toBeTruthy());
});
