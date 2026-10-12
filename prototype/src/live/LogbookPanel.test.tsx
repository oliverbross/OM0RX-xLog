// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import LogbookPanel, { confirmationTone } from "./LogbookPanel";

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
  it("uses native confirmation colour categories without interpreting unknown values as success", () => {
    expect(["Y", "v"].map(confirmationTone)).toEqual(["confirmed", "confirmed"]);
    expect(confirmationTone("N")).toBe("rejected");
    expect(["R", "Q", "I", "M"].map(confirmationTone)).toEqual(Array(4).fill("pending"));
    expect(confirmationTone("X")).toBe("unrecorded");
    expect(confirmationTone("")).toBe("unrecorded");
  });

  it("shows native RST, QSL, LoTW, Club Log and comment fields in stable QSO order", async () => {
    const request = vi.fn(async () => page());
    render(<LogbookPanel onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    await screen.findByText("OM0RX");
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual([
      "Date UTC", "Callsign", "Band / mode", "Frequency", "RST", "Name / country",
      "QSL", "LoTW", "Club Log", "Comment", "Sync", "Actions",
    ]);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("OM0RX")).toBeTruthy();
    expect(within(rows[2]).getByText("VK8AA")).toBeTruthy();
    expect(within(rows[1]).getByLabelText("RST sent 599, received 579")).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "QSL sent Y, received V" })).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "LoTW sent Q, received N" })).toBeTruthy();
    expect(within(rows[1]).getByRole("img", { name: "Club Log upload Y" })).toBeTruthy();
    expect(within(rows[1]).getByText("Portable from the summit")).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "QSL sent not recorded, received M" })).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "LoTW sent X, received not recorded" })).toBeTruthy();
    expect(within(rows[2]).getByRole("img", { name: "Club Log upload not recorded" })).toBeTruthy();
    expect(request).toHaveBeenCalledWith("logbook_list", { search: "", offset: 0, limit: 20 });
  });

  it("keeps search and edit wired to the original complete QSO identity", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) =>
      params?.search === "OM0RX" ? page([first]) : page());
    const edit = vi.fn();
    render(<LogbookPanel onRequest={request} onEdit={edit} refreshKey={0} />);
    await screen.findByText("OM0RX");
    fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "OM0RX" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("1–1 of 1");
    expect(screen.queryByText("VK8AA")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit OM0RX" }));
    expect(edit).toHaveBeenCalledWith(first);
    expect(edit.mock.calls[0][0].extraFields.APP_CUSTOM).toBe("preserved");
    expect(edit.mock.calls[0][0].customQSOKey).toEqual({ retain: true });
  });

  it("retains an unrecognized Club Log extension value as recorded instead of marking it confirmed", async () => {
    const unusual = { ...first, extraFields: { CLUBLOG_QSO_UPLOAD_STATUS: "X" } };
    render(<LogbookPanel onRequest={vi.fn(async () => page([unusual, second]))} onEdit={vi.fn()} refreshKey={0} />);
    const label = await screen.findByRole("img", { name: "Club Log upload X" });
    expect(label.querySelector(".is-unrecorded")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Club Log upload not recorded" })).toBeTruthy();
    expect(document.querySelector(".live-logbook-table-wrap")).toBeTruthy();
  });
});
