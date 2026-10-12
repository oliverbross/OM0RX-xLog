// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCW } from "./useCW";
import { defaultCWProfile } from "./cwMacros";
import type { CWRequest } from "./cwController";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shortcuts exclude typing, IME, repeat, modal dialogs and background windows", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const profile = structuredClone(defaultCWProfile); profile.macros[0].shortcut = "F1";
  const request = vi.fn<CWRequest>(async method => method === "station_snapshot" ? {
    source: "direct_agent", generation: 1, allow_transmit: true,
    radio: { connected: true, observed: true, observed_at: Date.now() / 1000, mode: "CW" },
    capabilities: { supported_commands: ["send_cw", "clear_cw"] },
  } : {});
  function Harness({ contextKey = "call-1" }: { contextKey?: string }) {
    const { controller, state } = useCW(request, profile, "direct_agent", { MYCALL: "OM0RX" }, contextKey);
    return <><button onClick={() => void controller.arm()}>Arm</button><output>{state.armed ? "Armed" : "Disarmed"}</output><input aria-label="Call" /></>;
  }
  const { rerender } = render(<Harness />);
  fireEvent.click(screen.getByText("Arm")); await screen.findByText("Armed");
  const sendCount = () => request.mock.calls.filter(([method, params]) => method === "station_radio_control" && params?.control === "send_cw").length;
  fireEvent.keyDown(screen.getByLabelText("Call"), { key: "F1" });
  fireEvent.keyDown(document.body, { key: "F1", repeat: true });
  fireEvent.keyDown(document.body, { key: "F1", isComposing: true });
  const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog);
  fireEvent.keyDown(document.body, { key: "F1" }); dialog.remove();
  expect(sendCount()).toBe(0);
  fireEvent.keyDown(document.body, { key: "F1" }); await waitFor(() => expect(sendCount()).toBe(1));
  await act(async () => { window.dispatchEvent(new Event("blur")); });
  await screen.findByText("Disarmed"); fireEvent.keyDown(document.body, { key: "F1" }); expect(sendCount()).toBe(1);
  expect(request.mock.calls.some(([, params]) => params?.control === "clear_cw")).toBe(true);
  fireEvent.click(screen.getByText("Arm")); await screen.findByText("Armed");
  rerender(<Harness contextKey="call-2" />); await screen.findByText("Disarmed");
  fireEvent.keyDown(document.body, { key: "F1" }); expect(sendCount()).toBe(1);
});
