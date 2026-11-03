// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { POTAExportPanel } from "./POTAExportPanel";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
afterEach(() => { cleanup(); native.invoke.mockReset(); });
const text = "<ADIF_VER:5>3.1.7<EOH>\r\n<CALL:5>K1ABC<NAME:6>Ľuboš<EOR>\r\n";
const file = { filename: "1-OM0RX@SK-0001--all-days.adi", stationCall: "OM0RX", ownPark: "SK-0001", state: "", physicalContacts: 1, derivedRecords: 1 };
function fixture(excluded = false) {
  const issues = excluded ? [{ contactID: "bad", message: "Missing own POTA park" }] : [];
  const request = vi.fn(async (_method: string, params?: Record<string, any>): Promise<any> => {
    if (!params?.action) return { settings: {} };
    switch (params.action) {
      case "begin": return { token: "frozen", total: excluded ? 2 : 1 };
      case "pota_preview": return { version: 1, rulesVersion: "POTA fixture", sourceURLs: [], capturedAt: "2026-11-03T00:00:00Z", physicalContacts: excluded ? 2 : 1, includedContacts: 1, derivedRecords: 1, files: [file], issues, warnings: [], fileCount: 1, issueCount: issues.length };
      case "pota_files": return { files: [file], total: 1 };
      case "pota_issues": return { issues, total: issues.length };
      case "pota_read": {
        const bytes = new TextEncoder().encode(text), chunk = bytes.slice(params.offset, Math.min(params.offset + 13, bytes.length));
        return { bytes: btoa(String.fromCharCode(...chunk)), count: chunk.length, total: bytes.length };
      }
      default: throw new Error("Unexpected mutation or source read");
    }
  });
  native.invoke.mockResolvedValue({ saved: true });
  render(<POTAExportPanel request={request} selection={{ scope: "selected", ids: ["one"] }} onClose={() => {}} />);
  return request;
}
it("publishes the exact frozen native file bytes after review without source mutation", async () => {
  const request = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview"));
  await screen.findByText("POTA fixture · captured 2026-11-03T00:00:00Z");
  expect((screen.getByText("Save reviewed file set") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  fireEvent.click(screen.getByText("Save reviewed file set"));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
  expect(native.invoke.mock.calls[0]).toMatchObject(["logbook_export_pota_set", { preview: { files: [{ ...file, text }] } }]);
  expect(request.mock.calls.every(([method]) => ["settings_load", "logbook_export_adif"].includes(method))).toBe(true);
  const reads = request.mock.calls.filter(([, p]) => p?.action === "pota_read");
  expect(reads.length).toBeGreaterThan(1); expect(reads.every(([, p]) => p?.token === "frozen")).toBe(true);
});
it("requires explicit valid-subset selection when exclusions exist", async () => {
  fixture(true); fireEvent.click(screen.getByText("Freeze selection and preview"));
  await screen.findByText(/bad: Missing own POTA park/);
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  expect((screen.getByText("Save reviewed file set") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Export the displayed valid subset and retain these exclusions in the manifest"));
  expect((screen.getByText("Save reviewed file set") as HTMLButtonElement).disabled).toBe(false);
  expect(native.invoke).not.toHaveBeenCalled();
});
