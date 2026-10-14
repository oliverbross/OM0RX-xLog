// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LogbookPanel from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const contact = { id: "1d9961f9-3eb1-42ca-8d0a-063eb21b4577", call: "W1AW", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
const adif = "<CALL:4>W1AW<QSO_DATE:8>20261014<TIME_ON:6>000000<BAND:3>20m<MODE:2>CW<EOR>";
function setup(issue = false) {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "logbook_import_adif" && params?.action === "update") return { updated: 1 };
    if (method === "logbook_import_adif") return params?.action === "preview"
      ? { records: 1, duplicates: 0, inserts: 1, generation: "workspace-1", token: "preview-1", issues: issue ? [{ record: 1, message: "Invalid UTC date" }] : [] }
      : { imported: 1, skipped_duplicates: 0 };
    if (method === "logbook_export_adif") return params?.action === "begin" ? { token: "frozen", total: 1 } : { text: adif, count: 1 };
    return { qsos: [contact], total: 1, offset: 0, limit: 20 };
  });
  const view = render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
  async function pick(bytes = new TextEncoder().encode(adif)) {
    const file = new File([], "review.adi"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    await act(async () => { fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } }); });
  }
  return { request, pick };
}

it("validates before consent and imports only after explicit confirmation", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(); await screen.findByRole("group", { name: "Review ADIF import" });
  expect(request.mock.calls.filter(([method, params]) => method === "logbook_import_adif" && !params?.action)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
  expect(screen.queryByRole("button", { name: "Confirm import" })).toBeNull();
  await pick(); fireEvent.click(await screen.findByRole("button", { name: "Confirm import" }));
  await screen.findByText("1 QSOs imported; 0 duplicates skipped.");
  expect(request.mock.calls.filter(([method, params]) => method === "logbook_import_adif" && !params?.action)).toHaveLength(1);
  expect(request).toHaveBeenCalledWith("logbook_import_adif", { text: adif, generation: "workspace-1" });
});

it("rejects invalid UTF-8 bytes before requesting any preview", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(new Uint8Array([0xff]));
  expect((await screen.findByRole("alert")).textContent).toContain("Only UTF-8 ADI");
  expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(0);
});

it("requires selected fields and explicit update consent and sends the reviewed context", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW"); await pick();
  fireEvent.click(screen.getByRole("checkbox", { name: "Update selected fields of reviewed duplicates instead" }));
  expect((screen.getByRole("button", { name: "Confirm duplicate updates" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "NAME" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "POTA_REF" }));
  expect(request.mock.calls.filter(([, params]) => params?.action === "update")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm duplicate updates" }));
  await screen.findByText("1 duplicate QSOs updated. New and repeated records were skipped.");
  expect(request).toHaveBeenCalledWith("logbook_import_adif", { action: "update", token: "preview-1", generation: "workspace-1", chunk: 0, fields: ["NAME", "POTA_REF"], confirmed: true });
});

it("reports acknowledged updates and uncertain last-batch outcome after partial failure", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => {
    if (method === "logbook_import_adif" && params?.action === "update" && params.chunk === 1) throw new Error("Target changed");
    return original(method, params);
  });
  await pick(new TextEncoder().encode(adif.repeat(101)));
  fireEvent.click(screen.getByRole("checkbox", { name: "Update selected fields of reviewed duplicates instead" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "NAME" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm duplicate updates" }));
  expect((await screen.findByRole("alert")).textContent).toContain("1 updates acknowledged");
  expect(screen.getByRole("alert").textContent).toContain("last batch may have committed");
});

it("continues later chunks with the native preview token and generation", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(new TextEncoder().encode(adif.repeat(101)));
  await screen.findByRole("group", { name: "Review ADIF import" });
  expect(request).toHaveBeenCalledWith("logbook_import_adif", {
    action: "preview", text: adif, chunk: 1, token: "preview-1", generation: "workspace-1",
  });
});

it("keeps invalid records out of the import path", async () => {
  const { request, pick } = setup(true); await screen.findByText("W1AW"); await pick();
  expect((await screen.findByRole("alert")).textContent).toContain("Invalid UTC date");
  expect(screen.queryByRole("button", { name: "Confirm import" })).toBeNull();
  expect(request.mock.calls.filter(([method, params]) => method === "logbook_import_adif" && !params?.action)).toHaveLength(0);
});

it("exports the committed search or selected identity through a frozen snapshot", async () => {
  const { request } = setup(); await screen.findByText("W1AW");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByText("W1AW")); fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "read", token: "frozen", offset: 0, limit: 20 }));
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "selected", ids: [contact.id] });
  fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "W1AW" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Export filtered" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "filtered", search: "W1AW" }));
});
