// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LogbookPanel from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";
import { contactEditFixture } from "../../tests/contact-edit-fixture";

const contact = { id: "working-contact", call: "TEST1", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
const page = (qsos: object[] = [contact]) => ({ qsos, total: qsos.length, offset: 0, limit: 20 });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["disabled", "busy", "pending", "conflict", "workspaceChanged"])("does not admit a file selected after the ready picker became %s", async blocker => {
  const working = vi.fn(), text = vi.fn().mockResolvedValue(new TextEncoder().encode("<CALL:5>TEST1<EOR>").buffer);
  const request = vi.fn(async (_method: string) => page()), mutations = new LogbookMutationSession(request, () => {}), edit = vi.fn();
  const props = { mutations, onRequest: request, onEdit: edit, refreshKey: 0, onWorkingChange: working };
  const view = render(<LogbookPanel {...props} />); await screen.findByText(contact.call);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const picker = vi.spyOn(input, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Import ADIF" })); expect(picker).toHaveBeenCalledOnce();
  if (blocker === "disabled") {
    view.rerender(<LogbookPanel {...props} disabled />); expect(input.disabled).toBe(true);
  } else {
    // No render is required: operation admission must inspect the live session.
    vi.spyOn(mutations, "getSnapshot").mockReturnValue({ ...mutations.getSnapshot(), [blocker]: true } as any);
  }
  const file = new File([], "synthetic.adi"); Object.defineProperty(file, "arrayBuffer", { value: text });
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  expect(text).not.toHaveBeenCalled(); expect(working).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([method]) => method === "logbook_import_adif")).toBe(false);
});

it("clears a rejected picker selection so the same File can be selected explicitly after unlock", async () => {
  const working = vi.fn(), text = vi.fn().mockResolvedValue(new TextEncoder().encode("<CALL:5>TEST1<EOR>").buffer);
  const request = vi.fn(async (method: string) => method === "logbook_import_adif" ? { imported: 1, skipped_duplicates: 0 } : page());
  const mutations = new LogbookMutationSession(request, () => {});
  const props = { mutations, onRequest: request, onEdit: vi.fn(), refreshKey: 0, onWorkingChange: working };
  const view = render(<LogbookPanel {...props} />); await screen.findByText(contact.call);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  vi.spyOn(input, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Import ADIF" }));
  view.rerender(<LogbookPanel {...props} disabled />);
  const file = new File([], "synthetic.adi"); Object.defineProperty(file, "arrayBuffer", { value: text });
  // jsdom does not populate the browser's displayed fake path on file selection.
  Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\synthetic.adi" });
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  expect(input.value).toBe(""); expect(text).not.toHaveBeenCalled(); expect(working).not.toHaveBeenCalled();
  view.rerender(<LogbookPanel {...props} />);
  expect(text).not.toHaveBeenCalled(); // Unlock never automatically retries.
  input.value = "C:\\fakepath\\synthetic.adi";
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  await waitFor(() => expect(working.mock.calls).toEqual([[true], [false]]));
  expect(input.value).toBe(""); expect(text).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(1);
});

it.each(["Import", "Export"])("reports held %s synchronously and releases intrinsic working despite aggregate disabled feedback", async operation => {
  const gate = deferred<any>(), working = vi.fn(), aggregate = vi.fn();
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "logbook_import_adif") return { imported: 1, skipped_duplicates: 0 };
    if (method === "logbook_export_adif") return gate.promise;
    if (method === "logbook_list" && params?.limit === 1) expect(working).toHaveBeenLastCalledWith(true);
    return page();
  });
  const mutations = new LogbookMutationSession(request, () => {});
  function Host({ forced = false }: { forced?: boolean }) {
    const [reported, setReported] = useState(false);
    return <LogbookPanel mutations={mutations} onRequest={request} onEdit={vi.fn()} refreshKey={0} disabled={forced || reported}
      onBusyChange={aggregate} onWorkingChange={value => { working(value); setReported(value); }} />;
  }
  const view = render(<Host />); await screen.findByText(contact.call);
  expect(working).not.toHaveBeenCalled();
  if (operation === "Import") {
    const file = new File([], "synthetic.adi", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: () => { expect(working).toHaveBeenLastCalledWith(true); return gate.promise; } });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  } else fireEvent.click(screen.getByRole("button", { name: "Export all" }));
  expect(working.mock.calls).toEqual([[true]]);
  expect((screen.getByRole("button", { name: "Export all" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<Host forced />); view.rerender(<Host />); view.rerender(<Host forced />);
  expect(working.mock.calls).toEqual([[true]]);
  await act(async () => { gate.resolve(operation === "Import" ? new TextEncoder().encode("<CALL:5>TEST1<EOR>").buffer : { text: "", count: 0 }); });
  await waitFor(() => expect(working.mock.calls).toEqual([[true], [false]]));
  // External disabled remains true, but must not latch the intrinsic signal.
  expect(aggregate).toHaveBeenLastCalledWith(true);
  view.rerender(<Host />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Export all" }) as HTMLButtonElement).disabled).toBe(false));
  expect(aggregate).toHaveBeenLastCalledWith(false);
  expect(working.mock.calls).toEqual([[true], [false]]);
  if (operation === "Import") expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(1);
});

it("reports Delete and Undo locally before their mutation dispatches, not during preparation", async () => {
  const backend = contactEditFixture(contact), working = vi.fn();
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "logbook_contact_apply") expect(working).toHaveBeenLastCalledWith(true);
    return backend.request(method, params) ?? page(backend.contact.qso.deletedAt ? [] : [backend.contact.qso]);
  });
  render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} onWorkingChange={working} />);
  fireEvent.click(await screen.findByText(contact.call));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("button", { name: "Confirm delete" }); expect(working).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" })); expect(working).toHaveBeenLastCalledWith(true);
  await waitFor(() => expect(working.mock.calls).toEqual([[true], [false]]));
  fireEvent.click(screen.getByRole("button", { name: "Undo delete" })); expect(working).toHaveBeenLastCalledWith(true);
  await waitFor(() => expect(working.mock.calls).toEqual([[true], [false], [true], [false]]));
  expect(backend.contact.qso.deletedAt).toBeNull();
});

it("clears on unmount without a late completion unlatching a replacement host", async () => {
  const gate = deferred<any>(), working = vi.fn();
  const request = vi.fn(async (method: string) => method === "logbook_export_adif" ? gate.promise : page());
  const view = render(<LogbookPanel mutations={new LogbookMutationSession(request, () => {})} onRequest={request} onEdit={vi.fn()} refreshKey={0} onWorkingChange={working} />);
  await screen.findByText(contact.call); fireEvent.click(screen.getByRole("button", { name: "Export all" }));
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "logbook_export_adif")).toBe(true));
  expect(working.mock.calls).toEqual([[true]]);
  view.unmount(); expect(working.mock.calls).toEqual([[true], [false]]);
  await act(async () => { gate.resolve({ text: "", count: 0 }); });
  expect(working.mock.calls).toEqual([[true], [false]]);
});
