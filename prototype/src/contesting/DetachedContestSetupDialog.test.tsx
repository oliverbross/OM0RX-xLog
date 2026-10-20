// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { configurationDialogContentHeight, DetachedContestSetupDialog, fittedConfigurationDialogHeight, isManagedConfigurationDialogHeight } from "./DetachedContestSetupDialog";
import { newContestSetup, contestSetupTabs } from "./ContestSetupPanel";
import { mergeSetupDialog, useContestSetupDialogs } from "./contestSetupDialogs";
import { loadWindowSurface } from "../windowSurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), setSize: vi.fn(), innerSize: vi.fn(), scaleFactor: vi.fn(async () => 2),
  onResized: vi.fn(), observedTargets: [] as Element[],
  mutationHandler: null as MutationCallback | null,
  resizeObserverHandler: null as ResizeObserverCallback | null,
  resizeHandler: null as null | ((event: { payload: { toLogical: (scale: number) => { width: number; height: number } } }) => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setSize: native.setSize, innerSize: native.innerSize, scaleFactor: native.scaleFactor, onResized: native.onResized }) }));
vi.stubGlobal("ResizeObserver", class {
  constructor(callback: ResizeObserverCallback) { native.resizeObserverHandler = callback; }
  observe(target: Element) { native.observedTargets.push(target); }
  disconnect() {}
  unobserve() {}
});
vi.stubGlobal("MutationObserver", class {
  constructor(callback: MutationCallback) { native.mutationHandler = callback; }
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
});
beforeEach(() => {
  localStorage.clear();
  native.resizeHandler = null;
  native.mutationHandler = null;
  native.resizeObserverHandler = null;
  native.observedTargets = [];
  native.innerSize.mockImplementation(async () => ({ toLogical: () => ({ width: 820, height: 320 }) }));
  native.onResized.mockImplementation(async handler => { native.resizeHandler = handler; return vi.fn(); });
  native.setSize.mockImplementation(async size => { queueMicrotask(() => native.resizeHandler?.({ payload: { toLogical: () => ({ width: size.width, height: size.height }) } })); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const snapshot = () => ({ epoch: "owner", context: "workspace/session", revision: 2, document: newContestSetup("OM0RX"),
  auxiliary:{roverLocation:"",activeSessionID:"session",effectiveMacros:[{mode:"R" as const,key:"F1",label:"CQ",template:"CQ {MYCALL}"}],
    diagnostics:{engine:"Not1MM Python",plugin:"cq_ww_cw",version:"26.10.11",source:"source",reference:"reference"}} });
function open(kind: "station" | "configuration" | "macros") {
  window.history.replaceState({}, "", `?view=contest-setup-${kind}`);
  native.invoke.mockImplementation(async (_command, { method }) => method === "snapshot" ? snapshot() : null);
  return render(<DetachedContestSetupDialog/>);
}
it("routes Edit Macros to its independent setup dialog", async () => {
  await expect(loadWindowSurface("?view=contest-setup-macros")).resolves.toBe(DetachedContestSetupDialog);
});
it("opens isolated Station fields and Cancel closes without submitting", async () => {
  open("station");
  fireEvent.change(await screen.findByRole("textbox", { name: "City" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_setup_dialog_request", { method: "close", params: {} }));
  expect(native.invoke.mock.calls.some(([,args]) => args.method === "submit")).toBe(false);
  expect(screen.queryByRole("button", { name: "New Contest" })).toBeNull();
});
it("recovers when the dialog opens before the setup owner publishes its first snapshot", async () => {
  window.history.replaceState({}, "", "?view=contest-setup-station");
  native.invoke.mockRejectedValueOnce(new Error("Contest Setup is unavailable."))
    .mockResolvedValueOnce(snapshot());
  render(<DetachedContestSetupDialog/>);
  expect((await screen.findByRole("alert")).textContent).toContain("unavailable");
  expect(await screen.findByRole("textbox", { name: "City" }, { timeout: 1_000 })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps the original Configuration tab order and fields", async () => {
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([...contestSetupTabs]);
  fireEvent.click(screen.getByRole("tab", { name: "Bands" }));
  expect(screen.getByLabelText("160m")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit Keys" })).toBeNull();
});
it("edits effective Run and S&P macros through one revision-fenced owner save", async () => {
  open("macros");
  expect((await screen.findByLabelText("Run F1 label") as HTMLInputElement).value).toBe("CQ");
  expect((screen.getByLabelText("Run F1 template") as HTMLInputElement).value).toBe("CQ {MYCALL}");
  expect(screen.getByLabelText("S&P F12 template")).toBeTruthy();
  native.invoke.mockImplementation(async (_command, { method, params }) => {
    if (method === "snapshot") return snapshot();
    if (method === "submit") return { requestID: params.requestID, status: "saved" };
    return null;
  });
  fireEvent.change(screen.getByLabelText("Run F1 label"), { target: { value: "CQ TEST" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(native.invoke.mock.calls.some(([,args]) => args.method === "close")).toBe(true));
  const submit = native.invoke.mock.calls.find(([,args]) => args.method === "submit")?.[1].params;
  expect(submit.document.macros).toEqual(expect.arrayContaining([{mode:"R",key:"F1",label:"CQ TEST",template:"CQ {MYCALL}"}]));
});
it("auto-fits a managed Configuration default to its measured content", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(476);
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.setSize).toHaveBeenCalled());
  expect(native.setSize.mock.calls.at(-1)?.[0]).toMatchObject({ width: 820, height: 476 });
  expect(native.observedTargets).toHaveLength(2);
});
it("re-fits a managed Configuration window when a tab replaces its content", async () => {
  let measuredHeight = 340, current = { width: 820, height: 320 };
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("contest-setup") ? measuredHeight : 320;
  });
  native.innerSize.mockImplementation(async () => ({ toLogical: () => current }));
  native.setSize.mockImplementation(async size => {
    current = { width: size.width, height: size.height };
    queueMicrotask(() => native.resizeHandler?.({ payload: { toLogical: () => current } }));
  });
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.mutationHandler).toBeTypeOf("function"));
  await waitFor(() => expect(native.setSize).toHaveBeenCalled());
  await waitFor(() => expect(localStorage.getItem("xlog.contest.configuration.auto-fit-size.v1")).toContain('"height":340'));
  native.setSize.mockClear();
  measuredHeight = 520;
  fireEvent.click(screen.getByRole("tab", { name: "Options" }));
  await waitFor(() => expect(native.setSize).toHaveBeenCalled());
  const grown = native.setSize.mock.calls.at(-1)?.[0].height;
  expect(grown).toBeGreaterThanOrEqual(520);
  native.setSize.mockClear();
  measuredHeight = 390;
  fireEvent.click(screen.getByRole("tab", { name: "CAT" }));
  await act(async () => native.resizeObserverHandler?.([], {} as ResizeObserver));
  await waitFor(() => expect(native.setSize).toHaveBeenCalled());
  expect(native.setSize.mock.calls.at(-1)?.[0].height).toBeLessThan(grown);
});
it("measures intrinsic Configuration content instead of its capped scrolling shell", () => {
  const root = document.createElement("main"), content = document.createElement("section");
  root.style.paddingTop = "12px";
  root.style.paddingBottom = "12px";
  root.append(content);
  Object.defineProperty(root, "scrollHeight", { value: 320 });
  Object.defineProperty(content, "scrollHeight", { value: 500 });
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ height: 480 } as DOMRect);
  expect(configurationDialogContentHeight(root)).toBe(524);
});
it("includes content concealed by the Configuration fieldset scroll region", () => {
  const root = document.createElement("main"), content = document.createElement("section"), fieldset = document.createElement("fieldset");
  root.style.paddingTop = "12px";
  root.style.paddingBottom = "12px";
  root.append(content); content.append(fieldset);
  Object.defineProperty(content, "scrollHeight", { value: 300 });
  Object.defineProperty(fieldset, "scrollHeight", { value: 330 });
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ height: 300 } as DOMRect);
  vi.spyOn(fieldset, "getBoundingClientRect").mockReturnValue({ height: 150 } as DOMRect);
  expect(configurationDialogContentHeight(root)).toBe(504);
});
it("recognizes its measured fit after reopening and keeps fitting later content", async () => {
  const measured = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(497);
  let current = { width: 820, height: 320 };
  native.innerSize.mockImplementation(async () => ({ toLogical: () => current }));
  native.setSize.mockImplementation(async size => {
    current = { width: size.width, height: size.height };
    queueMicrotask(() => native.resizeHandler?.({ payload: { toLogical: () => current } }));
  });
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.setSize.mock.calls.at(-1)?.[0]).toMatchObject({ width: 820, height: 497 }));
  await waitFor(() => expect(localStorage.getItem("xlog.contest.configuration.auto-fit-size.v1")).toContain('"height":497'));
  cleanup();
  native.setSize.mockClear();
  measured.mockReturnValue(530);
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.setSize.mock.calls.at(-1)?.[0]).toMatchObject({ width: 820, height: 530 }));
});
it("preserves a user-restored Configuration size instead of auto-fitting it", async () => {
  native.innerSize.mockImplementation(async () => ({ toLogical: () => ({ width: 900, height: 600 }) }));
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.innerSize).toHaveBeenCalled());
  expect(native.setSize).not.toHaveBeenCalled();
});
it("keeps the operator's final drag size when fit and restore writes arrive late", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(476);
  let current = { width: 820, height: 320 }, finishFit!: () => void, finishRestore!: () => void;
  native.innerSize.mockImplementation(async () => ({ toLogical: () => current }));
  native.setSize
    .mockImplementationOnce(size => new Promise<void>(resolve => { finishFit = () => { current = { width: size.width, height: size.height }; resolve(); }; }))
    .mockImplementationOnce(size => new Promise<void>(resolve => { finishRestore = () => { current = { width: size.width, height: size.height }; resolve(); }; }));
  open("configuration");
  await screen.findByRole("tab", { name: "Lookup" });
  await waitFor(() => expect(native.setSize).toHaveBeenCalledTimes(1));
  current = { width: 900, height: 600 };
  await act(async () => native.resizeHandler?.({ payload: { toLogical: () => ({ width: 900, height: 600 }) } }));
  await act(async () => finishFit());
  await waitFor(() => expect(native.setSize).toHaveBeenCalledTimes(2));
  expect(native.setSize.mock.calls[1]?.[0]).toMatchObject({ width: 900, height: 600 });
  current = { width: 940, height: 640 };
  await act(async () => native.resizeHandler?.({ payload: { toLogical: () => ({ width: 940, height: 640 }) } }));
  await act(async () => finishRestore());
  await waitFor(() => expect(native.setSize).toHaveBeenCalledTimes(3));
  expect(native.setSize.mock.calls[2]?.[0]).toMatchObject({ width: 940, height: 640 });
});
it("submits once while pending and closes only after a saved receipt", async () => {
  open("station");
  await screen.findByRole("textbox", { name: "City" });
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementation(async (_command, { method, params }) => {
    if (method === "submit") return { requestID: params.requestID, status: "pending" };
    if (method === "receipt") return new Promise(resolve => { finish = resolve; });
    return null;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "City" }), { target: { value: "Darwin" } });
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(native.invoke.mock.calls.filter(([,args]) => args.method === "submit")).toHaveLength(1));
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(native.invoke.mock.calls.some(([,args]) => args.method === "close")).toBe(false);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish({ status: "saved", requestID: "save" }));
  await waitFor(() => expect(native.invoke.mock.calls.some(([,args]) => args.method === "close")).toBe(true));
  expect(native.invoke.mock.calls.every(([command]) => command === "contest_setup_dialog_request")).toBe(true);
});
it("reconciles a lost initial submit reply without resending the save", async () => {
  open("station");
  await screen.findByRole("textbox", { name: "City" });
  native.invoke.mockImplementation(async (_command, { method, params }) => {
    if (method === "submit") throw new Error("IPC reply lost");
    if (method === "receipt") return {requestID:params.requestID,status:"saved"};
    return null;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "City" }), { target: { value: "Darwin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(native.invoke.mock.calls.some(([,args]) => args.method === "close")).toBe(true));
  expect(native.invoke.mock.calls.filter(([,args]) => args.method === "submit")).toHaveLength(1);
  expect(native.invoke.mock.calls.some(([,args]) => args.method === "receipt")).toBe(true);
});
it("preserves failed stale-save edits without closing", async () => {
  open("station");
  fireEvent.change(await screen.findByRole("textbox", { name: "City" }), { target: { value: "Keep me" } });
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "submit") throw new Error("Setup changed. Reopen the dialog before saving.");
    if (method === "receipt") return null;
    return null;
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("status")).textContent).toContain("Setup changed");
  expect((screen.getByRole("textbox", { name: "City" }) as HTMLInputElement).value).toBe("Keep me");
  expect(native.invoke.mock.calls.some(([,args]) => args.method === "close")).toBe(false);
});
it("merges only each dialog's fields into the owner's latest setup", () => {
  const current = newContestSetup("OM0RX"), requested = structuredClone(current);
  requested.station.City = "Darwin"; requested.settings.Soapbox = "unowned"; requested.preferences.cwSpeed = 30;
  requested.macros = [{ key: "F1", mode: "R", label: "unowned", template: "TEST" }];
  const station = mergeSetupDialog(current, requested, "station");
  expect(station.station.City).toBe("Darwin"); expect(station.settings).toEqual(current.settings);
  expect(station.preferences).toEqual(current.preferences); expect(station.macros).toEqual(current.macros);
  const config = mergeSetupDialog(current, requested, "configuration");
  expect(config.preferences.cwSpeed).toBe(30); expect(config.station).toEqual(current.station); expect(config.macros).toEqual(current.macros);
  const macros = mergeSetupDialog(current, requested, "macros");
  expect(macros.macros).toEqual(requested.macros); expect(macros.station).toEqual(current.station);
  expect(macros.preferences).toEqual(current.preferences); expect(macros.network).toEqual(current.network);
});
it("uses one owner save for a repeated native request after a lost completion", async () => {
  const source = snapshot(), save = vi.fn(async () => {}), report = vi.fn();
  const pending = { ...source, requestID: "save-1", kind: "station" };
  let completions = 0;
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "next") return completions < 2 ? pending : null;
    if (method === "complete") { completions++; if (completions === 1) throw new Error("Lost reply"); }
    return source;
  });
  function Owner() { useContestSetupDialogs({ enabled: true, context: source.context, document: source.document, auxiliary:source.auxiliary, save, saveRover:vi.fn(), report }); return null; }
  render(<Owner/>);
  await waitFor(() => expect(completions).toBe(2));
  expect(save).toHaveBeenCalledTimes(1);
});
it("routes Digital logging changes through the existing setup owner", async () => {
  const source = snapshot(), saveDigital = vi.fn(async () => {}), report = vi.fn();
  const pending = { ...source, requestID:"digital-1", kind:"digital", digital:{
    configuration:{enabled:false,address:"224.0.0.1",port:2237}, action:"start" } };
  let delivered = false;
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "next" && !delivered) { delivered = true; return pending; }
    return method === "next" ? null : source;
  });
  function Owner() { useContestSetupDialogs({ enabled:true, context:source.context, document:source.document,
    auxiliary:source.auxiliary, save:vi.fn(), saveRover:vi.fn(), saveDigital, report }); return null; }
  render(<Owner/>);
  await waitFor(() => expect(saveDigital).toHaveBeenCalledExactlyOnceWith(pending.digital));
  expect(native.invoke).toHaveBeenCalledWith("contest_setup_dialog_request", { method:"complete",
    params:expect.objectContaining({requestID:"digital-1",ok:true}) });
});
it("returns a real Digital host rejection to the dialog receipt", async () => {
  const source = snapshot(), report = vi.fn(), failure = new Error("WSJT-X port is already in use");
  const pending = { ...source, requestID:"digital-failed", kind:"digital", digital:{
    configuration:{enabled:true,address:"224.0.0.1",port:2237}, action:"start" } };
  let delivered = false;
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "next" && !delivered) { delivered = true; return pending; }
    return method === "next" ? null : source;
  });
  function Owner() { useContestSetupDialogs({ enabled:true, context:source.context, document:source.document,
    auxiliary:source.auxiliary, save:vi.fn(), saveRover:vi.fn(), saveDigital:vi.fn(async () => { throw failure; }), report }); return null; }
  render(<Owner/>);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_setup_dialog_request", { method:"complete",
    params:expect.objectContaining({requestID:"digital-failed",ok:false,message:"WSJT-X port is already in use"}) }));
});
it("rejects a dialog save when owner context changes while the request is being read", async () => {
  const source = snapshot(), save = vi.fn(async () => {}), report = vi.fn();
  let deliver!: (value: unknown) => void;
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "next") return new Promise(resolve => { deliver = resolve; });
    return source;
  });
  function Owner({ context }: { context: string }) {
    useContestSetupDialogs({ enabled: true, context, document: source.document, auxiliary:source.auxiliary, save, saveRover:vi.fn(), report }); return null;
  }
  const view = render(<Owner context={source.context}/>);
  await waitFor(() => expect(deliver).toBeTypeOf("function"));
  view.rerender(<Owner context="new-workspace/new-session"/>);
  await act(async () => deliver({ ...source, requestID: "stale-save", kind: "station" }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_setup_dialog_request", {
    method: "complete", params: expect.objectContaining({requestID:"stale-save",ok:false,message:expect.stringContaining("Setup changed")}),
  }));
  expect(save).not.toHaveBeenCalled();
});
it("uses compact content-fit bounds while keeping dense configuration tabs fully visible", () => {
  const styles = readFileSync("src/contesting/DetachedContestSetupDialog.css", "utf8");
  expect(fittedConfigurationDialogHeight(180, 900)).toBe(320);
  expect(fittedConfigurationDialogHeight(476, 900)).toBe(476);
  expect(fittedConfigurationDialogHeight(1200, 1000)).toBe(900);
  expect(fittedConfigurationDialogHeight(1200, 900)).toBe(836);
  expect(isManagedConfigurationDialogHeight(320, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(463, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(476, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(520, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(620, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(680, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(900, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(836, 900)).toBe(true);
  expect(isManagedConfigurationDialogHeight(600, 900)).toBe(false);
  expect(styles).toContain("data-dialog-kind=configuration");
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*height:auto[^}]*max-height:100dvh[^}]*overflow:hidden/);
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*\.contest-setup fieldset[^}]*flex:1[^}]*min-height:0[^}]*overflow:auto/);
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*\[role=tablist\][^}]*display:grid[^}]*grid-template-columns:repeat\(10,minmax\(0,1fr\)\)[^}]*overflow:visible/);
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*button\[role=tab\][^}]*min-width:0[^}]*font-size:clamp\(8px,1\.45vw,12px\)/);
  expect(styles).not.toMatch(/\[role=tablist\][^{]*\{[^}]*flex-wrap/);
  expect(styles).toContain(".contest-setup-dialog[data-dialog-kind=configuration] .contest-manual-content { min-height:0; }");
  expect(styles).toContain(".contest-setup-dialog[data-dialog-kind=configuration] .contest-manual-stack { gap:6px; }");
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*\.contest-setup :is\(input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),select,textarea\)[^}]*min-height:28px/);
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*\.contest-setup footer[^}]*padding-block:8px/);
  expect(styles).toMatch(/data-dialog-kind=configuration[^}]*\.contest-setup footer[^}]*position:static/);
  expect(styles).toMatch(/data-dialog-kind=macros[^}]*\.contest-manual-content[^}]*display:grid[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  expect(styles).toMatch(/data-dialog-kind=macros[^}]*\.contest-macro-table[^}]*min-width:0[^}]*table-layout:fixed/);
  expect(styles).toMatch(/@media\(max-width:700px\)[^{]*\{[^}]*data-dialog-kind=macros[^}]*grid-template-columns:minmax\(0,1fr\)/);
});
