// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DirectFlexPanel, { validFlexEndpoint } from "./DirectFlexPanel";
const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("./stationSelection", () => ({ nativeStationSelection: () => native.enabled }));
beforeEach(() => { native.enabled = false; native.invoke.mockClear(); sessionStorage.clear(); });

const snapshot = (overrides: Record<string, any> = {}) => ({ source: "direct_flex_lan", available: true,
  transport_state: "ready", allow_transmit: false,
  radio: { observed: true, connected: true, frequency_hz: 14_074_000, mode: "USB",
    receive_vfo: "A", transmit_vfo: "A", transmitting: false, split: false,
    vfos: [{ letter: "A", frequency_hz: 14_074_000, mode: "USB", receive: true, transmit: true }] },
  station: null, rotor: null, capabilities: { supported_commands: ["station_tune", "set_frequency_a", "set_mode",
    "set_receive_vfo", "set_split", "ptt", "send_cw", "clear_cw", "set_cw_speed", "tune", "cancel"] }, ...overrides });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("direct FLEX LAN controls", () => {
  it("native Desk mounts through shared setup without raw lifecycle authority or inherited transmit consent", async () => {
    native.enabled = true; native.invoke.mockImplementation(async (_command, { params }) => params.action === "snapshot" ? { generation: "setup", revision: 1, base_url: "", last_receipt: null,
      flex: { host: "192.168.1.50", port: 4992, station_name: "xLog" }, selection: { provider: "direct_flex_lan", generation: 4, selection_id: "selected" } }
      : { operation_id: params.operation_id, status: "acknowledged", request: { action: params.action } });
    const request = vi.fn(); render(<DirectFlexPanel request={request} snapshot={snapshot({ allow_transmit: true })} />);
    await waitFor(() => expect((screen.getByLabelText("Shared FLEX private IP") as HTMLInputElement).value).toBe("192.168.1.50"));
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("station_session_request", { params: { action: "snapshot" } });
    expect(request).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Connect FLEX" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect saved FLEX radio" }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("station_session_request", { params: expect.objectContaining({ action: "reconnect_flex", allow_transmit: false, selection_generation: 4, selection_id: "selected" }) }));
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts only numeric private addresses and exact endpoint fields", () => {
    expect(validFlexEndpoint("192.168.1.50", "4992", "OM0RX-xLog")).toBe(true);
    expect(validFlexEndpoint("100.64.1.2", "4992", "OM0RX-xLog")).toBe(true);
    expect(validFlexEndpoint("::1", "4992", "OM0RX-xLog")).toBe(true);
    expect(validFlexEndpoint("radio.example", "4992", "OM0RX-xLog")).toBe(false);
    expect(validFlexEndpoint("8.8.8.8", "4992", "OM0RX-xLog")).toBe(false);
    expect(validFlexEndpoint("192.168.1.50", "4992.5", "OM0RX-xLog")).toBe(false);
  });
  it("does not show agent, amplifier, tuner or rotor commands", () => {
    render(<DirectFlexPanel request={vi.fn()} snapshot={snapshot()} />);
    expect(screen.getByText("Direct FLEX · LAN")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Operate|Standby|Rotor|KPA|KAT|RIT|XIT/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "PTT on" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Tune carrier" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Transmit opt-in off/)).toBeTruthy();
  });
  it("connects explicitly with the provider contract and no automatic control", async () => {
    const request = vi.fn(async () => snapshot({ available: false, transport_state: "connecting", radio: null }));
    render(<DirectFlexPanel request={request} snapshot={null} />);
    fireEvent.change(screen.getByLabelText("Private radio IP address"), { target: { value: "192.168.1.50" } });
    fireEvent.change(screen.getByLabelText("Station name"), { target: { value: "OM0RX-xLog" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect FLEX" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("station_connect", {
      provider: "direct_flex_lan", host: "192.168.1.50", port: 4992,
      station_name: "OM0RX-xLog", allow_transmit: false,
    }));
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("uses capability-aware frequency, mode and transmit requests", async () => {
    const request = vi.fn(async () => ({ accepted: true, confirmed: true }));
    render(<DirectFlexPanel request={request} snapshot={snapshot({ allow_transmit: true })} />);
    fireEvent.change(screen.getByLabelText("FLEX frequency MHz"), { target: { value: "14.075" } });
    fireEvent.click(screen.getByRole("button", { name: "Set VFO frequency" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("station_radio_control",
      { provider: "direct_flex_lan", control: "set_frequency_a", frequency_hz: 14_075_000 }));
    fireEvent.click(screen.getByRole("button", { name: "PTT on" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("station_radio_control",
      { provider: "direct_flex_lan", control: "ptt", enabled: true }));
    expect(screen.queryByRole("button", { name: "Operate" })).toBeNull();
  });
  it("keeps unadvertised VFO B unavailable", () => {
    render(<DirectFlexPanel request={vi.fn()} snapshot={snapshot()} />);
    fireEvent.change(screen.getByLabelText("FLEX VFO"), { target: { value: "B" } });
    expect(screen.getByRole("button", { name: "Set VFO frequency" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Use VFO for RX" }).hasAttribute("disabled")).toBe(true);
  });
  it("preserves manual frequency and mode through observation polls until explicitly reset", () => {
    const initial = snapshot();
    const next = snapshot({ radio: { ...initial.radio, frequency_hz: 14_076_000, mode: "LSB" } });
    const request = vi.fn(async () => next);
    const view = render(<DirectFlexPanel request={request} snapshot={initial} />);
    const frequency = screen.getByLabelText("FLEX frequency MHz") as HTMLInputElement;
    const mode = screen.getByLabelText("FLEX mode") as HTMLSelectElement;
    fireEvent.change(frequency, { target: { value: "14.075" } });
    fireEvent.change(mode, { target: { value: "CW" } });
    view.rerender(<DirectFlexPanel request={request} snapshot={next} />);
    expect(frequency.value).toBe("14.075");
    expect(mode.value).toBe("CW");
    fireEvent.click(screen.getByRole("button", { name: "Read state" }));
    expect(frequency.value).toBe("14.075");
    expect(mode.value).toBe("CW");
    fireEvent.click(screen.getByRole("button", { name: "Use observed frequency and mode in controls" }));
    expect(frequency.value).toBe("14.076000");
    expect(mode.value).toBe("LSB");
  });
  it("locks transmit opt-in while attached to the radio", () => {
    const view = render(<DirectFlexPanel request={vi.fn()} snapshot={null} />);
    const optIn = screen.getByRole("checkbox", { name: /Enable transmit commands/ }) as HTMLInputElement;
    expect(optIn.disabled).toBe(false);
    view.rerender(<DirectFlexPanel request={vi.fn()} snapshot={snapshot({ allow_transmit: true })} />);
    expect(optIn.disabled).toBe(true);
    expect(optIn.checked).toBe(true);
    expect(screen.getByText(/Disconnect before changing it/)).toBeTruthy();
  });
  it("sets only a supported observed-RX FLEX RF power level using the legacy watts request key", async () => {
    const base = snapshot();
    const radio = { ...base.radio, rf_power_level: 35 };
    const capabilities = { supported_commands: [...base.capabilities.supported_commands, "set_rf_power"] };
    const request = vi.fn(async () => ({ accepted: true, confirmed: true,
      state: snapshot({ radio: { ...radio, rf_power_level: 0 }, capabilities }) }));
    render(<DirectFlexPanel request={request} snapshot={snapshot({ radio, capabilities })} />);
    expect(screen.getByText("35 / 100")).toBeTruthy();
    expect(screen.getByText(/not a measured watt reading/)).toBeTruthy();
    const input = screen.getByRole("spinbutton", { name: "RF power setting (0–100)" }) as HTMLInputElement;
    expect(input.value).toBe("35");
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(false);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Set RF power" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("station_radio_control", {
      provider: "direct_flex_lan", control: "set_rf_power", watts: 0,
    }));
    await waitFor(() => expect(input.value).toBe("0"));
    expect(screen.getByText(/RIT\/XIT, CAT server and SmartLink controls are unavailable/)).toBeTruthy();
    expect(screen.queryByText(/RF power setting is unavailable/)).toBeNull();
  });
  it("preserves a manually edited RF power draft across polls and blocks unsafe or unsupported writes", () => {
    const base = snapshot();
    const caps = { supported_commands: [...base.capabilities.supported_commands, "set_rf_power"] };
    const initial = snapshot({ radio: { ...base.radio, rf_power_level: 35 }, capabilities: caps });
    const request = vi.fn();
    const view = render(<DirectFlexPanel request={request} snapshot={initial} />);
    const input = screen.getByRole("spinbutton", { name: "RF power setting (0–100)" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "50" } });
    view.rerender(<DirectFlexPanel request={request} snapshot={snapshot({ radio: { ...base.radio, rf_power_level: 40 }, capabilities: caps })} />);
    expect(input.value).toBe("50");
    expect(screen.getByText("40 / 100")).toBeTruthy();
    fireEvent.change(input, { target: { value: "101" } });
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "40" } });
    view.rerender(<DirectFlexPanel request={request} snapshot={snapshot({ radio: { ...base.radio, rf_power_level: 40, transmitting: true }, capabilities: caps })} />);
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(true);
    view.rerender(<DirectFlexPanel request={request} snapshot={snapshot({ radio: { ...base.radio, rf_power_level: 40, transmitting: null }, capabilities: caps })} />);
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(true);
    view.rerender(<DirectFlexPanel request={request} snapshot={snapshot({ radio: { ...base.radio, rf_power_level: 40 }, capabilities: base.capabilities })} />);
    expect(screen.getByRole("button", { name: "Set RF power" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/RF power setting is unavailable until FLEX reports its current level/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use observed RF power setting" }));
    expect(input.value).toBe("40");
  });
});
