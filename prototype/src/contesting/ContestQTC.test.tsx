// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestQTC } from "./ContestQTC";
import type { ContestRequest } from "./types";
afterEach(cleanup);
const data = { available: true, eligibility: null, ruleEdition: "DARC 2025-06-17", batches: [{
  id: "batch1", number: 1, count: 2, direction: "receive", counterpart: "K1ABC", timestamp: "2026-08-08 09:00:00", frequencyHz: 14025000, status: "open",
  items: [{ time: "0800", callsign: "DL1ABC", serial: "3", status: "confirmed", repeats: [] },
    { time: "0801", callsign: "DL2ABC", serial: "7", status: "pending", repeats: [] }] }],
  eligibleSources: [], score: { qtcPoints: 1, total: 4 } };
const props = () => ({ scope: { sessionID: "session", workspaceGeneration: "workspace", revision: 6, draftID: "occupied", frequencyHz: 14025000 }, disabled: false,
  request: vi.fn(async () => ({ id: "read", ok: true, result: structuredClone(data) })) as unknown as ContestRequest,
  onMutate: vi.fn(async (_action: string, _values: Record<string, unknown>) => undefined), onEntry: vi.fn(),
  onOutput: vi.fn(async (_intent: unknown) => undefined), onStop: vi.fn(async () => undefined),
  onBookmark: vi.fn(async (_intent: unknown) => undefined), onReview: vi.fn(async (_intent: unknown) => undefined) });
it("keeps acknowledgments explicit and sends intentional repeats through the native owner callback", async () => {
  const options = props(); render(<ContestQTC {...options}/>);
  expect(await screen.findByRole("button", { name: "Acknowledge item 1" })).toHaveProperty("disabled", true);
  expect(options.onMutate).not.toHaveBeenCalled(); expect(options.onOutput).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Repeat serial 1" }));
  await waitFor(() => expect(options.onOutput).toHaveBeenCalledWith({ batchID: "batch1", index: 0, fields: "serial" }));
  expect(options.onMutate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Acknowledge item 2" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "Return to Entry" }));
  await waitFor(() => expect(options.onEntry).toHaveBeenCalledOnce());
});
it("creates received rows from fields without changing or clearing ordinary Entry", async () => {
  const options = props(); render(<><input aria-label="Preserved caller" defaultValue="K9DRAFT"/><ContestQTC {...options}/></>);
  await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByLabelText("QTC counterpart"), { target: { value: "K1ABC" } });
  fireEvent.change(screen.getByLabelText("QTC row 1 time"), { target: { value: "0800" } });
  fireEvent.change(screen.getByLabelText("QTC row 1 callsign"), { target: { value: "DL1ABC" } });
  fireEvent.change(screen.getByLabelText("QTC row 1 serial"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Add receive row" }));
  fireEvent.change(screen.getByLabelText("QTC row 2 time"), { target: { value: "0801" } });
  fireEvent.change(screen.getByLabelText("QTC row 2 callsign"), { target: { value: "DL2ABC" } });
  fireEvent.change(screen.getByLabelText("QTC row 2 serial"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Create pending QTC series" }));
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_create", expect.objectContaining({ counterpart: "K1ABC",
    items: [{ time: "0800", callsign: "DL1ABC", serial: "3" }, { time: "0801", callsign: "DL2ABC", serial: "7" }] })));
  expect(screen.getByLabelText("Preserved caller")).toHaveProperty("value", "K9DRAFT");
  expect(options.onOutput).not.toHaveBeenCalled();
});
it("retains optional bulk paste while requiring an explicit pending-series action", async () => {
  const options = props(); render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByLabelText("Received QTC items"), { target: { value: "0800 DL1ABC 3\n0801 DL2ABC 7" } });
  fireEvent.click(screen.getByText("Optional bulk paste"));
  fireEvent.click(screen.getByRole("button", { name: "Use pasted rows" }));
  expect(screen.getByLabelText("QTC row 2 callsign")).toHaveProperty("value", "DL2ABC");
  expect(options.onMutate).not.toHaveBeenCalled(); expect(options.onOutput).not.toHaveBeenCalled();
});
it("saves incomplete editor rows separately and restores them without confirming or output", async () => {
  const options = props(), mounted = render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByLabelText("QTC row 1 callsign"), { target: { value: "DL2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save unfinished QTC editor" }));
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_workspace", expect.objectContaining({ workspace: expect.objectContaining({
    rows: [{ time: "", callsign: "DL2", serial: "" }] }) })));
  const saved = options.onMutate.mock.calls.find(([action]) => action === "qtc_workspace")![1].workspace;
  mounted.unmount();
  const restored = { ...props(), request: vi.fn(async () => ({ id: "read", ok: true, result: { ...structuredClone(data),
    operating: { schema: 1, workspace: saved, attempts: [], observations: {} } } })) as unknown as ContestRequest };
  render(<ContestQTC {...restored}/>);
  await waitFor(() => expect(screen.getByLabelText("QTC row 1 callsign")).toHaveProperty("value", "DL2"));
  expect(restored.onMutate).not.toHaveBeenCalled(); expect(restored.onOutput).not.toHaveBeenCalled();
});
it("scopes desk keys and keeps output completion separate from acknowledge and next", async () => {
  const options = props(), entryKeys = vi.fn(); render(<div onKeyDown={entryKeys}><ContestQTC {...options}/></div>);
  await screen.findByText(/shared score 4/);
  fireEvent.keyDown(screen.getByLabelText("QTC counterpart"), { key: "Enter" });
  expect(entryKeys).not.toHaveBeenCalled(); expect(options.onMutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Select item 2" }));
  fireEvent.keyDown(screen.getByRole("region", { name: "WAE QTC desk" }), { key: "s", altKey: true });
  await waitFor(() => expect(options.onOutput).toHaveBeenCalledWith({ batchID: "batch1", index: 1, fields: "serial" }));
  expect(options.onMutate.mock.calls.some(([action]) => action === "qtc_confirm")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge and next" }));
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_confirm", { batchID: "batch1", index: 1 }));
});
it("requests Stop even while persistence fails and retains row edits", async () => {
  const options = props(); options.onMutate.mockRejectedValue(new Error("journal unavailable"));
  render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByLabelText("QTC row 1 callsign"), { target: { value: "KEEP" } });
  fireEvent.click(screen.getByRole("button", { name: "Save unfinished QTC editor" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "journal unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Stop QTC output" }));
  await waitFor(() => expect(options.onStop).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("QTC row 1 callsign")).toHaveProperty("value", "KEEP");
});
it("only bookmarks or reviews captured audio on an explicit action and recorder failure does not confirm", async () => {
  const options = props(); options.onBookmark.mockRejectedValue(new Error("No captured audio"));
  render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  expect(options.onBookmark).not.toHaveBeenCalled(); expect(options.onReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Select item 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Bookmark item" }));
  await waitFor(() => expect(options.onBookmark).toHaveBeenCalledWith({ batchID: "batch1", index: 1, event: "item" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "No captured audio");
  expect(options.onMutate.mock.calls.some(([action]) => action === "qtc_confirm")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Review captured QTC audio" }));
  await waitFor(() => expect(options.onReview).toHaveBeenCalledWith({ batchID: "batch1", index: 1 }));
});
it("labels unavailable output honestly and keeps local opportunity observations separate", async () => {
  const options = props(); render(<ContestQTC {...options} onOutput={undefined}/>);
  await screen.findByText(/shared score 4/);
  expect(screen.getByRole("button", { name: "Repeat serial 1" })).toHaveProperty("disabled", true);
  expect(screen.getByText(/Manual operation: no native output callback/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("QTC counterpart"), { target: { value: "K1ABC" } });
  fireEvent.change(screen.getByLabelText("Local QTC opportunity"), { target: { value: "later" } });
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_observe", expect.objectContaining({ counterpart: "K1ABC", status: "later" })));
  expect(options.onOutput).not.toHaveBeenCalled();
});
it("retains pending corrections on close and prevents acknowledgment of uncommitted edits", async () => {
  const options = props(); render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.click(screen.getByRole("button", { name: "Correct pending item 2" }));
  fireEvent.change(screen.getByLabelText("Pending QTC row 2 serial"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Close item editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge item 2" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Save or explicitly discard the retained correction before acknowledging this item.");
  expect(options.onMutate.mock.calls.some(([action]) => action === "qtc_confirm")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save unfinished QTC editor" }));
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_workspace", { workspace: expect.objectContaining({ pendingEdit: {
    batchID: "batch1", index: 1, row: { time: "0801", callsign: "DL2ABC", serial: "9" } } }) }));
  fireEvent.click(screen.getByRole("button", { name: "Continue pending correction" }));
  expect(screen.getByLabelText("Pending QTC row 2 serial")).toHaveProperty("value", "9");
});
it("records deliberate series completion without sending final QSL or inventing output history", async () => {
  const options = props(), complete = structuredClone(data); complete.batches[0].items[1].status = "confirmed";
  render(<ContestQTC {...options} request={vi.fn(async () => ({ id: "read", ok: true, result: complete })) as unknown as ContestRequest}/>);
  const button = await screen.findByRole("button", { name: "Complete acknowledged series 1" });
  fireEvent.click(button);
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_complete", { batchID: "batch1" }));
  expect(options.onOutput).not.toHaveBeenCalled();
});
it("does not let a late output response replace the visible Stop outcome", async () => {
  const options = props(); let release!: () => void;
  options.onOutput.mockImplementation(() => new Promise<undefined>(resolve => { release = () => resolve(undefined); }));
  render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.click(screen.getByRole("button", { name: "Repeat serial 1" }));
  await waitFor(() => expect(options.onOutput).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Stop QTC output" }));
  await screen.findByText(/Stop requested/); release();
  await waitFor(() => expect(screen.getByRole("button", { name: "Repeat serial 1" })).toHaveProperty("disabled", false));
  expect(screen.getByText(/Stop requested/)).toBeTruthy();
  expect(screen.queryByText(/Output attempt recorded/)).toBeNull();
});
it("renders structured owner evidence without promoting it to RF or counterparty success", async () => {
  const options = props(), review = { ...structuredClone(data), operating: { schema: 1, workspace: {}, observations: {}, attempts: [
    { batchID: "batch1", field: "time", operationID: "op", state: "prepared", outcome: {
      outcome: "owner_returned", basis: "RF and counterparty acknowledgement unverified" } }] } };
  render(<ContestQTC {...options} request={vi.fn(async () => ({ id: "read", ok: true, result: review })) as unknown as ContestRequest}/>);
  expect(await screen.findByText(/owner_returned.*RF and counterparty acknowledgement unverified/)).toBeTruthy();
  expect(options.onMutate).not.toHaveBeenCalled(); expect(options.onOutput).not.toHaveBeenCalled();
});
it("does not create a series after its pending editor save outlives the QTC workspace", async () => {
  const options = props(); let release!: () => void;
  options.onMutate.mockImplementation((action) => action === "qtc_workspace"
    ? new Promise<undefined>(resolve => { release = () => resolve(undefined); }) : Promise.resolve(undefined));
  const mounted = render(<ContestQTC {...options}/>); await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByLabelText("QTC counterpart"), { target: { value: "K1ABC" } });
  for (const [field, value] of [["time", "0800"], ["callsign", "DL1ABC"], ["serial", "3"]])
    fireEvent.change(screen.getByLabelText("QTC row 1 " + field), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Create pending QTC series" }));
  await waitFor(() => expect(options.onMutate).toHaveBeenCalledWith("qtc_workspace", expect.any(Object)));
  mounted.unmount(); release(); await Promise.resolve(); await Promise.resolve();
  expect(options.onMutate.mock.calls.some(([action]) => action === "qtc_create")).toBe(false);
});
it("reviews a map counterpart without replacing current QTC edits until deliberately selected", async () => {
  const options = props(), review = { ...structuredClone(data), operating: { schema: 1, workspace: {
    counterpart: "K9OLD", rows: [{ time: "0800", callsign: "KEEP", serial: "" }] }, observations: {}, attempts: [] } };
  render(<ContestQTC {...options} opportunityIntent={{ callsign: "K1ABC", requestID: "marker1" }}
    request={vi.fn(async () => ({ id: "read", ok: true, result: review })) as unknown as ContestRequest}/>);
  await waitFor(() => expect(screen.getByLabelText("QTC counterpart")).toHaveProperty("value", "K9OLD"));
  expect(screen.getByText("Map counterpart K1ABC")).toBeTruthy();
  expect(screen.getByLabelText("QTC row 1 callsign")).toHaveProperty("value", "KEEP");
  expect(options.onMutate).not.toHaveBeenCalled(); expect(options.onOutput).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use QTC counterpart K1ABC" }));
  expect(screen.getByLabelText("QTC counterpart")).toHaveProperty("value", "K1ABC");
  expect(screen.getByLabelText("QTC row 1 callsign")).toHaveProperty("value", "KEEP");
  expect(options.onOutput).not.toHaveBeenCalled();
});
