// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContestOperatingLanes, type ContestOperatingLane, type ContestOperatingLanesProps } from "./ContestOperatingLanes";

afterEach(cleanup);
function lane(id: "laneA" | "laneB", call: string): ContestOperatingLane {
  return { laneID: id, draftID: `draft-${id}`, bindingVersion: id === "laneA" ? 2 : 7,
    binding: { radioID: id === "laneA" ? "radio1" : "radio2", receiverID: `rx-${id}`, vfo: "A", sliceID: `slice-${id}`, generation: id === "laneA" ? 12 : "generation-b", status: "current" },
    fields: [{ id: "callsign", label: "Callsign", value: call, maximumUTF8Bytes: 32 },
      { id: "sent", label: "SNT", value: "599" }, { id: "receive", label: "RCV", value: "579" },
      { id: "other_1", label: "SentNR", value: "037", readOnly: true },
      { id: "other_2", label: "RcvNR", value: id === "laneA" ? "100" : "200" },
      { id: "hidden", label: "Hidden exchange", value: "preserved", visible: false }],
    frequencyHz: id === "laneA" ? 14_025_000 : 7_025_000, receiveFrequencyHz: null,
    mode: "CW", modes: ["CW", "SSB"], run: id === "laneA", reservedSerial: id === "laneA" ? 37 : 38,
    rememberedCQHz: id === "laneA" ? 14_023_000 : 7_023_000, canLog: true, canSend: true, canStop: true,
    dupe: { state: "clear" }, functionKeys: [{ key: "F1", label: "CQ" }],
    keyBindings: [{ context: "*", key: "Ctrl+L", action: "LOG_NOW" },
      { context: "Callsign", key: "Alt+G", action: "TUNE_SPOT" }] };
}
function props(): ContestOperatingLanesProps {
  return { mode: "SO2R", lanes: [lane("laneA", "K1ABC"), lane("laneB", "DL2ABC")], entryLaneID: "laneA",
    listeningLaneID: "laneB", requestedTransmitLaneID: "laneA", observedTransmit: { state: "unknown" }, onAction: vi.fn() };
}
const contextB = { laneID: "laneB", draftID: "draft-laneB", bindingVersion: 7, bindingGeneration: "generation-b" };

it("blocks unsupported split from buffered RX edits and Return CQ before it creates a split", () => {
  const p = props(); p.lanes[1].receiveFrequencyText = "7026000";
  const view = render(<ContestOperatingLanes {...p}/>), b = within(screen.getByRole("region", { name: "Lane B" }));
  expect((b.getByRole("button", { name: "Tune here" }) as HTMLButtonElement).disabled).toBe(true);
  expect((b.getByRole("button", { name: "Return CQ" }) as HTMLButtonElement).disabled).toBe(true);
  expect(b.getByText(/Split programming is unavailable/)).toBeTruthy();
  fireEvent.click(b.getByRole("button", { name: "Tune here" }));
  fireEvent.click(b.getByRole("button", { name: "Return CQ" }));
  expect(p.onAction).not.toHaveBeenCalled();
  p.lanes[1].receiveFrequencyText = "7025000";
  p.lanes[1].keyBindings = [{ context: "*", key: "Alt+Q", action: "RETURN_CQ_FREQUENCY" }];
  view.rerender(<ContestOperatingLanes {...p}/>);
  expect((b.getByRole("button", { name: "Tune here" }) as HTMLButtonElement).disabled).toBe(false);
  expect((b.getByRole("button", { name: "Return CQ" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(b.getByRole("textbox", { name: "Lane B Callsign" }), { key: "q", code: "KeyQ", altKey: true });
  expect(p.onAction).not.toHaveBeenCalled();
});

it("shows independent drafts, serials, route bindings and four separate focus/RX/TX facts", () => {
  render(<ContestOperatingLanes {...props()}/>);
  expect((screen.getByRole("textbox", { name: "Lane A Callsign" }) as HTMLInputElement).value).toBe("K1ABC");
  expect((screen.getByRole("textbox", { name: "Lane B Callsign" }) as HTMLInputElement).value).toBe("DL2ABC");
  expect(screen.getByText("Reserved serial 37", { exact: false })).toBeTruthy();
  expect(screen.getByText("Reserved serial 38", { exact: false })).toBeTruthy();
  expect(screen.getByText(/radio2 · Receiver rx-laneB · VFO A · Slice slice-laneB/)).toBeTruthy();
  expect(screen.getByText(/generation generation-b · binding 7/)).toBeTruthy();
  const facts = screen.getByLabelText("Entry, listening and transmit state");
  expect(within(facts).getByText("Observed TX").nextElementSibling?.textContent).toBe("Unknown");
  expect(within(facts).getByText("Entry focus").nextElementSibling?.textContent).toBe("Lane A");
  expect(within(facts).getByText("Listening route").nextElementSibling?.textContent).toBe("Lane B");
  expect(screen.queryByLabelText("Lane A Hidden exchange")).toBeNull();
});

it("emits focus and edits only for their exact lane without implicit listen, tune or TX", () => {
  const p = props(); render(<ContestOperatingLanes {...p}/>);
  const input = screen.getByRole("textbox", { name: "Lane B Callsign" });
  fireEvent.focus(input); fireEvent.change(input, { target: { value: "DL2NEW" } });
  expect(p.onAction).toHaveBeenNthCalledWith(1, { ...contextB, kind: "focus", fieldID: "callsign" });
  expect(p.onAction).toHaveBeenNthCalledWith(2, { ...contextB, kind: "field-change", fieldID: "callsign", value: "DL2NEW" });
  expect(p.onAction).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("textbox", { name: "Lane A Callsign" }) as HTMLInputElement).value).toBe("K1ABC");
});

it("binds explicit Run, remembered CQ, listen, TX, log and output actions to the source draft", () => {
  const p = props(); render(<ContestOperatingLanes {...p}/>);
  const b = within(screen.getByRole("region", { name: "Lane B" }));
  fireEvent.click(b.getByRole("radio", { name: "Run" }));
  fireEvent.click(b.getByRole("button", { name: "Remember CQ" }));
  fireEvent.click(b.getByRole("button", { name: "Return CQ" }));
  fireEvent.click(b.getByRole("button", { name: "Listen here" }));
  fireEvent.click(b.getByRole("button", { name: "Request TX here" }));
  fireEvent.click(b.getByRole("button", { name: "Log Lane B" }));
  fireEvent.click(b.getByText("Lane B function keys"));
  fireEvent.click(b.getByRole("button", { name: "F1: CQ" }));
  expect((p.onAction as ReturnType<typeof vi.fn>).mock.calls.map(([action]) => action)).toEqual([
    { ...contextB, kind: "run-change", value: true }, ...["remember-cq", "return-cq", "listen", "request-tx", "log"].map(kind => ({ ...contextB, kind })),
    { ...contextB, kind: "function-key", key: "F1" },
  ]);
});

it("uses current finite custom bindings and keeps native Tab and Mac editing free of output", () => {
  const p = props();
  p.lanes[1].keyBindings = [...p.lanes[1].keyBindings!, { context: "*", key: "Meta+A", action: "LOG_NOW" },
    { context: "*", key: "Meta+Left", action: "TUNE_SPOT" }];
  render(<ContestOperatingLanes {...p}/>);
  const input = screen.getByRole("textbox", { name: "Lane B Callsign" });
  fireEvent.keyDown(input, { key: "l", ctrlKey: true });
  expect(p.onAction).toHaveBeenLastCalledWith({ ...contextB, kind: "key-binding", action: "LOG_NOW", fieldID: "callsign" });
  fireEvent.keyDown(input, { key: "g", code: "KeyG", altKey: true });
  expect(p.onAction).toHaveBeenLastCalledWith({ ...contextB, kind: "key-binding", action: "TUNE_SPOT", fieldID: "callsign" });
  (p.onAction as ReturnType<typeof vi.fn>).mockClear();
  expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  for (const key of ["a", "c", "v", "x", "z"]) expect(fireEvent.keyDown(input, { key, metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: "ArrowLeft", metaKey: true })).toBe(true);
  expect(p.onAction).not.toHaveBeenCalled();
});

it("keeps ESM and stop lane scoped, while unavailable/stale routes cannot send or acquire TX", () => {
  const p = props(); p.lanes[1].enterPolicy = "esm";
  p.lanes[1].binding!.status = "stale"; p.lanes[1].canSend = false;
  p.lanes[1].keyBindings = [...p.lanes[1].keyBindings!, { context: "*", key: "Alt+S", action: "SEND_F1" }];
  render(<ContestOperatingLanes {...p}/>);
  const input = screen.getByRole("textbox", { name: "Lane B Callsign" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(p.onAction).toHaveBeenLastCalledWith({ ...contextB, kind: "operator-key", key: "Enter", fieldID: "callsign" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(p.onAction).toHaveBeenLastCalledWith({ ...contextB, kind: "stop" });
  (p.onAction as ReturnType<typeof vi.fn>).mockClear();
  fireEvent.keyDown(input, { key: "F1" });
  fireEvent.keyDown(input, { key: "s", code: "KeyS", altKey: true });
  fireEvent.keyDown(input, { key: "g", code: "KeyG", altKey: true });
  const b = within(screen.getByRole("region", { name: "Lane B" }));
  expect((b.getByRole("button", { name: "Request TX here" }) as HTMLButtonElement).disabled).toBe(true);
  expect((b.getByRole("button", { name: "Listen here" }) as HTMLButtonElement).disabled).toBe(true);
  expect(p.onAction).not.toHaveBeenCalled();
});

it("rejects mirrored drafts and leaves SO1V's incumbent entry to its owner", () => {
  const p = props(); p.lanes[1].draftID = p.lanes[0].draftID;
  const view = render(<ContestOperatingLanes {...p}/>);
  expect(screen.getByRole("alert").textContent).toContain("Two independent lane drafts are unavailable");
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(<ContestOperatingLanes {...p} mode="SO1V"/>);
  expect(view.container.innerHTML).toBe("");
});

it("retains exact numeric generations and fresh identities after a rebind, with no automatic focus or output", () => {
  const p = props(), view = render(<ContestOperatingLanes {...p}/>);
  const updated = { ...p, lanes: [p.lanes[0], { ...p.lanes[1], draftID: "new-draft-b", bindingVersion: 8,
    binding: { ...p.lanes[1].binding!, generation: 83 } }] };
  view.rerender(<ContestOperatingLanes {...updated}/>);
  expect(p.onAction).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("region", { name: "Lane B" })).getByRole("button", { name: "Log Lane B" }));
  expect(p.onAction).toHaveBeenCalledWith({ laneID: "laneB", draftID: "new-draft-b", bindingVersion: 8, bindingGeneration: 83, kind: "log" });
});
