// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogbookPanel from "./LogbookPanel";
import { defaultLogbookColumnPreferences, logbookColumnsKey, type LogbookColumnContext } from "./logbookColumnPreferences";
import { LogbookMutationSession } from "./logbookMutationSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";

const contact = { id: "synthetic-column-contact", call: "TEST123/P", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW",
  rstSent: "599", rstReceived: "579", comment: "Complete synthetic comment", extraFields: { APP_UNKNOWN: "preserved" } };
function setup(detached = false, columnContext?: LogbookColumnContext) {
  const backend = contactEditFixture(contact);
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "logbook_list"
    ? { qsos: [contact], total: 1, offset: 0, limit: 20 } : backend.request(method, params));
  const edit = vi.fn();
  const props = { onRequest: request, mutations: new LogbookMutationSession(request, () => {}), onEdit: edit, refreshKey: 0 };
  const view = render(<LogbookPanel {...props} columnContext={columnContext} onDock={detached ? () => {} : undefined} />);
  return { ...view, props, edit, request };
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("shared Logbook column controls", () => {
  it("moves matching headers and cells, retains order through hiding and reload, and isolates contexts", async () => {
    const view = setup(); await screen.findByText(contact.call);
    const calls = view.request.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const later = screen.getByRole("button", { name: "Move Callsign column later" });
    later.focus(); await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(later);
    expect(screen.getAllByRole("columnheader").slice(0, 4).map(header => header.textContent)).toEqual(["UTC", "Band", "Callsign", "Mode"]);
    const earlier = screen.getByRole("button", { name: "Move Callsign column earlier" });
    fireEvent.click(earlier);
    fireEvent.click(earlier);
    expect((earlier as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("columnheader").slice(0, 2).map(header => header.textContent)).toEqual(["Callsign", "UTC"]);
    expect(within(screen.getByText(contact.call).closest("tr")!).getAllByRole("cell").slice(0, 2).map(cell => cell.getAttribute("data-label")))
      .toEqual(["Callsign", "UTC"]);
    fireEvent.click(screen.getByLabelText("Show UTC column"));
    fireEvent.click(screen.getByLabelText("Show UTC column"));
    expect(screen.getAllByRole("columnheader").slice(0, 2).map(header => header.textContent)).toEqual(["Callsign", "UTC"]);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(logbookColumnsKey("docked"))!).order.slice(0, 2)).toEqual(["call", "utc"]));
    expect(view.request).toHaveBeenCalledTimes(calls);
    view.unmount();
    const reloaded = setup(); await screen.findByText(contact.call);
    expect(screen.getAllByRole("columnheader")[0].textContent).toBe("Callsign");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect((screen.getByRole("button", { name: "Move Comment column later" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getAllByRole("columnheader")[0].textContent).toBe("UTC");
    reloaded.unmount();
    setup(true); await screen.findByText(contact.call);
    expect(screen.getAllByRole("columnheader")[0].textContent).toBe("UTC");
    expect((screen.queryByRole("button", { name: "Move Comment column later" }))).toBeNull();
  });
  it("uses explicit Desk context even with Dock back and resets only that context", async () => {
    const docked = JSON.stringify({ ...defaultLogbookColumnPreferences(), columns: ["call", "comment"] });
    const detached = JSON.stringify({ ...defaultLogbookColumnPreferences(), columns: ["call", "rst"] });
    localStorage.setItem(logbookColumnsKey("docked"), docked);
    localStorage.setItem(logbookColumnsKey("detached"), detached);
    const view = setup(true, "desk"); await screen.findByText(contact.call);
    expect(screen.getAllByRole("columnheader")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show Comment column"));
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Callsign column" }), { key: "ArrowRight" });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(logbookColumnsKey("desk"))!).columns).not.toContain("comment"));
    expect(localStorage.getItem(logbookColumnsKey("docked"))).toBe(docked);
    expect(localStorage.getItem(logbookColumnsKey("detached"))).toBe(detached);
    view.unmount(); setup(false, "desk"); await screen.findByText(contact.call);
    expect(screen.queryByRole("columnheader", { name: /^Comment/ })).toBeNull();
    expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("160");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(11);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(logbookColumnsKey("desk"))!)).toEqual(defaultLogbookColumnPreferences("desk")));
    expect(localStorage.getItem(logbookColumnsKey("docked"))).toBe(docked);
    expect(localStorage.getItem(logbookColumnsKey("detached"))).toBe(detached);
  });

  it("migrates the untouched legacy Desk default once but retains legacy custom widths and visibility", async () => {
    const legacyKey = "xlog.integration.logbook-columns.desk.v1";
    const defaults = defaultLogbookColumnPreferences("desk");
    const { band: _band, mode: _mode, ...currentWidths } = defaults.widths;
    const legacyWidths = { ...currentWidths, bandMode: 105 };
    localStorage.setItem(legacyKey, JSON.stringify({ ...defaults, widths: legacyWidths,
      columns: ["utc", "call", "bandMode", "frequency", "country"] }));
    const promoted = setup(false, "desk"); await screen.findByText(contact.call);
    expect(screen.getAllByRole("columnheader")).toHaveLength(11);
    await waitFor(() => expect(localStorage.getItem(logbookColumnsKey("desk"))).not.toBeNull());
    promoted.unmount(); localStorage.removeItem(logbookColumnsKey("desk"));
    localStorage.setItem(legacyKey, JSON.stringify({ ...defaults, columns: ["call", "rst"],
      widths: { ...legacyWidths, call: 177 } }));
    setup(false, "desk"); await screen.findByText(contact.call);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Callsign", "RST"]);
    expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe("177");
  });

  it("changing explicit presentation context retains selected identity and Delete consent without refetching", async () => {
    localStorage.setItem(logbookColumnsKey("desk"), JSON.stringify({ ...defaultLogbookColumnPreferences("desk"), columns: ["call", "rst"] }));
    const view = setup(false, "docked"); await screen.findByText(contact.call);
    fireEvent.click(screen.getByText(contact.call)); fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await screen.findByRole("group", { name: `Delete ${contact.call}` });
    const calls = view.request.mock.calls.length;
    view.rerender(<LogbookPanel {...view.props} columnContext="desk" />);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Callsign", "RST"]);
    expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
    expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBeTruthy();
    view.rerender(<LogbookPanel {...view.props} columnContext="docked" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(11);
    expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBeTruthy();
    view.rerender(<LogbookPanel {...view.props} columnContext="desk" />);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Callsign", "RST"]);
    expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBeTruthy();
    expect(view.request).toHaveBeenCalledTimes(calls);
    fireEvent.keyDown(screen.getByText(contact.call).closest("tr")!, { key: "Enter" }); expect(view.edit).toHaveBeenCalledWith(contact);
  });

  it("persists visibility and width independently in docked and detached contexts", async () => {
    const docked = setup(); await screen.findByText(contact.call);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show Country column"));
    fireEvent.change(screen.getByLabelText("RST column width"), { target: { value: "145" } });
    fireEvent.blur(screen.getByLabelText("RST column width"));
    expect(screen.queryByRole("columnheader", { name: /^Country/ })).toBeNull();
    expect(screen.getByRole("separator", { name: "Resize RST column" }).getAttribute("aria-valuenow")).toBe("145");
    await waitFor(() => expect(JSON.parse(localStorage.getItem(logbookColumnsKey("docked"))!).widths.rst).toBe(145));
    docked.unmount();
    const detached = setup(true); await screen.findByText(contact.call);
    expect(screen.getByRole("columnheader", { name: /^Country/ })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize RST column" }).getAttribute("aria-valuenow")).toBe("92");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show UTC column"));
    detached.unmount(); setup(); await screen.findByText(contact.call);
    expect(screen.queryByRole("columnheader", { name: /^Country/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /^UTC/ })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize RST column" }).getAttribute("aria-valuenow")).toBe("145");
  });

  it("controls Band and Mode visibility and widths independently", async () => {
    setup(); await screen.findByText(contact.call);
    const band = screen.getByRole("separator", { name: "Resize Band column" });
    const mode = screen.getByRole("separator", { name: "Resize Mode column" });
    fireEvent.keyDown(band, { key: "ArrowRight" });
    expect(band.getAttribute("aria-valuenow")).toBe("88");
    expect(mode.getAttribute("aria-valuenow")).toBe("88");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show Mode column"));
    expect(screen.getByRole("columnheader", { name: /^Band/ })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /^Mode/ })).toBeNull();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(logbookColumnsKey("docked"))!)).toMatchObject({
      columns: expect.not.arrayContaining(["mode"]), widths: { band: 88, mode: 88 },
    }));
  });

  it("keeps Callsign available, supports bounded keyboard resize, reset and focus return", async () => {
    setup(); await screen.findByText(contact.call);
    const trigger = screen.getByRole("button", { name: "Columns" }); fireEvent.click(trigger);
    const checkbox = screen.getByLabelText("Show Callsign column") as HTMLInputElement;
    expect(checkbox.checked && checkbox.disabled).toBe(true);
    for (const input of screen.getAllByRole("checkbox") as HTMLInputElement[]) if (!input.disabled) fireEvent.click(input);
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
    expect(screen.getByText(contact.call)).toBeTruthy();
    const handle = screen.getByRole("separator", { name: "Resize Callsign column" });
    fireEvent.keyDown(handle, { key: "Home" }); expect(handle.getAttribute("aria-valuenow")).toBe("96");
    fireEvent.keyDown(handle, { key: "ArrowLeft" }); expect(handle.getAttribute("aria-valuenow")).toBe("96");
    fireEvent.keyDown(handle, { key: "ArrowRight" }); expect(handle.getAttribute("aria-valuenow")).toBe("106");
    fireEvent.keyDown(handle, { key: "End" }); expect(handle.getAttribute("aria-valuenow")).toBe("480");
    fireEvent.keyDown(handle, { key: "ArrowRight" }); expect(handle.getAttribute("aria-valuenow")).toBe("480");
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" })); expect(screen.getAllByRole("columnheader")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(trigger);
  });

  it("commits numeric drafts on blur, never treating blank input as zero", async () => {
    setup(); await screen.findByText(contact.call); fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const input = screen.getByLabelText("Comment column width") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(screen.getByRole("separator", { name: "Resize Comment column" }).getAttribute("aria-valuenow")).toBe("230");
    fireEvent.blur(input); expect(input.value).toBe("230");
    fireEvent.change(input, { target: { value: "999" } }); fireEvent.blur(input); expect(input.value).toBe("480");
    fireEvent.change(input, { target: { value: "1" } }); fireEvent.blur(input); expect(input.value).toBe("48");
  });

  it("resizes with pointer capture, stops on cancellation and uses displayed width scaling", async () => {
    setup(); await screen.findByText(contact.call);
    const handle = screen.getByRole("separator", { name: "Resize RST column" });
    handle.setPointerCapture = vi.fn();
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 184 } as DOMRect);
    // jsdom has no PointerEvent; provide the event fields consumed by the handler.
    const pointer = (type: string, x: number) => { const event = new Event(type, { bubbles: true });
      Object.assign(event, { button: 0, clientX: x, pointerId: 1 }); fireEvent(handle, event); };
    pointer("pointerdown", 100); pointer("pointermove", 140);
    expect(handle.getAttribute("aria-valuenow")).toBe("112");
    pointer("pointercancel", 140); pointer("pointermove", 300);
    expect(handle.getAttribute("aria-valuenow")).toBe("112");
  });

  it("does not refetch or change selected identity/delete consent when presentation changes", async () => {
    const { request, edit } = setup(); await screen.findByText(contact.call);
    fireEvent.click(screen.getByText(contact.call)); fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await screen.findByRole("group", { name: `Delete ${contact.call}` });
    const calls = request.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show Comment column"));
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Callsign column" }), { key: "ArrowRight" });
    expect(request).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ })); expect(edit).toHaveBeenCalledWith(contact);
    expect(within(screen.getAllByRole("row")[1]).getByText(contact.call)).toBeTruthy();
  });

  it("remains usable when browser presentation storage is denied", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    setup(); await screen.findByText(contact.call); fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Show Comment column"));
    expect(screen.queryByRole("columnheader", { name: /^Comment/ })).toBeNull();
    expect(screen.getByText(contact.call)).toBeTruthy();
  });
});
