// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedAlertsSurface } from "./DetachedAlertsSurface";
import type { DxAlertEntry } from "./dxAlerts";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const wakes: Record<string, () => void> = {};
const frame = () => ({ epoch: "00000000-0000-4000-8000-000000000001", revision: 1, radio_report: true, rotor_report: true,
  items: [{ code: "radio_inhibitors", count: 2 }, { code: "rotor_uncertain", count: 1 }] });
const dxFrame = () => ({ epoch: "00000000-0000-4000-8000-000000000002", revision: 1,
  configuration: { generation:"00000000-0000-4000-8000-000000000003", revision:0, enabled:false, dedupSeconds:120, retentionMinutes:120, nativePopup:false, notificationSound:false,
    rules:[{ id:"new-dxcc", name:"New DXCC", enabled:true, callsignGlob:"*", commentContains:"", bands:[], modes:[], callStatuses:[], dxccStatuses:["ATNO"], specials:[] }] },
  storageError:null, source:{ available:true, baselined:true, revision:2, receivedAtMs:1 }, entries:[], delivery:{ error:null, suppressed:0, maximumPerWindow:3, windowSeconds:10 }, limits:{ maximumRules:32, maximumEntries:200 } });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  for (const key of Object.keys(wakes)) delete wakes[key];
  native.listen.mockImplementation(async (name, callback) => { wakes[name] = callback; return native.stop; });
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : command === "dx_alerts_snapshot" || command === "dx_alerts_save" ? dxFrame() : undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("mounts with one retained native read and no timer, worker, hardware or acknowledgement", async () => {
  const { unmount } = render(<DetachedAlertsSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(native.invoke.mock.calls).toEqual(expect.arrayContaining([["alerts_snapshot"],["dx_alerts_snapshot"]])); expect(native.listen).toHaveBeenCalledWith("xlog:alerts", expect.any(Function));
  expect(screen.getByRole("status").textContent).toContain("not a live all-clear");
  expect(screen.getByText("Radio safety inhibitors reported (2)")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "DX opportunity alerts" })).toBeTruthy();
  expect(screen.getByText(/passive only/)).toBeTruthy(); unmount(); expect(native.stop).toHaveBeenCalledTimes(2);
});
it("never turns absent reports or a failed read into all-clear", async () => {
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? { ...frame(), radio_report:false, rotor_report:false, items:[] } : dxFrame());
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/This is not an all-clear/)).toBeTruthy();
  native.invoke.mockRejectedValue(Error("unavailable"));
  await act(async () => { wakes["xlog:alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toContain("Reports unavailable or changing");
});
it("keeps coverage and report presence with compact retained-data status", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("status").textContent).toBe("Retained data · not a live all-clear");
  expect(screen.getAllByText("Retained report present")).toHaveLength(2);
  expect(screen.getByText("Coverage: Agent safety inhibitors, alarms and rotor uncertainty.")).toBeTruthy();
  expect(native.invoke.mock.calls).toEqual(expect.arrayContaining([["alerts_snapshot"],["dx_alerts_snapshot"]]));
});
it("keeps native delivery opt in and saves popup and sound choices without an action", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const popup = screen.getByLabelText("Native popup") as HTMLInputElement, sound = screen.getByLabelText("Notification sound") as HTMLInputElement;
  expect(popup.checked).toBe(false); expect(sound.disabled).toBe(true);
  fireEvent.click(popup); expect(sound.disabled).toBe(false); fireEvent.click(sound);
  fireEvent.click(screen.getByRole("button", { name:"Save rules" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_save", expect.objectContaining({ configuration:expect.objectContaining({ nativePopup:true, notificationSound:true }) }));
  expect(screen.getByText(/cannot tune or transmit/)).toBeTruthy();
});
it("edits and clones a literal comment condition and saves only native alert settings", async () => {
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.change(screen.getByLabelText("Comment contains"), { target:{ value:"POTA K-1234" } });
  fireEvent.click(screen.getByRole("button", { name:"Clone" }));
  expect(screen.getAllByLabelText("Comment contains").map(input => (input as HTMLInputElement).value)).toEqual(["POTA K-1234", "POTA K-1234"]);
  fireEvent.click(screen.getByRole("button", { name:"Save rules" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_save", expect.objectContaining({ configuration:expect.objectContaining({ rules:expect.arrayContaining([expect.objectContaining({ commentContains:"POTA K-1234" })]) }) }));
  expect(native.invoke.mock.calls.every(([command]) => ["alerts_snapshot", "dx_alerts_snapshot", "dx_alerts_save"].includes(command))).toBe(true);
});
it("explains retained rule evidence and repeat history without a station action", async () => {
  const value = { ...dxFrame(), entries:[{ id:"00000000-0000-4000-8000-000000000004", test:false, callsign:"OM0RX", frequencyKHz:14074, band:"20m", mode:"FT8", comment:"POTA <park>", callStatus:"New Call", dxccStatus:"ATNO", specialTags:["POTA"], ruleNames:["New DXCC", "Portable"], count:3, firstSeenMs:1, lastSeenMs:61_001 }] };
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("columnheader", { name:"Why" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name:"Comment" })).toBeTruthy();
  expect(screen.getAllByText("POTA <park>").map(node => node.tagName)).toEqual(["TD", "P"]);
  expect(screen.getAllByText("New DXCC, Portable")).toHaveLength(2);
  expect(screen.getAllByText("Call: New Call · DXCC: ATNO · Band: 20m · Mode: FT8 · Special: POTA")).toHaveLength(2);
  expect(screen.getAllByText("3 reports")).toHaveLength(2);
  expect(screen.getByLabelText("DX alert history").querySelectorAll("article")).toHaveLength(1);
  expect(screen.queryByRole("button", { name:/tune|transmit|acknowledge/i })).toBeNull();
});
it("keeps legacy rules cluster-only and explicitly saves CQ source rules without station actions", async () => {
  const value = { ...dxFrame(), activitySource:{ available:true, baselined:true, revision:2, receivedAtMs:1 } };
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect((screen.getByLabelText("Source") as HTMLSelectElement).value).toBe("cluster");
  expect(screen.getByText(/WSJT-X CQ feed listening/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Source"), { target:{ value:"wsjtx" } });
  fireEvent.click(screen.getByRole("button", { name:"Save rules" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_save", expect.objectContaining({ configuration:expect.objectContaining({ rules:expect.arrayContaining([expect.objectContaining({ sources:["wsjtx"] })]) }) }));
  expect(native.invoke.mock.calls.every(([command]) => ["alerts_snapshot", "dx_alerts_snapshot", "dx_alerts_save"].includes(command))).toBe(true);
  expect(screen.queryByRole("button", { name:/tune|reply|transmit/i })).toBeNull();
});

const historyEntry = (number: number, callsign: string, frequencyKHz: number, count: number, lastSeenMs: number): DxAlertEntry => ({
  id:`00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, test:false, source:"cluster", callsign, frequencyKHz,
  band:"20m", mode:"CW", comment:"", callStatus:"New Call", dxccStatus:"ATNO", specialTags:[], ruleNames:["New DXCC"], count, firstSeenMs:1, lastSeenMs,
});
function expectHistoryOrder(calls: string[]) {
  expect(screen.getAllByRole("row").slice(1).map(row => row.querySelector(".dx-call")?.textContent)).toEqual(calls);
  expect(Array.from(screen.getByLabelText("DX alert history").querySelectorAll("article header strong")).map(node => node.textContent)).toEqual(calls);
}
it.each([
  ["recent", ["ZL1AA", "OM0RX", "A1AA"]],
  ["callsign", ["A1AA", "OM0RX", "ZL1AA"]],
  ["frequency", ["A1AA", "ZL1AA", "OM0RX"]],
  ["reports", ["OM0RX", "A1AA", "ZL1AA"]],
])("sorts table and compact cards by %s without mutating retained history or invoking actions", async (sort, expected) => {
  const entries = [historyEntry(4,"OM0RX",28020,9,200), historyEntry(5,"ZL1AA",14020,1,300), historyEntry(6,"A1AA",7020,3,100)];
  Object.freeze(entries);
  const value = { ...dxFrame(), entries };
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expectHistoryOrder(["ZL1AA", "OM0RX", "A1AA"]);
  native.invoke.mockClear();
  fireEvent.change(screen.getByLabelText("Sort alerts"), { target:{ value:sort } });
  expectHistoryOrder(expected as string[]);
  expect(entries.map(entry => entry.callsign)).toEqual(["OM0RX", "ZL1AA", "A1AA"]);
  expect(native.invoke).not.toHaveBeenCalled();
});
it("keeps test alerts after real frequencies and orders tied reports by recency then callsign", async () => {
  const entries = [historyEntry(4,"ZL1AA",14020,3,200), historyEntry(5,"OM0RX",14020,3,200), historyEntry(6,"A1AA",7020,3,100),
    { ...historyEntry(7,"TEST",0,1,300), test:true }];
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : { ...dxFrame(), entries });
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.change(screen.getByLabelText("Sort alerts"), { target:{ value:"frequency" } });
  expectHistoryOrder(["A1AA", "OM0RX", "ZL1AA", "TEST"]);
  fireEvent.change(screen.getByLabelText("Sort alerts"), { target:{ value:"reports" } });
  expectHistoryOrder(["OM0RX", "ZL1AA", "A1AA", "TEST"]);
});
it("retains the selected ordering across repeat updates, expiry and empty history without changing a rule draft", async () => {
  let value = { ...dxFrame(), entries:[historyEntry(4,"ZL1AA",14020,4,200), historyEntry(5,"OM0RX",7020,2,100)] };
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.change(screen.getByLabelText("Sort alerts"), { target:{ value:"reports" } });
  fireEvent.change(screen.getByLabelText("Comment contains"), { target:{ value:"POTA" } });
  value = { ...value, revision:2, entries:[value.entries[0], { ...value.entries[1], count:5, lastSeenMs:300 }] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expectHistoryOrder(["OM0RX", "ZL1AA"]);
  value = { ...value, revision:3, entries:[] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/No DX alerts yet/)).toBeTruthy();
  expect((screen.getByLabelText("Sort alerts") as HTMLSelectElement).value).toBe("reports");
  expect((screen.getByLabelText("Comment contains") as HTMLInputElement).value).toBe("POTA");
  expect(native.invoke.mock.calls.every(([command]) => ["alerts_snapshot", "dx_alerts_snapshot"].includes(command))).toBe(true);
});

it("selects by UUID across table/cards, sorting and repeat updates, then clears only selected rows without discarding drafts", async () => {
  const first = historyEntry(4,"OM0RX",14020,2,100), second = historyEntry(5,"OM0RX",7020,1,200), incoming = historyEntry(6,"ZL1AA",28020,1,300);
  let value = { ...dxFrame(), entries:[first, second] };
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "alerts_snapshot") return frame();
    if (command === "dx_alerts_clear_selected") {
      value = { ...value, revision:value.revision + 1, entries:value.entries.filter(entry => !args.ids.includes(entry.id)) };
    }
    return value;
  });
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect((screen.getByRole("button", { name:"Clear selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Comment contains"), { target:{ value:"POTA" } });
  const selection = () => screen.getAllByRole("checkbox", { name:"Select alert OM0RX, 14020.0 kHz, CW" }) as HTMLInputElement[];
  fireEvent.click(selection()[0]);
  expect(selection().map(input => input.checked)).toEqual([true, true]);
  fireEvent.change(screen.getByLabelText("Sort alerts"), { target:{ value:"frequency" } });
  value = { ...value, revision:2, entries:[{ ...first, count:3, lastSeenMs:400 }, second, incoming] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(selection().map(input => input.checked)).toEqual([true, true]);
  native.invoke.mockClear();
  fireEvent.click(screen.getByRole("button", { name:"Clear selected (1)" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("dx_alerts_clear_selected", { expectedEpoch:value.epoch, ids:[first.id] });
  expectHistoryOrder(["OM0RX", "ZL1AA"]);
  expect(screen.queryByRole("checkbox", { name:"Select alert OM0RX, 14020.0 kHz, CW" })).toBeNull();
  expect((screen.getByLabelText("Comment contains") as HTMLInputElement).value).toBe("POTA");
  expect((screen.getByRole("button", { name:"Clear selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
});

it("prunes expired selections, resets selection on owner change and lets compact cards deselect a row", async () => {
  const entry = historyEntry(4,"OM0RX",14020,1,100);
  let value = { ...dxFrame(), entries:[entry] };
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const selection = () => screen.getAllByRole("checkbox", { name:/Select alert OM0RX/ }) as HTMLInputElement[];
  fireEvent.click(selection()[1]); expect(selection().map(input => input.checked)).toEqual([true, true]);
  fireEvent.click(selection()[1]); expect(selection().map(input => input.checked)).toEqual([false, false]);
  fireEvent.click(selection()[0]);
  value = { ...value, revision:2, entries:[] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect((screen.getByRole("button", { name:"Clear selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
  value = { ...value, revision:3, entries:[entry] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(selection().map(input => input.checked)).toEqual([false, false]);
  fireEvent.click(selection()[0]);
  value = { ...value, epoch:"00000000-0000-4000-8000-000000000009", revision:1 };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  expect(selection().map(input => input.checked)).toEqual([false, false]);
  expect(native.invoke.mock.calls.every(([command]) => ["alerts_snapshot", "dx_alerts_snapshot"].includes(command))).toBe(true);
});

it("keeps selection and draft on a rejected clear, while Clear all remains explicit and preserves drafts", async () => {
  const entry = historyEntry(4,"OM0RX",14020,1,100);
  let value = { ...dxFrame(), entries:[entry] };
  native.invoke.mockImplementation(async command => {
    if (command === "alerts_snapshot") return frame();
    if (command === "dx_alerts_clear_selected") throw Error("DX alert owner changed. Review the current alerts before clearing.");
    if (command === "dx_alerts_clear") value = { ...value, revision:2, entries:[] };
    return value;
  });
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.change(screen.getByLabelText("Comment contains"), { target:{ value:"POTA" } });
  fireEvent.click(screen.getAllByRole("checkbox", { name:/Select alert OM0RX/ })[0]);
  fireEvent.click(screen.getByRole("button", { name:"Clear selected (1)" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("alert").textContent).toContain("owner changed");
  expect((screen.getAllByRole("checkbox", { name:/Select alert OM0RX/ })[0] as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name:"Clear all" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke).toHaveBeenCalledWith("dx_alerts_clear");
  expect(screen.getByText(/No DX alerts yet/)).toBeTruthy();
  expect((screen.getByLabelText("Comment contains") as HTMLInputElement).value).toBe("POTA");
});

it.each([false, true])("does not restore rows or selection from a delayed action after a native wake (owner changed: %s)", async changedOwner => {
  const entry = historyEntry(4,"OM0RX",14020,1,100);
  let value = { ...dxFrame(), entries:[entry] };
  let finish: (value: unknown) => void = () => {};
  native.invoke.mockImplementation(async command => command === "alerts_snapshot" ? frame() : command === "dx_alerts_clear_selected" ? new Promise(resolve => { finish = resolve; }) : value);
  render(<DetachedAlertsSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getAllByRole("checkbox", { name:/Select alert OM0RX/ })[0]);
  fireEvent.click(screen.getByRole("button", { name:"Clear selected (1)" }));
  const delayed = { ...value, revision:2 };
  value = { ...value, epoch:changedOwner ? "00000000-0000-4000-8000-000000000009" : value.epoch, revision:3, entries:[] };
  await act(async () => { wakes["xlog:dx-alerts"](); await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { finish(delayed); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/No DX alerts yet/)).toBeTruthy();
  expect((screen.getByRole("button", { name:"Clear selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
});
