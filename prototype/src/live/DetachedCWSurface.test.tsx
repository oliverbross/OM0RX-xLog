// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedCWSurface } from "./DetachedCWSurface";
import { defaultCWProfile } from "./cwMacros";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ TauriEvent: { WINDOW_CLOSE_REQUESTED: "close-requested" } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: native.listen }) }));
let closeRequested: () => void;
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private changed: (entries: any[]) => void) {}
    observe() { this.changed([{ contentRect: { width: 1800 } }]); } disconnect() {}
  });
  native.listen.mockImplementation(async (_event, callback) => { closeRequested = callback; return native.dispose; });
  const profile = structuredClone(defaultCWProfile); profile.showOnDesk = true;
  profile.macros[0] = { ...profile.macros[0], label: "CQ", enabled: true, onDesk: true, shortcut: "F1", text: "CQ" };
  let armed = false, revision = 0, holder: string | null = null;
  native.invoke.mockImplementation(async (command, args) => {
    if (command !== "cw_session_request") return;
    const { client, params } = args;
    if (params.action === "arm") { armed = true; holder = client; revision++; }
    if (params.action === "stop" || params.action === "unregister" && holder === client) { armed = false; holder = null; revision++; }
    return { revision, armed, pending: false, owner: null, client: holder, lease: armed ? "native-lease" : null,
      message: armed ? "CW armed" : "CW disarmed", error: "", winkeyer: null,
      canonical: { profile, context: { MYCALL: "OM0RX", CALL: "K1ABC" }, provider: "direct_agent" } };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const actions = () => native.invoke.mock.calls.filter(call => call[0] === "cw_session_request").map(call => call[1].params.action);

it("mounts passively and sends only a saved macro ID through the shared owner after explicit Arm", async () => {
  render(<DetachedCWSurface />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Arm CW" }).hasAttribute("disabled")).toBe(false));
  expect(actions()).toEqual(["snapshot"]);
  expect(native.invoke.mock.calls.every(call => call[0] === "cw_session_request")).toBe(true);
  fireEvent.keyDown(document.body, { key: "F1" }); expect(actions()).toEqual(["snapshot"]);
  fireEvent.click(screen.getByRole("button", { name: "Arm CW" })); await screen.findByRole("button", { name: "Disarm CW" });
  fireEvent.click(screen.getByRole("button", { name: /^CQ/ }));
  await waitFor(() => expect(actions()).toContain("send"));
  const send = native.invoke.mock.calls.find(call => call[1]?.params?.action === "send")![1].params;
  expect(send).toEqual({ action: "send", expectedRevision: 1, lease: "native-lease", macroID: profileMacroID() });
  expect(send).not.toHaveProperty("text"); expect(send).not.toHaveProperty("context");
  await act(async () => { window.dispatchEvent(new Event("blur")); });
  expect(actions().at(-1)).toBe("unregister"); expect(actions()).not.toContain("stop");
});
const profileMacroID = () => defaultCWProfile.macros[0].id;

it("uses native protected Close/Dock, keeps failed transitions open and recovers controls", async () => {
  render(<DetachedCWSurface />);
  await waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "close_cw_window" || command === "dock_detached_window") throw new Error("Stop unconfirmed");
    return original(command, args);
  });
  await act(async () => { closeRequested(); });
  expect(screen.getByRole("alert").textContent).toContain("CW remains open. Stop unconfirmed");
  expect(screen.getByRole("button", { name: "Close CW" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Dock back" }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("dock_detached_window"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Dock back" }).hasAttribute("disabled")).toBe(false));
  expect(actions().every(action => action === "snapshot")).toBe(true);
});

it("routes Show Desk through a fixed native recreation route and unregisters on unmount", async () => {
  const { unmount } = render(<DetachedCWSurface />);
  await waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Show Desk" }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("show_cw_desk"));
  unmount(); expect(actions().at(-1)).toBe("unregister"); expect(native.dispose).toHaveBeenCalledOnce();
});
