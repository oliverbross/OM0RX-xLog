// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import LogbookPanel, { confirmationTone, utcTime } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";

const first = {
  id: "contact-1", call: "OM0RX", start: "2026-10-12T10:15:00Z", band: "20m", mode: "CW",
  frequencyHz: 14_025_000, rstSent: "599", rstReceived: "579", name: "Oliver", country: "Slovakia",
  qslSent: "Y", qslReceived: "V", lotwSent: "Q", lotwReceived: "N",
  extraFields: { CLUBLOG_QSO_UPLOAD_STATUS: "Y", APP_CUSTOM: "preserved" },
  comment: "Portable from the summit", isDirty: true, customQSOKey: { retain: true },
};
const second = {
  id: "contact-2", call: "VK8AA", start: "2026-10-11T08:00:00Z", band: "40m", mode: "SSB",
  rstSent: "59", rstReceived: "59", qslSent: "", qslReceived: "M", lotwSent: "X", lotwReceived: "",
  extraFields: {}, comment: "", isDirty: false,
};
const page = (qsos: object[] = [first, second]) => ({ qsos, total: qsos.length, offset: 0, limit: 20 });
afterEach(cleanup);

describe("logbook confirmation visibility", () => {
  it("reuses UTC formatting across table rows and preserves invalid-date handling", () => {
    const constructor = vi.spyOn(Intl, "DateTimeFormat");
    try {
      for (let row = 0; row < 100; row++) {
        expect(utcTime("2024-03-01T09:29:00+09:30")).toBe("29/02/2024, 23:59");
      }
      expect(utcTime("invalid")).toBe("invalid");
      expect(constructor).not.toHaveBeenCalled();
    } finally { constructor.mockRestore(); }
  });
  it("uses native confirmation colour categories without interpreting unknown values as success", () => {
    expect(["Y", "v"].map(confirmationTone)).toEqual(["confirmed", "confirmed"]);
    expect(confirmationTone("N")).toBe("rejected");
    expect(["R", "Q", "I", "M"].map(confirmationTone)).toEqual(Array(4).fill("pending"));
    expect(confirmationTone("X")).toBe("unrecorded");
    expect(confirmationTone("")).toBe("unrecorded");
  });

  it("shows native RST, QSL, LoTW, Club Log and comment fields in stable QSO order", async () => {
    const request = vi.fn(async () => page());
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    await screen.findByText("OM0RX");
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual([
      "UTC", "Callsign", "Band / Mode", "Frequency", "RST", "Country",
      "QSL", "LoTW", "Club Log", "Comment",
    ]);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("OM0RX")).toBeTruthy();
    expect(within(rows[2]).getByText("VK8AA")).toBeTruthy();
    expect(within(rows[1]).getByLabelText("RST sent 599, received 579")).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "QSL sent Y, received V" })).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "LoTW sent Q, received N" })).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "Club Log upload Y" })).toBeTruthy();
    expect(within(rows[1]).getByText("Portable from the summit")).toBeTruthy();
    expect(within(rows[1]).getByText("14.025000")).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "Pending synchronization" })).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "QSL sent not recorded, received M" })).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "LoTW sent X, received not recorded" })).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "Club Log upload not recorded" })).toBeTruthy();
    expect(request).toHaveBeenCalledWith("logbook_list", { search: "", offset: 0, limit: 20 });
  });

  it("keeps search and edit wired to the original complete QSO identity", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) =>
      params?.search === "OM0RX" ? page([first]) : page());
    const edit = vi.fn();
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={edit} refreshKey={0} />);
    await screen.findByText("OM0RX");
    fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "OM0RX" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("1–1 of 1");
    expect(screen.queryByText("VK8AA")).toBeNull();
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("OM0RX"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(edit).toHaveBeenCalledWith(first);
    expect(edit.mock.calls[0][0].extraFields.APP_CUSTOM).toBe("preserved");
    expect(edit.mock.calls[0][0].customQSOKey).toEqual({ retain: true });
  });

  it("selects rows with the keyboard and requires confirmation before deleting the selected identity", async () => {
    const backend = contactEditFixture(second);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const contact = backend.request(method, params);
      if (contact) return contact;
      return page(backend.contact.qso.deletedAt ? [first] : [first, second]);
    });
    const edit = vi.fn();
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={edit} refreshKey={0} />);
    const call = await screen.findByText("OM0RX");
    fireEvent.keyDown(call.closest("tr")!, { key: "ArrowDown" });
    expect(screen.getByText("VK8AA").closest("tr")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));
    await screen.findByText("1–1 of 1");
    expect(screen.queryByText("VK8AA")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
    await screen.findByText("VK8AA");
    expect(request.mock.calls.some(([method]) => ["logbook_delete", "logbook_undo"].includes(method))).toBe(false);
    expect(request.mock.calls.filter(([method]) => method === "logbook_contact_apply").map(([, p]) => p?.action)).toEqual(["delete", "restore"]);
    fireEvent.doubleClick(screen.getByText("OM0RX"));
    expect(edit).toHaveBeenCalledWith(first);
  });

  it("retains an unrecognized Club Log extension value as recorded instead of marking it confirmed", async () => {
    const unusual = { ...first, extraFields: { CLUBLOG_QSO_UPLOAD_STATUS: "X" } };
    render(<LogbookPanel mutations={new LogbookMutationSession(vi.fn(), () => {})} onRequest={vi.fn(async () => page([unusual, second]))} onEdit={vi.fn()} refreshKey={0} />);
    const label = await screen.findByRole("img", { name: "Club Log upload X" });
    expect(label.querySelector(".is-unrecorded")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Club Log upload not recorded" })).toBeTruthy();
    expect(document.querySelector(".live-logbook-table-wrap")).toBeTruthy();
  });

  it("fills a dense 100-row page using bounded worker frames and keeps page navigation aligned", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      const offset = Number(params?.offset ?? 0);
      const limit = Number(params?.limit ?? 20);
      expect(limit).toBe(20);
      return { total: 121, offset, limit, qsos: Array.from({ length: Math.min(limit, 121 - offset) }, (_, index) => ({ ...first, id: `qso-${offset + index}`, call: `TEST${offset + index}` })) };
    });
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    await screen.findByText("1–100 of 121");
    expect(screen.getAllByRole("row")).toHaveLength(101);
    expect(request.mock.calls.map(([, params]) => params?.offset)).toEqual([0, 20, 40, 60, 80]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("101–121 of 121");
    expect(screen.getByText("TEST120")).toBeTruthy();
    expect(screen.queryByText("TEST0")).toBeNull();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
