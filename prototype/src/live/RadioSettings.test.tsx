// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RadioSettings from "./RadioSettings";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("loads both explicit slots and switches active routing without a singleton fallback", async () => {
  native.invoke.mockImplementation(async (_command, { params }) => params.action === "set_active_radio"
    ? { version: 2, active_radio: params.radio_id }
    : { radio_id: params.radio_id, active_radio: "radio1", tx_owner: null, generation: `${params.radio_id}-generation`, revision: 1,
      base_url: "", last_receipt: null, selection: { provider: null, generation: 0, selection_id: null } });
  render(<RadioSettings />); await act(async () => {});
  expect(native.invoke.mock.calls.filter(([, { params }]) => params.action === "snapshot").map(([, { params }]) => params.radio_id).sort()).toEqual(["radio1", "radio2"]);
  expect(screen.getByRole("tab", { name: "Radio 1" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Radio 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Use as active radio" })); await act(async () => {});
  expect(native.invoke).toHaveBeenCalledWith("station_session_request", { params: { action: "set_active_radio", radio_id: "radio2" } });
  expect(screen.getByText("Radio 2 is now active.")).toBeTruthy();
});

it("selects the radio requested by a retained native settings route", async () => {
  native.invoke.mockImplementation(async (_command, { params }) => ({ radio_id: params.radio_id, active_radio: "radio1", tx_owner: null,
    generation: `${params.radio_id}-generation`, revision: 1, base_url: "", last_receipt: null,
    selection: { provider: null, generation: 0, selection_id: null } }));
  const view = render(<RadioSettings requestedRadioId="radio2" requestedRadioRevision={1} />); await act(async () => {});
  expect(screen.getByRole("tab", { name: "Radio 2" }).getAttribute("aria-selected")).toBe("true");
  view.rerender(<RadioSettings requestedRadioId="radio1" requestedRadioRevision={2} />);
  expect(screen.getByRole("tab", { name: "Radio 1" }).getAttribute("aria-selected")).toBe("true");
});
