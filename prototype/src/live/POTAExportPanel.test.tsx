// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { POTAExportPanel } from "./POTAExportPanel";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
afterEach(() => { cleanup(); native.invoke.mockReset(); });
const text = "<ADIF_VER:5>3.1.7<EOH>\r\n<CALL:5>K1ABC<NAME:6>Ľuboš<EOR>\r\n";
const file = { filename: "1-OM0RX@SK-0001--all-days.adi", stationCall: "OM0RX", ownPark: "SK-0001", state: "", physicalContacts: 1, derivedRecords: 1 };
function fixture(excluded = false, callbacks: { onClose?: () => void; onWorking?: (value: boolean) => void } = {}) {
  const issues = excluded ? [{ contactID: "bad", message: "Missing own POTA park" }] : [];
  const request = vi.fn(async (_method: string, params?: Record<string, any>): Promise<any> => {
    if (!params?.action) return { settings: {} };
    switch (params.action) {
      case "begin": return { token: "frozen", workspace_generation: "workspace-1", total: excluded ? 2 : 1 };
      case "retire": return { retired: true };
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
  const props = { request, selection: { scope: "selected", ids: ["one"] }, onClose: callbacks.onClose ?? (() => {}), onWorking: callbacks.onWorking };
  const view = render(<POTAExportPanel {...props} />);
  return { request, view, props };
}
it("publishes the exact frozen native file bytes after review without source mutation", async () => {
  const { request } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview"));
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
it("removes an older reviewed population when refreshing its snapshot fails", async () => {
  const { request } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview"));
  await screen.findByText("POTA fixture · captured 2026-11-03T00:00:00Z");
  request.mockRejectedValueOnce(new Error("The selection exceeds the bounded POTA preview budget."));
  fireEvent.click(screen.getByText("Freeze selection and preview"));
  await screen.findByText("The selection exceeds the bounded POTA preview budget.");
  expect(screen.queryByText("Save reviewed file set")).toBeNull(); expect(native.invoke).not.toHaveBeenCalled();
});

it("retires the exact frozen session on the actual Close control without mutating source contacts", async () => {
  const close = vi.fn(); const { request } = fixture(false, { onClose: close });
  fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  expect(request.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  fireEvent.click(screen.getByText("Close POTA export")); expect(close).toHaveBeenCalledOnce();
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
  expect(screen.queryByText("Save reviewed file set")).toBeNull(); expect(native.invoke).not.toHaveBeenCalled();
  expect(request.mock.calls.every(([method]) => ["settings_load", "logbook_export_adif"].includes(method))).toBe(true);
});

it("keeps the valid frozen preview through save cancellation and repeat saves until Close", async () => {
  const { request } = fixture(); native.invoke.mockResolvedValueOnce({ cancelled: true });
  fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  fireEvent.click(screen.getByText("Save reviewed file set")); await screen.findByText("Export cancelled. No files published.");
  expect(request.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  fireEvent.click(screen.getByText("Save reviewed file set")); await screen.findByText("Published 1 ADI files and manifest.");
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(native.invoke.mock.calls[0][1].preview.files[0].text).toBe(text);
  expect(native.invoke.mock.calls[1][1].preview.files[0].text).toBe(text);
  expect(request.mock.calls.filter(([, p]) => p?.action === "begin")).toHaveLength(1);
  expect(request.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  fireEvent.click(screen.getByText("Close POTA export"));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
});

it("retires an invalidated preview and binds a fresh replacement without old consent", async () => {
  const { request } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  fireEvent.change(screen.getByLabelText("POTA export own park assignment"), { target: { value: "SK-0002" } });
  expect(screen.queryByText("Save reviewed file set")).toBeNull();
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => params?.action === "begin"
    ? { token: "replacement", workspace_generation: "workspace-1", total: 1 } : original(method, params));
  fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  expect(screen.getByText("Save reviewed file set")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByText("Close POTA export"));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "replacement", generation: "workspace-1" }));
  expect(native.invoke).not.toHaveBeenCalled();
});

it("retires a late begin reply after unmount without starting preview or reviving working state", async () => {
  const working = vi.fn(); const { request, view } = fixture(false, { onWorking: working });
  const original = request.getMockImplementation()!; let finish!: (value: object) => void;
  request.mockImplementation(async (method, params) => params?.action === "begin" ? new Promise(resolve => { finish = resolve; }) : original(method, params));
  fireEvent.click(screen.getByText("Freeze selection and preview")); await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.unmount(); expect(working.mock.calls).toEqual([[true], [false]]);
  await act(async () => finish({ token: "late-owner", workspace_generation: "old-workspace", total: 1 }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "late-owner", generation: "old-workspace" }));
  expect(request.mock.calls.some(([, p]) => p?.action === "pota_preview")).toBe(false);
  expect(working.mock.calls).toEqual([[true], [false]]); expect(native.invoke).not.toHaveBeenCalled();
});

it("waits for the admitted file read before unmount retirement and never publishes its late bytes", async () => {
  const { request, view } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  const original = request.getMockImplementation()!; let finish!: (value: object) => void;
  request.mockImplementation(async (method, params) => params?.action === "pota_read" ? new Promise(resolve => { finish = resolve; }) : original(method, params));
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  fireEvent.click(screen.getByText("Save reviewed file set")); await waitFor(() => expect(finish).toBeTypeOf("function")); view.unmount();
  expect(request.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  const bytes = new TextEncoder().encode(text), chunk = bytes.slice(0, 13);
  await act(async () => finish({ bytes: btoa(String.fromCharCode(...chunk)), count: chunk.length, total: bytes.length }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
  expect(request.mock.calls.filter(([, p]) => p?.action === "pota_read")).toHaveLength(1); expect(native.invoke).not.toHaveBeenCalled();
});

it("does not let a late old begin retire or unlatch a replacement owner's active preview", async () => {
  const working = vi.fn(); const { request, view, props } = fixture(false, { onWorking: working });
  const original = request.getMockImplementation()!; let finishOld!: (value: object) => void, finishNew!: (value: object) => void;
  request.mockImplementation(async (method, params) => params?.action === "begin" ? new Promise(resolve => { finishOld = resolve; }) : original(method, params));
  fireEvent.click(screen.getByText("Freeze selection and preview")); await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  const replacement = vi.fn(async (method: string, params?: Record<string, any>): Promise<any> => params?.action === "begin"
    ? new Promise(resolve => { finishNew = resolve; }) : original(method, params));
  view.rerender(<POTAExportPanel {...props} request={replacement} />);
  fireEvent.click(screen.getByText("Freeze selection and preview")); await waitFor(() => expect(finishNew).toBeTypeOf("function"));
  await act(async () => finishOld({ token: "old-owner", workspace_generation: "old-workspace", total: 1 }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "old-owner", generation: "old-workspace" }));
  expect(screen.getByText("Freeze selection and preview")).toHaveProperty("disabled", true);
  expect(working.mock.calls).toEqual([[true], [false], [true]]);
  expect(replacement.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  await act(async () => finishNew({ token: "new-owner", workspace_generation: "new-workspace", total: 1 }));
  await screen.findByText(/POTA fixture · captured/);
  expect(working.mock.calls).toEqual([[true], [false], [true], [false]]);
  fireEvent.click(screen.getByText("Close POTA export"));
  await waitFor(() => expect(replacement).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "new-owner", generation: "new-workspace" }));
  expect(native.invoke).not.toHaveBeenCalled();
});

it("preserves a frozen preview on equal-selection renders and retires it on actual replacement", async () => {
  const { request, view, props } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  view.rerender(<POTAExportPanel {...props} selection={{ scope: "selected", ids: ["one"] }} />);
  expect(screen.getByText("Save reviewed file set")).toBeTruthy(); expect(request.mock.calls.some(([, p]) => p?.action === "retire")).toBe(false);
  view.rerender(<POTAExportPanel {...props} selection={{ scope: "selected", ids: ["two"] }} />);
  expect(screen.queryByText("Save reviewed file set")).toBeNull();
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
});

it("clears expired native preview evidence without publishing a partial file", async () => {
  const { request } = fixture(); fireEvent.click(screen.getByText("Freeze selection and preview")); await screen.findByText(/POTA fixture · captured/);
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => { if (params?.action === "pota_read") throw new Error("The export snapshot expired. Start again."); return original(method, params); });
  fireEvent.click(screen.getByLabelText("I reviewed own park identities and the correct subdivision for parks spanning locations"));
  fireEvent.click(screen.getByText("Save reviewed file set")); await screen.findByText(/export snapshot expired/);
  expect(screen.queryByText("Save reviewed file set")).toBeNull();
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen", generation: "workspace-1" }));
  expect(native.invoke).not.toHaveBeenCalled();
});
