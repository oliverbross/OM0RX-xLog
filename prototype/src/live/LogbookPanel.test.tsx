// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("reveals full contact values without depending on wide table columns", async () => {
    const request = vi.fn(async () => page());
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX"));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = screen.getByLabelText("Details for OM0RX");
    expect(within(details).getByText("Slovakia · Oliver")).toBeTruthy();
    expect(within(details).getByText("Portable from the summit")).toBeTruthy();
    expect(within(details).getByRole("img", { name: "QSL sent Y, received V" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.queryByLabelText("Details for OM0RX")).toBeNull();
  });

  it("keeps the selected contact across refresh and drops it only when no longer present", async () => {
    let rows = [first, second];
    const request = vi.fn(async () => page(rows));
    const mutations = new LogbookMutationSession(request, () => {});
    const view = render(<LogbookPanel mutations={mutations} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX"));
    view.rerender(<LogbookPanel mutations={mutations} onRequest={request} onEdit={vi.fn()} refreshKey={1} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("OM0RX").closest("tr")?.getAttribute("aria-selected")).toBe("true");
    rows = [second];
    view.rerender(<LogbookPanel mutations={mutations} onRequest={request} onEdit={vi.fn()} refreshKey={2} />);
    await screen.findByText("1–1 of 1");
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears export checks on refresh and search while keeping active-row behavior separate", async () => {
    const request = vi.fn(async () => page());
    const mutations = new LogbookMutationSession(request, () => {});
    const edit = vi.fn();
    const view = render(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX"));
    const checkbox = screen.getByRole("checkbox", { name: /Select VK8AA .* for export/ });
    fireEvent.keyDown(checkbox, { key: "Enter" });
    expect(edit).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    view.rerender(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={1} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Select page" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Select VK8AA .* for export/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("OM0RX").closest("tr")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Select page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "OM0RX" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_list", { search: "OM0RX", offset: 0, limit: 20 }));
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export selected" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("drops page export selection when navigating and never restores hidden checked rows", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      const offset = Number(params?.offset ?? 0), limit = Number(params?.limit ?? 20);
      return { total: 101, offset, limit, qsos: Array.from({ length: Math.min(limit, 101 - offset) }, (_, index) => ({ ...first, id: `qso-${offset + index}`, call: `PAGE${offset + index}` })) };
    });
    render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
    await screen.findByText("1–100 of 101");
    fireEvent.click(screen.getByRole("button", { name: "Select page" }));
    expect(screen.getByText("100 selected on this page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("101–101 of 101");
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Select PAGE100 .* for export/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("1–100 of 101");
    expect(screen.getByText("0 selected on this page")).toBeTruthy();
  });

  it("adapts row count with bounded requests, preserves selection and keeps last-page navigation reachable", async () => {
    let resize = () => {};
    let height = 280;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const size = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("live-logbook-table-wrap") ? height : 0; });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.tagName === "THEAD" ? 35 : 28 } as DOMRect; });
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      const offset = Number(params?.offset ?? 0), limit = Number(params?.limit ?? 20);
      return { total: 25, offset, limit, qsos: Array.from({ length: Math.min(limit, 25 - offset) }, (_, index) => ({ ...first, id: `qso-${offset + index}`, call: `FIT${offset + index}` })) };
    });
    try {
      render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
      await screen.findByText("1–8 of 25");
      fireEvent.click(screen.getByText("FIT7")); fireEvent.click(screen.getByRole("button", { name: "Details" }));
      height = 200; act(() => resize());
      await screen.findByText("6–10 of 25");
      expect(screen.getByLabelText("Details for FIT7")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("11–15 of 25");
      expect(screen.queryByLabelText("Details for FIT7")).toBeNull();
      for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText(`${16 + 5 * i}–${20 + 5 * i} of 25`); }
      height = 600; act(() => resize());
      await waitFor(() => expect(request.mock.calls.some(([, params]) => params?.offset === 20 && params?.limit === 20)).toBe(true));
      expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
      expect(request.mock.calls.every(([, params]) => Number(params?.limit) <= 20)).toBe(true);
    } finally { cleanup(); size.mockRestore(); rect.mockRestore(); vi.unstubAllGlobals(); }
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

  it.each([false, true])("keeps revision-checked Delete through resize (preparation pending: %s)", async pending => {
    let resize = () => {}, height = 280, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const size = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("live-logbook-table-wrap") ? height : 0; });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.tagName === "THEAD" ? 35 : 28 } as DOMRect; });
    const backend = contactEditFixture(first);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "logbook_contact" && pending) await gate;
      return backend.request(method, params) ?? page(backend.contact.qso.deletedAt ? [second] : [first, second]);
    });
    try {
      render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} />);
      await waitFor(() => expect(request.mock.calls.some(([method, params]) => method === "logbook_list" && params?.limit === 8)).toBe(true));
      fireEvent.click(await screen.findByText("OM0RX"));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      if (!pending) await screen.findByRole("button", { name: "Confirm delete" });
      height = 200; act(() => resize());
      await waitFor(() => expect(request.mock.calls.some(([method, params]) => method === "logbook_list" && params?.limit === 5)).toBe(true));
      release();
      const confirm = await screen.findByRole("button", { name: "Confirm delete" });
      expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
      fireEvent.click(confirm);
      await screen.findByText("1–1 of 1");
      const mutation = request.mock.calls.find(([method]) => method === "logbook_contact_apply")?.[1];
      expect(mutation).toMatchObject({ action: "delete", contactID: first.id, expectedRevision: 1 });
    } finally { release(); cleanup(); size.mockRestore(); rect.mockRestore(); vi.unstubAllGlobals(); }
  });
  it.each(["selection", "search"])("cancels a pending Delete preparation on %s changes", async reason => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const backend = contactEditFixture(first);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "logbook_contact") await gate;
      return backend.request(method, params) ?? page();
    });
    const mutations = new LogbookMutationSession(request, () => {}), edit = vi.fn();
    render(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX")); fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(request.mock.calls.some(([method]) => method === "logbook_contact")).toBe(true));
    if (reason === "selection") fireEvent.click(screen.getByText("VK8AA"));
    else {
      fireEvent.change(screen.getByRole("textbox", { name: "Search logbook" }), { target: { value: "VK8AA" } });
      fireEvent.submit(screen.getByRole("textbox", { name: "Search logbook" }).closest("form")!);
    }
    await act(async () => { release(); await gate; });
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
  });
  it.each([false, true])("retains reviewed Delete on a passive refresh (preparation pending: %s)", async pending => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const backend = contactEditFixture(first);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "logbook_contact" && pending) await gate;
      return backend.request(method, params) ?? page();
    });
    const mutations = new LogbookMutationSession(request, () => {}), edit = vi.fn();
    const view = render(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX")); fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    if (!pending) await screen.findByRole("button", { name: "Confirm delete" });
    view.rerender(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={1} />);
    await act(async () => { release(); await gate; });
    expect(await screen.findByRole("button", { name: "Confirm delete" })).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
  });
  it("cannot delete a contact changed elsewhere while confirmation survives a refresh", async () => {
    const backend = contactEditFixture(first);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => backend.request(method, params) ?? page([backend.contact.qso]));
    const mutations = new LogbookMutationSession(request, () => {}), edit = vi.fn();
    const view = render(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={0} />);
    fireEvent.click(await screen.findByText("OM0RX")); fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("button", { name: "Confirm delete" });
    backend.request("logbook_contact_apply", { operationID: "other-window", contactID: first.id, generation: backend.contact.generation,
      expectedRevision: 1, action: "update", qso: { ...first, comment: "Changed elsewhere" } });
    view.rerender(<LogbookPanel mutations={mutations} onRequest={request} onEdit={edit} refreshKey={1} />);
    await screen.findByText("Changed elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(mutations.getSnapshot().conflict).toBe(true));
    expect(backend.contact.qso.deletedAt).toBeUndefined();
    expect(backend.contact.qso.comment).toBe("Changed elsewhere");
    expect(request.mock.calls.find(([method]) => method === "logbook_contact_apply")?.[1]?.expectedRevision).toBe(1);
  });
});
