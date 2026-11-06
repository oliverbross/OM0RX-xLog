// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { LogbookMutationSession } from "./logbookMutationSession";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => native);
afterEach(() => { cleanup(); vi.doUnmock("./adifTransfer"); vi.restoreAllMocks(); });

const contact = { id: "1d9961f9-3eb1-42ca-8d0a-063eb21b4577", call: "W1AW", start: "2026-10-14T00:00:00Z", band: "20m", mode: "CW" };
const adif = "<CALL:4>W1AW<QSO_DATE:8>20261014<TIME_ON:6>000000<BAND:3>20m<MODE:2>CW<EOR>";

it.each(["export", "import"] as const)("drains a pending codec load without resuming a cancelled %s", async kind => {
  // Give each cold import its own pending factory and module cache.
  vi.resetModules();
  let releaseCodec!: () => void;
  const pending = new Promise<void>(resolve => { releaseCodec = resolve; });
  const codecLoad = { entered: vi.fn(), decoded: vi.fn(), constructed: vi.fn() };
  vi.doMock("./adifTransfer", async () => {
    codecLoad.entered();
    await pending;
    const actual = await vi.importActual<typeof import("./adifTransfer")>("./adifTransfer");
    return {
      ...actual,
      decodeADIFDocument: (...args: Parameters<typeof actual.decodeADIFDocument>) => {
        codecLoad.decoded(); return actual.decodeADIFDocument(...args);
      },
      ADIFExportDocument: class extends actual.ADIFExportDocument {
        constructor(...args: ConstructorParameters<typeof actual.ADIFExportDocument>) { super(...args); codecLoad.constructed(); }
      },
    };
  });
  native.invoke.mockReset();
  // No production dependency seam or replacement ADIFSessionOwner is involved.
  const { default: LogbookPanel } = await import("./LogbookPanel");
  expect(codecLoad.entered).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({ saved: true, cancelled: false });
  let exports = 0;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<object> => {
    if (params?.action === "retire") return { retired: true };
    if (method === "logbook_export_adif") return params?.action === "begin"
      ? { token: `frozen-${++exports}`, workspace_generation: "workspace-1", total: 1 }
      : { text: adif, count: 1 };
    if (method === "logbook_import_adif") return { records: 1, duplicates: 0, generation: "workspace-1", token: "review-1", issues: [] };
    return { qsos: [contact], total: 1, offset: 0, limit: 20 };
  });
  const props = { mutations: new LogbookMutationSession(request, () => {}), onRequest: request, onEdit: vi.fn(), refreshKey: 0 };
  const view = render(<LogbookPanel {...props} readScope="workspace-1" />);
  await within(view.container).findByText("W1AW");
  const bytes = vi.fn(async () => new TextEncoder().encode(adif).buffer);
  const file = new File([], "review.adi"); Object.defineProperty(file, "arrayBuffer", { value: bytes });
  if (kind === "export") fireEvent.click(within(view.container).getByRole("button", { name: "Export all" }));
  else await act(async () => { fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } }); });
  await waitFor(() => expect(codecLoad.entered).toHaveBeenCalledOnce());
  if (kind === "export") view.rerender(<LogbookPanel {...props} readScope="workspace-2" />);
  else { expect(bytes).toHaveBeenCalledOnce(); view.unmount(); }
  expect(request.mock.calls.filter(([, params]) => params?.action === "retire")).toHaveLength(0);
  expect(request.mock.calls.filter(([, params]) => params?.action === "read")).toHaveLength(0);
  expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(0);
  expect(codecLoad.decoded).not.toHaveBeenCalled();
  expect(codecLoad.constructed).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();

  await act(async () => { releaseCodec(); await vi.dynamicImportSettled(); });
  if (kind === "export") await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: "frozen-1", generation: "workspace-1" }));
  expect(request.mock.calls.filter(([, params]) => params?.action === "retire")).toHaveLength(kind === "export" ? 1 : 0);
  expect(request.mock.calls.filter(([, params]) => params?.action === "read")).toHaveLength(0);
  expect(request.mock.calls.filter(([method]) => method === "logbook_import_adif")).toHaveLength(0);
  expect(codecLoad.decoded).not.toHaveBeenCalled();
  expect(codecLoad.constructed).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();
  if (kind === "export") view.unmount();

  // Positive controls delegate to the real codec and actual visible buttons.
  const active = render(<LogbookPanel {...props} readScope="workspace-1" />);
  await within(active.container).findByText("W1AW");
  fireEvent.click(within(active.container).getByRole("button", { name: "Export all" }));
  await within(active.container).findByText("1 QSOs exported from the integrated logbook.");
  expect(codecLoad.constructed).toHaveBeenCalledOnce();
  expect(native.invoke).toHaveBeenCalledOnce();
  expect(native.invoke.mock.calls[0][0]).toBe("logbook_export_file");
  expect(native.invoke.mock.calls[0][1].content).toBe(adif);
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_export_adif", { action: "retire", token: `frozen-${exports}`, generation: "workspace-1" }));
  await act(async () => { fireEvent.change(active.container.querySelector('input[type="file"]')!, { target: { files: [file] } }); });
  await within(active.container).findByRole("group", { name: "Review ADIF import" });
  expect(codecLoad.decoded).toHaveBeenCalledOnce();
  fireEvent.click(within(active.container).getByRole("button", { name: "Cancel import" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_import_adif", { action: "retire", token: "review-1", generation: "workspace-1" }));
  active.unmount();
  expect(request.mock.calls.filter(([, params]) => params?.action === "retire").map(([method, params]) => [method, params?.token, params?.generation])).toEqual([
    ...(kind === "export" ? [["logbook_export_adif", "frozen-1", "workspace-1"]] : []),
    ["logbook_export_adif", `frozen-${exports}`, "workspace-1"],
    ["logbook_import_adif", "review-1", "workspace-1"],
  ]);
});
