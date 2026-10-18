// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeskMapLogbook } from "./DeskMapLogbook";
import { deskMapLogbookKey } from "./deskMapLogbookPreferences";
import { LogbookPanel } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";
import { logbookColumnsKey } from "./logbookColumnPreferences";

let height = 610, resized: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear(); height = 610;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height, width: 600, top: 0, left: 0, right: 600, bottom: height, x: 0, y: 0, toJSON: () => ({}) }));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resized = undefined; });
const view = (value: string) => fireEvent.change(screen.getByLabelText("Desk map and logbook view"), { target: { value } });
const stored = () => JSON.parse(localStorage.getItem(deskMapLogbookKey)!);
function retained(name: string, mounted: (name: string) => void) {
  return function Pane() {
    const [text, setText] = useState(""); useEffect(() => { mounted(name); }, []);
    return <input aria-label={name} value={text} onChange={event => setText(event.target.value)} />;
  };
}
function pointer(target: Element, type: string, y: number) {
  const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId: 7, clientY: y }); fireEvent(target, event);
}

it("offers the five exact choices, defaults to Map and lazily retains each pane in one stable parent", () => {
  const mounted = vi.fn(), Map = retained("Map camera", mounted), Logbook = retained("Logbook search", mounted);
  const result = render(<DeskMapLogbook map={<Map />} logbook={<Logbook />} />);
  expect([...screen.getByLabelText<HTMLSelectElement>("Desk map and logbook view").options].map(option => option.text)).toEqual([
    "Map", "Logbook", "Prev QSO's + Logbook + Map (below)", "Logbook above map", "Logbook below map",
  ]);
  expect(mounted.mock.calls).toEqual([["Map camera"]]); expect(screen.queryByLabelText("Logbook search")).toBeNull();
  fireEvent.change(screen.getByLabelText("Map camera"), { target: { value: "Pacific" } });
  view("logbook"); const logbook = screen.getByLabelText("Logbook search"), parent = logbook.parentElement;
  fireEvent.change(logbook, { target: { value: "K1ABC" } });
  for (const selection of ["logbook-above", "logbook-below", "map", "logbook"]) view(selection);
  expect(screen.getByLabelText("Logbook search")).toBe(logbook); expect(logbook.parentElement).toBe(parent);
  expect((logbook as HTMLInputElement).value).toBe("K1ABC"); expect(screen.getByLabelText<HTMLInputElement>("Map camera").value).toBe("Pacific");
  expect(result.container.querySelector(".desk-map-logbook-map")?.hasAttribute("inert")).toBe(true);
  expect(result.container.querySelector(".desk-map-logbook-map")?.hasAttribute("hidden")).toBe(true);
  expect(mounted.mock.calls).toEqual([["Map camera"], ["Logbook search"]]); expect(stored().view).toBe("logbook");
});

it("keeps previous QSOs and logbook above a half-height map, collapsing only previous QSOs without history", () => {
  const result = render(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook table</div>}
    previousQSOs={<div>Worked before table</div>} hasPreviousQSOs />);
  view("logbook-previous");
  const panes = result.container.querySelector<HTMLElement>(".desk-map-logbook-panes")!;
  const previous = result.container.querySelector<HTMLElement>(".desk-map-logbook-previous")!;
  const logbook = result.container.querySelector<HTMLElement>(".desk-map-logbook-logbook")!;
  expect(panes.style.gridTemplateRows).toBe("minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)");
  expect(previous.hidden).toBe(false); expect(previous.style.gridRow).toBe("1");
  expect(logbook.hidden).toBe(false); expect(logbook.style.gridRow).toBe("2");
  const map = result.container.querySelector<HTMLElement>(".desk-map-logbook-map")!;
  expect(map.hidden).toBe(false); expect(map.style.gridRow).toBe("3");
  result.rerender(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook table</div>}
    previousQSOs={<div>Old history must close</div>} hasPreviousQSOs={false} />);
  expect(panes.style.gridTemplateRows).toBe("minmax(0, 1fr) minmax(0, 1fr)");
  expect(previous.hidden).toBe(true); expect(logbook.style.gridRow).toBe("1");
  expect(map.hidden).toBe(false); expect(map.style.gridRow).toBe("2");
  expect(screen.queryByText("Old history must close")).toBeNull();
  expect(screen.getByText("Logbook table")).toBeTruthy();
});

it("restores Logbook-only without mounting Map and preserves presentation after remount", () => {
  localStorage.setItem(deskMapLogbookKey, JSON.stringify({ version: 1, view: "logbook", logbookPercent: 65 }));
  const mounted = vi.fn(), Map = retained("Map", mounted), Logbook = retained("Logbook", mounted);
  const first = render(<DeskMapLogbook map={<Map />} logbook={<Logbook />} />);
  expect(mounted.mock.calls).toEqual([["Logbook"]]); view("logbook-above"); first.unmount();
  render(<DeskMapLogbook map={<Map />} logbook={<Logbook />} />);
  expect(screen.getByLabelText<HTMLSelectElement>("Desk map and logbook view").value).toBe("logbook-above");
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("65");
});

it("supports bounded keyboard resizing in both orders without changing existing horizontal preferences", () => {
  localStorage.setItem("xlog.integration.operator-workspace.v1", "keep horizontal split");
  render(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook</div>} />); view("logbook-above");
  const divider = screen.getByRole("separator", { name: "Map and Logbook height" });
  fireEvent.keyDown(divider, { key: "ArrowDown" }); expect(stored().logbookPercent).toBe(52);
  fireEvent.keyDown(divider, { key: "ArrowUp", shiftKey: true }); expect(stored().logbookPercent).toBe(42);
  fireEvent.keyDown(divider, { key: "End" }); expect(stored().logbookPercent).toBeCloseTo(70);
  fireEvent.keyDown(divider, { key: "Home" }); expect(stored().logbookPercent).toBeCloseTo(220 / 600 * 100);
  view("logbook-below"); fireEvent.keyDown(divider, { key: "ArrowUp" }); expect(stored().logbookPercent).toBeCloseTo(220 / 600 * 100 + 2);
  expect(localStorage.getItem("xlog.integration.operator-workspace.v1")).toBe("keep horizontal split");
});

it("resizes by pointer and stops on cancellation/lost capture, while short panes retain usable minimum heights", () => {
  const result = render(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook</div>} />); view("logbook-above");
  const divider = screen.getByRole("separator"); pointer(divider, "pointerdown", 300); pointer(divider, "pointermove", 360);
  expect(stored().logbookPercent).toBe(60); pointer(divider, "pointercancel", 360); pointer(divider, "pointermove", 420);
  expect(stored().logbookPercent).toBe(60);
  pointer(divider, "pointerdown", 360); pointer(divider, "lostpointercapture", 360); pointer(divider, "pointermove", 420);
  expect(stored().logbookPercent).toBe(60);
  height = 160; act(() => resized?.());
  expect(result.container.querySelector<HTMLElement>(".desk-map-logbook-panes")?.style.gridTemplateRows).toBe("220px 10px 180px");
  expect(divider.getAttribute("aria-disabled")).toBe("true"); expect(divider.getAttribute("tabindex")).toBe("-1");
  expect(result.container.querySelector<HTMLElement>(".desk-map-logbook-logbook")?.style.minHeight).toBe("220px");
});

it("keeps guards live at event boundaries and clears only the owned refusal after an accepted choice", () => {
  let allowed = false;
  const result = render(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook</div>} canChangeView={() => allowed} />);
  view("logbook"); expect(screen.getByRole("status").textContent).toContain("Finish the current");
  expect(screen.getByLabelText<HTMLSelectElement>("Desk map and logbook view").value).toBe("map");
  allowed = true; view("logbook-above"); expect(screen.queryByRole("status")).toBeNull();
  const divider = screen.getByRole("separator"); pointer(divider, "pointerdown", 300); allowed = false; pointer(divider, "pointermove", 350);
  expect(stored().logbookPercent).toBe(50);
  result.rerender(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook</div>} busy canChangeView={() => true} />);
  expect(screen.getByLabelText<HTMLSelectElement>("Desk map and logbook view").disabled).toBe(true);
  fireEvent.keyDown(divider, { key: "End" }); expect(stored().logbookPercent).toBe(50);
});

it("stays usable with missing or failed storage and does not confuse storage errors with guard warnings", () => {
  const storage = { getItem: vi.fn(() => { throw new Error("denied"); }), setItem: vi.fn((_key: string, _value: string) => { throw new Error("full"); }) };
  render(<DeskMapLogbook map={<div>Map</div>} logbook={<div>Logbook</div>} storage={storage} />);
  expect(screen.getByRole("status").textContent).toContain("could not be saved"); view("logbook-above");
  expect(screen.getByLabelText<HTMLSelectElement>("Desk map and logbook view").value).toBe("logbook-above");
  expect(screen.getByRole("status").textContent).toContain("could not be saved");
  expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({ version: 1, view: "logbook-above", logbookPercent: 50 });
});

it("uses the shared column chooser and persists resized table columns across both map orders and remount", async () => {
  const contact = { id: "desk-columns", call: "W1AW", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
  const request = vi.fn(async () => ({ qsos: [contact], total: 1, offset: 0, limit: 20 }));
  const mutations = new LogbookMutationSession(request, () => {}), edit = vi.fn();
  const desk = () => <DeskMapLogbook map={<div>Map</div>} logbook={<LogbookPanel
    mutations={mutations} onRequest={request} onEdit={edit} refreshKey={0} columnContext="desk" />} />;
  const first = render(desk());
  await act(async () => { view("logbook-above"); });
  const table = screen.getByRole("table"), map = first.container.querySelector(".desk-map-logbook-map");
  expect(screen.getAllByRole("columnheader")).toHaveLength(11);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByLabelText("Show Comment column"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  const edge = screen.getByRole("separator", { name: "Resize Callsign column" });
  const before = Number(edge.getAttribute("aria-valuenow"));
  fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
  const resizedWidth = Number(edge.getAttribute("aria-valuenow"));
  expect(resizedWidth).toBeGreaterThan(before);
  view("logbook-below");
  expect(screen.getByRole("table")).toBe(table);
  expect(first.container.querySelector(".desk-map-logbook-map")).toBe(map);
  expect(screen.queryByRole("columnheader", { name: /^Comment/ })).toBeNull();
  const saved = JSON.parse(localStorage.getItem(logbookColumnsKey("desk"))!);
  expect(saved.widths.call).toBe(resizedWidth);
  expect(saved.columns).not.toContain("comment");
  expect(localStorage.getItem(logbookColumnsKey("docked"))).toBeNull();
  first.unmount();
  render(desk());
  expect(screen.getByRole("separator", { name: "Resize Callsign column" }).getAttribute("aria-valuenow")).toBe(String(resizedWidth));
  expect(screen.queryByRole("columnheader", { name: /^Comment/ })).toBeNull();
  expect(edit).not.toHaveBeenCalled();
  expect(request.mock.calls.length).toBeGreaterThan(0);
});

it.each([false, true])("retains actual-table reviewed Delete through hiding, reordering and measured resizing (contact changed elsewhere: %s)", async changedElsewhere => {
  vi.useFakeTimers();
  const observers = new Set<() => void>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) { observers.add(callback); }
    observe() {} disconnect() { observers.delete(this.callback); }
  });
  let tableHeight = 280;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("live-logbook-table-wrap") ? tableHeight : 0;
  });
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const measuredHeight = this.tagName === "THEAD" ? 35 : this.tagName === "TR" ? 28 : height;
    return { height: measuredHeight, width: 600, top: 0, left: 0, right: 600, bottom: measuredHeight, x: 0, y: 0, toJSON: () => ({}) };
  });
  const notifyResize = async () => {
    await act(async () => {
      for (const callback of [...observers]) callback();
      await vi.advanceTimersByTimeAsync(120);
    });
  };
  const contact = { id: "desk-reviewed-contact", call: "TEST39/P", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
  const backend = contactEditFixture(contact), reviewed = structuredClone(backend.contact);
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    const response = backend.request(method, params);
    if (response !== undefined) return response;
    if (method !== "logbook_list") throw new Error(`Unexpected synthetic request: ${method}`);
    const qsos = backend.contact.qso.deletedAt ? [] : [backend.contact.qso];
    return { qsos, total: qsos.length, offset: Number(params?.offset ?? 0), limit: Number(params?.limit ?? 20) };
  });
  const mutations = new LogbookMutationSession(request, () => {});
  const result = render(<DeskMapLogbook map={<div>Memory-only map</div>} logbook={<LogbookPanel
    mutations={mutations} onRequest={request} onEdit={vi.fn()} refreshKey={0} />} />);
  await act(async () => { view("logbook"); });
  await notifyResize();
  fireEvent.click(screen.getByText(contact.call));
  expect(request.mock.calls.some(([method, params]) => method === "logbook_list" && params?.limit === 8)).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); });
  const consent = screen.getByRole("group", { name: `Delete ${contact.call}` });
  const table = screen.getByRole("table"), pane = result.container.querySelector(".desk-map-logbook-logbook")!;
  const applies = () => request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(applies()).toHaveLength(0); expect(backend.updates).toBe(0);

  view("map"); tableHeight = 0; await notifyResize();
  expect(pane.hasAttribute("hidden")).toBe(true); expect(pane.hasAttribute("inert")).toBe(true);
  expect(pane.contains(consent)).toBe(true); expect(pane.contains(table)).toBe(true);
  view("logbook-above"); tableHeight = 200; await notifyResize();
  expect(request.mock.calls.some(([method, params]) => method === "logbook_list" && params?.limit === 5)).toBe(true);
  expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBe(consent);
  expect(screen.getByRole("table")).toBe(table);
  view("logbook-below");
  const divider = screen.getByRole("separator", { name: "Map and Logbook height" });
  pointer(divider, "pointerdown", 300); pointer(divider, "pointermove", 240); pointer(divider, "pointerup", 240);
  height = 810; tableHeight = 340; await notifyResize();
  expect(request.mock.calls.some(([method, params]) => method === "logbook_list" && params?.limit === 10)).toBe(true);
  expect(screen.getByRole("table")).toBe(table);
  expect(screen.getByRole("group", { name: `Delete ${contact.call}` })).toBe(consent);
  expect(request.mock.calls.filter(([method]) => method === "logbook_contact")).toHaveLength(1);
  expect(applies()).toHaveLength(0); expect(backend.updates).toBe(0);

  if (changedElsewhere) backend.request("logbook_contact_apply", { operationID: "synthetic-other-window", contactID: contact.id,
    generation: reviewed.generation, expectedRevision: reviewed.revision, action: "update", qso: { ...contact, comment: "Changed after review" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm delete" })); });
  expect(applies()).toHaveLength(1);
  expect(applies()[0][1]).toMatchObject({ action: "delete", contactID: contact.id,
    generation: reviewed.generation, expectedRevision: reviewed.revision });
  if (changedElsewhere) {
    expect(mutations.getSnapshot().conflict).toBe(true);
    expect(backend.contact.qso.deletedAt).toBeUndefined();
    expect(backend.contact.qso.comment).toBe("Changed after review");
  } else {
    expect(backend.contact.qso.deletedAt).toBe("2026-10-13T00:00:00Z");
    expect(backend.updates).toBe(1); expect(backend.contact.revision).toBe(reviewed.revision + 1);
  }
  expect(applies()).toHaveLength(1);
});
