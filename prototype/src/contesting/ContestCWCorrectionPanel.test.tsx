// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestCWCorrectionPanel, type ContestCWCorrectionPanelProps } from "./ContestCWCorrectionPanel";
afterEach(cleanup);
function props(): ContestCWCorrectionPanelProps {
  return { context: { sessionID: "session", workspaceGeneration: "workspace", operatingContext: "operating", workerGeneration: 4,
    laneID: "laneA", draftID: "draft-a", bindingVersion: 1, binding: { radioID: "radio1", receiverID: "receiver1", vfo: "A", sliceID: null, generation: 1 } },
    call: "K1ABC/P", serial: "00105", onSend: vi.fn(async () => ({ accepted: true, confirmed: true })), onStop: vi.fn(async () => ({ confirmed: true })) };
}
it("requires explicit opt-in for full-call corrections and records only exact confirmed native acceptance", async () => {
  const p = props(), view = render(<ContestCWCorrectionPanel {...p}/>);
  expect((screen.getByLabelText("Enable corrected-call assistance") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send current call" }));
  await waitFor(() => expect(screen.getByText("K1ABC/P", { selector: "strong" })).toBeTruthy());
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("accepted by the native provider"));
  view.rerender(<ContestCWCorrectionPanel {...p} call="K1ABD/P"/>);
  expect((screen.getByRole("button", { name: "Send whole corrected call" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Enable corrected-call assistance"));
  fireEvent.click(screen.getByRole("button", { name: "Send whole corrected call" }));
  await waitFor(() => expect(p.onSend).toHaveBeenCalledTimes(2));
  expect(p.onSend).toHaveBeenNthCalledWith(1, "K1ABC/P", expect.any(String));
  expect(p.onSend).toHaveBeenNthCalledWith(2, "K1ABD/P", expect.any(String));
  expect(screen.getByText(/Early send is off/)).toBeTruthy();
});
it("Stop preserves dispatched uncertainty and a late acceptance cannot turn it into sent history", async () => {
  const p = props(); let finish!: (value: { accepted: boolean; confirmed: boolean }) => void;
  p.onSend = vi.fn(() => new Promise<{ accepted: boolean; confirmed: boolean }>(resolve => { finish = resolve; }));
  render(<ContestCWCorrectionPanel {...p}/>);
  fireEvent.click(screen.getByRole("button", { name: "Send current call" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop lane CW" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Stop confirmed"));
  finish({ accepted: true, confirmed: true });
  await waitFor(() => expect((screen.getByRole("button", { name: "Send current call" }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText("No confirmed acceptance")).toBeTruthy();
  expect(p.onSend).toHaveBeenCalledTimes(1);
  expect(p.onStop).toHaveBeenCalledTimes(1);
});
it("worker or draft replacement discards late evidence without dispatching another call", async () => {
  const p = props(); let finish!: (value: { accepted: boolean; confirmed: boolean }) => void;
  p.onSend = vi.fn(() => new Promise<{ accepted: boolean; confirmed: boolean }>(resolve => { finish = resolve; }));
  const view = render(<ContestCWCorrectionPanel {...p}/>);
  fireEvent.click(screen.getByRole("button", { name: "Send current call" }));
  view.rerender(<ContestCWCorrectionPanel {...p} context={{ ...p.context, workerGeneration: 5, draftID: "draft-next" }} call="W1NEXT"/>);
  finish({ accepted: true, confirmed: true });
  await waitFor(() => expect(screen.getByText("No confirmed acceptance")).toBeTruthy());
  expect(screen.getByText("W1NEXT", { selector: "strong" })).toBeTruthy();
  expect(p.onSend).toHaveBeenCalledTimes(1);
});
it("partials and invalid heard text cannot be sent, while Stop remains available", () => {
  const p = props(), view = render(<ContestCWCorrectionPanel {...p} call="W1?AB/P" disabled/>);
  expect((screen.getByRole("button", { name: "Send current call" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Stop lane CW" }) as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<ContestCWCorrectionPanel {...p} call="{#^XML"/>);
  expect((screen.getByRole("button", { name: "Send current call" }) as HTMLButtonElement).disabled).toBe(true);
  expect(p.onSend).not.toHaveBeenCalled();
});
