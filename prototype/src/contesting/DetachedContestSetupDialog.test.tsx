// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestSetupDialog } from "./DetachedContestSetupDialog";
import { newContestSetup, contestSetupTabs } from "./ContestSetupPanel";
import { mergeSetupDialog, useContestSetupDialogs } from "./contestSetupDialogs";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const snapshot = () => ({ epoch: "owner", context: "workspace/session", revision: 2, document: newContestSetup("OM0RX") });
function open(kind: "station" | "configuration") {
  window.history.replaceState({}, "", `?view=contest-setup-${kind}`);
  native.invoke.mockImplementation(async (_command, { method }) => method === "snapshot" ? snapshot() : null);
  return render(<DetachedContestSetupDialog/>);
}
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
  function Owner() { useContestSetupDialogs({ enabled: true, context: source.context, document: source.document, save, report }); return null; }
  render(<Owner/>);
  await waitFor(() => expect(completions).toBe(2));
  expect(save).toHaveBeenCalledTimes(1);
});
it("rejects a dialog save when owner context changes while the request is being read", async () => {
  const source = snapshot(), save = vi.fn(async () => {}), report = vi.fn();
  let deliver!: (value: unknown) => void;
  native.invoke.mockImplementation(async (_command, { method }) => {
    if (method === "next") return new Promise(resolve => { deliver = resolve; });
    return source;
  });
  function Owner({ context }: { context: string }) {
    useContestSetupDialogs({ enabled: true, context, document: source.document, save, report }); return null;
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
