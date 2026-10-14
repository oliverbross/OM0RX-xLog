// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import QSOEditor from "./QSOEditor";
import { DeskQSO } from "./OperatorDesk";
const draft = { id: "draft", call: "K1ABC", frequencyHz: 14025000, band: "20m", mode: "CW", start: "2026-10-14T00:00:00Z", extraFields: { TEST: "retained" } };
afterEach(cleanup);
it("freezes full-editor buffers and dispatch immediately, before a stale enabled form rerenders", () => {
  let accepts = true;
  const write = vi.fn(), save = vi.fn(), clear = vi.fn(), power = vi.fn(), pending = vi.fn(), follow = vi.fn();
  render(<QSOEditor draft={draft} setDraft={write} save={save} clear={clear} busy={false} lookup={null} previous={[]} follow={false} setFollow={follow}
    onManualPower={power} onLocalInputState={pending} canAcceptLocalInput={() => accepts} />);
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14.." } });
  expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("14.."); expect(pending).toHaveBeenLastCalledWith(true);
  accepts = false;
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.050" } });
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "OTHER" } });
  fireEvent.change(screen.getByLabelText("ADIF TEST"), { target: { value: "lost" } });
  fireEvent.input(screen.getByLabelText("TX power W"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" }));
  fireEvent.keyDown(screen.getByLabelText("Callsign"), { key: "Enter", metaKey: true });
  expect(write).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(power).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("14..");
});
it("clears only the transient pending marker after a valid canonical buffer commit, not after an invalid one", () => {
  const pending = vi.fn(), write = vi.fn();
  const props = { draft, setDraft: write, save: vi.fn(), clear: vi.fn(), busy: false, lookup: null, previous: [], follow: false, setFollow: vi.fn(), onLocalInputState: pending };
  const view = render(<QSOEditor {...props} />);
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14.025" } });
  expect(pending.mock.calls.some(([value]) => value === true)).toBe(true); expect(pending).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "14.." } });
  view.rerender(<QSOEditor {...props} draftLocked />); expect(pending).toHaveBeenLastCalledWith(true);
});
it("preserves Desk buffers and blocks view changes, Clear and queued keyboard Save while synchronously frozen", () => {
  let accepts = true;
  const write = vi.fn(), save = vi.fn(), clear = vi.fn(), full = vi.fn(), pending = vi.fn();
  render(<DeskQSO draft={draft} setDraft={write} save={save} clear={clear} busy={false} lookup={null} previous={[]} request={vi.fn()} refresh={0}
    onEditor={full} onReadRadio={vi.fn()} follow={false} setFollow={vi.fn()} rotor={null} autoRotor={false} setAutoRotor={vi.fn()} onManualRotor={vi.fn()}
    canAcceptLocalInput={() => accepts} onLocalInputState={pending} />);
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "14.." } });
  fireEvent.click(screen.getByRole("button", { name: "Full editor" })); expect(full).not.toHaveBeenCalled();
  expect(screen.getByText(/Finish the buffered frequency/)).toBeTruthy(); expect(pending).toHaveBeenLastCalledWith(true);
  accepts = false;
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "7.050" } });
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "OTHER" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" })); fireEvent.keyDown(screen.getByLabelText("Desk Callsign"), { key: "Enter", metaKey: true });
  expect(write).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14..");
});

it("Desk replaces only acknowledged frequency/UTC buffers on same-ID canonical activation and retains unfinished text", () => {
  const pending = vi.fn(), write = vi.fn();
  const props = { draft, setDraft: write, save: vi.fn(), clear: vi.fn(), busy: false, lookup: null, previous: [], request: vi.fn(), refresh: 0,
    onEditor: vi.fn(), onReadRadio: vi.fn(), follow: false, setFollow: vi.fn(), rotor: null, autoRotor: false, setAutoRotor: vi.fn(), onManualRotor: vi.fn(), onLocalInputState: pending };
  const view = render(<DeskQSO {...props} />);
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "14.026" } });
  fireEvent.change(screen.getByLabelText("Desk UTC time"), { target: { value: "00:01:00" } });
  view.rerender(<DeskQSO {...props} draft={{ ...draft, frequencyHz: 14026000, start: "2026-10-14T00:01:00Z" }} />);
  expect(pending).toHaveBeenLastCalledWith(false);
  const activated = { ...draft, frequencyHz: 14027000, start: "2026-10-14T00:02:00Z" };
  view.rerender(<DeskQSO {...props} draft={activated} draftLocked />);
  view.rerender(<DeskQSO {...props} draft={activated} />);
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14.027000");
  expect((screen.getByLabelText("Desk UTC time") as HTMLInputElement).value).toBe("00:02:00");
  expect(pending).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "14.." } });
  fireEvent.change(screen.getByLabelText("Desk UTC time"), { target: { value: "" } });
  view.rerender(<DeskQSO {...props} draft={{ ...activated, frequencyHz: 14028000, start: "2026-10-14T00:03:00Z" }} />);
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14..");
  expect((screen.getByLabelText("Desk UTC time") as HTMLInputElement).value).toBe("");
  expect(pending).toHaveBeenLastCalledWith(true);
});
