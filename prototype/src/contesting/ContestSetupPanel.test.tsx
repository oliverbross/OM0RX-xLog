// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestSetupPanel, contestSetupTabs, newContestSetup, type ContestSetupDocument, type ContestSetupSession } from "./ContestSetupPanel";

afterEach(cleanup);
function props() {
  return { value: newContestSetup("OM0RX"), sessions: [{ sessionID: "session", name: "October CQ WW", pluginID: "cq_ww_cw", revision: 1, workspaceGeneration: "generation" }],
    activeSessionID: "session", catalog: [{ id: "cq_ww_cw", name: "CQ WW CW" }],
    onSave: vi.fn(async (_value: ContestSetupDocument) => {}), onCreate: vi.fn(async (_value: ContestSetupDocument) => {}), onOpen: vi.fn(async (_session: ContestSetupSession) => {}), onOpenSettings: vi.fn() };
}

it("exposes the complete setup inventory with keyboard accessible tabs and shared services", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>);
  for (const name of contestSetupTabs) expect(screen.getByRole("tab", { name })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "CAT" }));
  fireEvent.click(screen.getByRole("button", { name: "Open xLog Radio settings" }));
  expect(p.onOpenSettings).toHaveBeenCalledWith("Radio");
  fireEvent.keyDown(screen.getByRole("tab", { name: "CAT" }), { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "CW" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Digital" }));
  fireEvent.click(screen.getByRole("button", { name: "Open xLog Integrations settings" }));
  expect(p.onOpenSettings).toHaveBeenCalledWith("Integrations");
});

it("saves station, contest, network, options, keys and both macro modes as one isolated document", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>);
  fireEvent.change(screen.getByLabelText("Contest name"), { target: { value: "CQ WW 2026" } });
  fireEvent.change(screen.getByLabelText("Power category"), { target: { value: "LOW" } });
  fireEvent.click(screen.getByRole("tab", { name: "Station" }));
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Bratislava" } });
  fireEvent.click(screen.getByRole("tab", { name: "N1MM+" }));
  fireEvent.change(screen.getByLabelText("Destination host"), { target: { value: "192.0.2.10" } });
  fireEvent.click(screen.getByLabelText("Send contact packets"));
  fireEvent.click(screen.getByRole("tab", { name: "Options" }));
  fireEvent.click(screen.getByLabelText("Send corrected callsign"));
  fireEvent.click(screen.getByRole("tab", { name: "Key bindings" }));
  fireEvent.change(screen.getByLabelText("Clear entry key"), { target: { value: "Ctrl+W" } });
  fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
  fireEvent.change(screen.getByLabelText("F1 message"), { target: { value: "CQ {MYCALL}" } });
  fireEvent.change(screen.getByLabelText("Macro operating mode"), { target: { value: "S" } });
  fireEvent.change(screen.getByLabelText("F1 message"), { target: { value: "{MYCALL}" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contest setup" }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0]).toMatchObject({ name: "CQ WW 2026", station: { City: "Bratislava" }, settings: { PowerCategory: "LOW" },
    preferences: { sendCorrectedCall: false, keyWipe: "Ctrl+W" }, network: { n1mmHost: "192.0.2.10", n1mmContact: true },
    macros: [{ mode: "R", key: "F1", template: "CQ {MYCALL}" }, { mode: "S", key: "F1", template: "{MYCALL}" }] });
  expect(p.value.name).toBe("CQ WW CW"); expect(p.value.macros).toEqual([]);
});

it("opens an existing contest, creates from the draft, and retains edits on rejected saves", async () => {
  const p = props(); p.onSave.mockRejectedValueOnce(new Error("Contest changed in another window"));
  render(<ContestSetupPanel {...p}/>);
  fireEvent.click(screen.getByRole("button", { name: /October CQ WW/ }));
  await waitFor(() => expect(p.onOpen).toHaveBeenCalledWith(p.sessions[0]));
  await screen.findByText("Contest opened.");
  fireEvent.change(screen.getByLabelText("Contest name"), { target: { value: "Retained edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contest setup" }));
  await screen.findByText("Contest changed in another window");
  expect((screen.getByLabelText("Contest name") as HTMLInputElement).value).toBe("Retained edit");
  fireEvent.click(screen.getByRole("button", { name: "Create and open new contest" }));
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Retained edit" })));
});

it("prevents concurrent saves and permits discard after failure", async () => {
  const p = props(); let reject!: (cause: Error) => void;
  p.onSave.mockImplementation(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
  render(<ContestSetupPanel {...p}/>);
  fireEvent.change(screen.getByLabelText("Contest name"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contest setup" }));
  expect(screen.getByLabelText("Contest name").closest("fieldset")?.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error("Save failed")); await screen.findByText("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect((screen.getByLabelText("Contest name") as HTMLInputElement).value).toBe("CQ WW CW");
});
