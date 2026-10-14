// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LogbookPanel from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const contact = { id: "1d9961f9-3eb1-42ca-8d0a-063eb21b4577", call: "W1AW", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
const adif = "<CALL:4>W1AW<QSO_DATE:8>20261014<TIME_ON:6>000000<BAND:3>20m<MODE:2>CW<EOR>";
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(blob);
  });
}
function setup(issue = false, contacts = [contact]) {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "logbook_import_adif" && params?.action === "update") return { updated: 1 };
    if (method === "logbook_import_adif") return params?.action === "preview"
      ? { records: 1, duplicates: 0, inserts: 1, generation: "workspace-1", token: "preview-1", issues: issue ? [{ record: 1, message: "Invalid UTC date" }] : [] }
      : { imported: 1, skipped_duplicates: 0 };
    if (method === "logbook_export_adif") return params?.action === "begin" ? { token: "frozen", total: 1 } : { text: adif, count: 1 };
    return { qsos: contacts, total: contacts.length, offset: 0, limit: 20 };
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

it("exports exactly checked identities while row actions keep their single active contact", async () => {
  const second = { ...contact, id: "5b4b4093-02ea-4758-ad50-4193b479ae86", call: "K1ABC" };
  const { request } = setup(false, [contact, second]); await screen.findByText("W1AW");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByText("W1AW"));
  const firstRow = screen.getByText("W1AW").closest("tr")!;
  fireEvent.click(screen.getByRole("checkbox", { name: /Select K1ABC .* for export/ }));
  expect(firstRow.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("K1ABC").closest("tr")?.getAttribute("aria-selected")).toBe("false");
  fireEvent.click(screen.getByRole("checkbox", { name: /Select W1AW .* for export/ }));
  expect(screen.getByText("2 selected on this page")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
  await screen.findByText("1 QSOs exported from the integrated logbook.");
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "selected", ids: [contact.id, second.id] });
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect((screen.getByRole("button", { name: "Export selected" }) as HTMLButtonElement).disabled).toBe(true);
  expect(firstRow.getAttribute("aria-selected")).toBe("true");
});

it("selects only the visible page and removes unchecked identities from export", async () => {
  const second = { ...contact, id: "5b4b4093-02ea-4758-ad50-4193b479ae86", call: "K1ABC" };
  const { request } = setup(false, [contact, second]); await screen.findByText("W1AW");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Select W1AW .* for export/ }));
  expect(screen.getByText("1 selected on this page")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
  await screen.findByText("1 QSOs exported from the integrated logbook.");
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "selected", ids: [second.id] });
});

it("rejects invalid UTF-8 bytes before requesting any preview", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(new Uint8Array([0xff]));
  expect((await screen.findByRole("alert")).textContent).toContain("Only UTF-8 ADI");
  expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(0);
});

it("reviews ADX through the frozen ADI path and imports the reviewed normalization only after consent", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  const fields = "<CALL>W1AW</CALL><QSO_DATE>20261014</QSO_DATE><TIME_ON>000000</TIME_ON><BAND>20m</BAND><MODE>CW</MODE>";
  await pick(new TextEncoder().encode(`<ADX><HEADER/><RECORDS><RECORD>${fields}</RECORD></RECORDS></ADX>`));
  await screen.findByRole("group", { name: "Review ADIF import" });
  expect(request).toHaveBeenCalledWith("logbook_import_adif", { action: "preview", text: adif + "\r\n", chunk: 0 });
  expect(request.mock.calls.filter(([method, params]) => method === "logbook_import_adif" && !params?.action)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
  await screen.findByText("1 QSOs imported; 0 duplicates skipped.");
  expect(request).toHaveBeenCalledWith("logbook_import_adif", { text: adif + "\r\n", generation: "workspace-1" });
});

it("rejects unsafe XML before creating any native preview session", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(new TextEncoder().encode('<!DOCTYPE ADX SYSTEM "file:///private/local"><ADX/>'));
  expect((await screen.findByRole("alert")).textContent).toContain("entity declarations");
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

it("offers modeled metadata fields for ADX updates and sends exact ADIF names only", async () => {
  const { request, pick } = setup(); await screen.findByText("W1AW");
  await pick(new TextEncoder().encode(`<ADX><HEADER/><RECORDS><RECORD><CALL>W1AW</CALL><QSO_DATE>20261014</QSO_DATE><TIME_ON>000000</TIME_ON><BAND>20m</BAND><MODE>CW</MODE><COUNTRY>Žilina 😀</COUNTRY><SIG_INFO>Žilina &lt;EOR&gt;</SIG_INFO><TX_PWR>12.50</TX_PWR></RECORD></RECORDS></ADX>`));
  fireEvent.click(screen.getByRole("checkbox", { name: "Update selected fields of reviewed duplicates instead" }));
  const fields = ["COUNTRY", "CONT", "CQZ", "ITUZ", "STATE", "CNTY", "SIG", "SIG_INFO", "DARC_DOK", "TX_PWR", "OPERATOR", "STATION_CALLSIGN", "MY_GRIDSQUARE", "PROP_MODE", "EMAIL"];
  for (const field of fields) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`\\(${field}\\)$`) }));
  expect(screen.queryByRole("checkbox", { name: /DXCC/ })).toBeNull();
  expect(request.mock.calls.filter(([, params]) => params?.action === "update")).toHaveLength(0);
  const preview = request.mock.calls.find(([, params]) => params?.action === "preview")![1]!;
  expect(preview.text).toContain("<COUNTRY:12>Žilina 😀");
  expect(preview.text).toContain("<SIG_INFO:13>Žilina <EOR>");
  fireEvent.click(screen.getByRole("button", { name: "Confirm duplicate updates" }));
  await screen.findByText("1 duplicate QSOs updated. New and repeated records were skipped.");
  expect(request).toHaveBeenCalledWith("logbook_import_adif", { action: "update", token: "preview-1", generation: "workspace-1", chunk: 0, fields, confirmed: true });
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
  fireEvent.click(screen.getByRole("checkbox", { name: /Select W1AW .* for export/ })); fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "read", token: "frozen", offset: 0, limit: 20 }));
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "selected", ids: [contact.id] });
  fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "W1AW" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Export filtered" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope: "filtered", search: "W1AW" }));
});

it.each(["all", "filtered", "selected"] as const)("exports %s as UTF-8 ADX using the same frozen scope", async scope => {
  const { request } = setup(); await screen.findByText("W1AW");
  const objectURL = vi.fn((_blob: Blob) => "blob:test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectURL });
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  expect((screen.getByRole("combobox", { name: "Export format" }) as HTMLSelectElement).value).toBe("adi");
  fireEvent.change(screen.getByRole("combobox", { name: "Export format" }), { target: { value: "adx" } });
  if (scope === "filtered") {
    fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "W1AW" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Export filtered" }) as HTMLButtonElement).disabled).toBe(false));
  }
  if (scope === "selected") fireEvent.click(screen.getByRole("checkbox", { name: /Select W1AW .* for export/ }));
  const reads = request.mock.calls.filter(([method]) => method === "logbook_list").length;
  fireEvent.click(screen.getByRole("button", { name: `Export ${scope}` }));
  await screen.findByText("1 QSOs exported from the integrated logbook.");
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "begin", scope, ...(scope === "filtered" ? { search: "W1AW" } : scope === "selected" ? { ids: [contact.id] } : {}) });
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "read", token: "frozen", offset: 0, limit: 20 });
  expect(request.mock.calls.filter(([method]) => method === "logbook_list")).toHaveLength(reads);
  expect(filename.endsWith(".adx")).toBe(true);
  const blob = objectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("application/xml;charset=utf-8");
  const xml = new DOMParser().parseFromString(await blobText(blob), "application/xml");
  expect(xml.querySelector("RECORD CALL")?.textContent).toBe("W1AW");
  expect(xml.querySelectorAll("RECORD")).toHaveLength(1);
});

it("assembles multiple ADX frames from one frozen token and bounds each native read", async () => {
  const { request } = setup(); await screen.findByText("W1AW");
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => {
    if (method === "logbook_export_adif" && params?.action === "begin") return { token: "frozen-multi", total: 21 };
    if (method === "logbook_export_adif" && params?.action === "read") return params.offset === 0
      ? { text: "<ADIF_VER:5>3.1.7<EOH>" + adif.repeat(20), count: 20 }
      : { text: adif.replace("W1AW", "K1AB"), count: 1 };
    return original(method, params);
  });
  const objectURL = vi.fn((_blob: Blob) => "blob:test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.change(screen.getByRole("combobox", { name: "Export format" }), { target: { value: "adx" } });
  fireEvent.click(screen.getByRole("button", { name: "Export all" }));
  await screen.findByText("21 QSOs exported from the integrated logbook.");
  expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "read", token: "frozen-multi", offset: 20, limit: 20 });
  const xml = new DOMParser().parseFromString(await blobText(objectURL.mock.calls[0][0] as Blob), "application/xml");
  expect(xml.querySelectorAll("RECORD")).toHaveLength(21);
  expect(xml.querySelectorAll("RECORD CALL")[20].textContent).toBe("K1AB");
});

it.each([
  { text: adif + "<NOTES:1>\0<EOR>", count: 1 },
  { text: adif, count: 2 },
  { text: adif, count: NaN },
])("never downloads an ADX export after invalid or lossy frozen evidence: %j", async frame => {
  const { request } = setup(); await screen.findByText("W1AW");
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => method === "logbook_export_adif" && params?.action === "read" ? frame : original(method, params));
  const objectURL = vi.fn((_blob: Blob) => "blob:test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectURL });
  fireEvent.change(screen.getByRole("combobox", { name: "Export format" }), { target: { value: "adx" } });
  fireEvent.click(screen.getByRole("button", { name: "Export all" }));
  await screen.findByRole("alert");
  expect(objectURL).not.toHaveBeenCalled();
});
