// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestOperatorDialog } from "./ContestOperatorDialog";
import { newContestSetup } from "./ContestSetupPanel";
import { mergeSetupDialog } from "./contestSetupDialogs";
import { loadWindowSurface } from "../windowSurface";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const snapshot = () => ({ epoch: "owner", context: "workspace/session", revision: 4, document: newContestSetup("OM0RX") });

it("is the exact native contest operator route", async () => {
  await expect(loadWindowSurface("?view=contest-setup-operator")).resolves.toBe(ContestOperatorDialog);
});

it("switches only the current operator through the setup mailbox", async () => {
  const source = snapshot();
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementation(async (_command, { method, params }) => {
    if (method === "snapshot") return source;
    if (method === "submit") return new Promise(resolve => { finish = () => resolve({ requestID: params.requestID, status: "saved" }); });
    return null;
  });
  render(<ContestOperatorDialog/>);
  const input = await screen.findByRole("textbox", { name: "Operator callsign" });
  expect((input as HTMLInputElement).value).toBe("OM0RX");
  fireEvent.change(input, { target: { value: "  OM1ABC/P  " } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(native.invoke.mock.calls.some(([, args]) => args.method === "submit")).toBe(true));
  const submitted = native.invoke.mock.calls.find(([, args]) => args.method === "submit")![1].params.document;
  expect(submitted).toEqual({ ...source.document, operator: "OM1ABC/P" });
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({}));
  await waitFor(() => expect(native.invoke.mock.calls.some(([, args]) => args.method === "close")).toBe(true));
});

it("merges no setup field except operator", () => {
  const current = newContestSetup("OM0RX"), requested = structuredClone(current);
  requested.operator = "OM1ABC/P"; requested.station.City = "Darwin"; requested.preferences.cwSpeed = 30;
  expect(mergeSetupDialog(current, requested, "operator")).toEqual({ ...current, operator: "OM1ABC/P" });
});
