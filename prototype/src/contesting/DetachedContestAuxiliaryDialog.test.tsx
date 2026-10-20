// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWindowSurface } from "../windowSurface";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
const snapshot = { epoch:"owner", context:"session", revision:1,
  document:{ station:{}, settings:{}, preferences:{}, network:{}, macros:[] },
  auxiliary:{ roverLocation:"JN88", diagnostics:{ engine:"Not1MM Python", plugin:"cq_ww_cw", version:"26.10.11", source:"7c8b499225a7", reference:"cty-test" } } };

describe("DetachedContestAuxiliaryDialog", () => {
  beforeEach(() => { invoke.mockReset(); window.history.replaceState({}, "", "/"); });
  afterEach(() => cleanup());
  it("matches the compact original Rover dialog and submits an uppercased future-contact location", async () => {
    window.history.replaceState({}, "", "?view=contest-setup-rover");
    invoke.mockImplementation(async (command, args:any) => command === "contest_setup_dialog_request" && args.method === "snapshot" ? snapshot :
      command === "contest_setup_dialog_request" && args.method === "submit" ? {requestID:args.params.requestID,status:"saved"} : null);
    const { DetachedContestAuxiliaryDialog } = await import("./DetachedContestAuxiliaryDialog");
    expect(await loadWindowSurface("?view=contest-setup-rover")).toBe(DetachedContestAuxiliaryDialog);
    render(<DetachedContestAuxiliaryDialog/>);
    const input = await screen.findByLabelText("Location") as HTMLInputElement; expect(input.value).toBe("JN88");
    fireEvent.change(input,{target:{value:"fn20"}}); fireEvent.click(screen.getByRole("button",{name:"OK"}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("contest_setup_dialog_request", expect.objectContaining({method:"submit",params:expect.objectContaining({roverLocation:"FN20"})})));
  });
  it("keeps About read-only while showing original donor content and bounded diagnostics", async () => {
    window.history.replaceState({}, "", "?view=contest-setup-about");
    invoke.mockImplementation(async (_command, args:any) => args.method === "snapshot" ? snapshot : null);
    const { DetachedContestAuxiliaryDialog } = await import("./DetachedContestAuxiliaryDialog"); render(<DetachedContestAuxiliaryDialog/>);
    expect(await screen.findByRole("heading",{name:"Not1MM"})).not.toBeNull();
    expect(screen.getByText("Pedro CT2HZA")).not.toBeNull(); expect(screen.getByText("7c8b499225a7")).not.toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
