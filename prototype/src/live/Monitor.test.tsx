// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Monitor from "./Monitor";

afterEach(cleanup);
it("TCI observations cannot expose radio authority even when supplied transmit capabilities", () => {
  const request = vi.fn();
  render(<Monitor snapshot={{ source: "direct_tci", allow_transmit: true, radio: { connected: true, observed: true, frequency_hz: 14074000 }, station: { allowed_actions: ["operate", "tune", "cancel"] }, capabilities: { supported_commands: ["tune", "cancel"] } }} map={null} onRequest={request} />);
  expect(screen.getByText("STATION · DIRECT TCI · READ ONLY")).toBeTruthy();
  expect(screen.getByText("Receive: 14.074000")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(/KPA500|KAT500|TX POWER|SWR/)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("TCI receive readback does not require fabricated A/B VFO roles and prefers the configured receive value", () => {
  render(<Monitor snapshot={{ source: "direct_tci", radio: { connected: true, observed: true, frequency_hz: 7100000, receive_frequency_hz: 14025000, receive_vfo: null, transmit_vfo: null, vfos: [] } }} map={null} />);
  expect(screen.getByText("Receive: 14.025000")).toBeTruthy();
  expect(screen.queryByText(/^A:|^B:/)).toBeNull();
});
const flex = (overrides: Record<string, any> = {}) => ({ source: "direct_flex_lan", generated_at: Date.now() / 1000,
  allow_transmit: true, station: null, rotor: null,
  radio: { observed: true, connected: true, frequency_hz: 14_074_000, mode: "USB", receive_vfo: "A",
    transmit_vfo: "A", transmitting: null, vfos: [{ letter: "A", frequency_hz: 14_074_000 }] },
  capabilities: { supported_commands: ["tune", "cancel"] }, ...overrides });

describe("direct FLEX detached monitor", () => {
  it("does not overwrite a later Stop acknowledgement with a pending turn's late failure", async () => {
    let reject!: (cause: Error) => void;
    const request = vi.fn((method: string) => method === "rotor_goto" ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve({ confirmed: true }));
    const view = render(<Monitor snapshot={flex({ rotor: { owner: "native_dcu1", connected: true, name: "Antenna", azimuth: 53 } })} map={<div>Map</div>} onRotorRequest={request} />);
    fireEvent.change(screen.getByLabelText("Monitor rotor bearing"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("Observed confirmation received");
    reject(new Error("Old turn failed late"));
    await waitFor(() => expect(screen.queryByText("Old turn failed late")).toBeNull());
    expect(screen.getByText("Observed confirmation received")).toBeTruthy();
    view.unmount();
  });
  it("pairs an independent rotor with FLEX and retains stop when its radio is offline", async () => {
    const stop = vi.fn(async () => ({ backend: { accepted: true, confirmed: false } }));
    render(<Monitor snapshot={flex({ radio: null, rotor: { owner: "native_dcu1", connected: true, name: "Antenna", azimuth: 53 } })} map={<div>Map</div>} onRotorRequest={stop} />);
    expect(screen.getByText("053°")).toBeTruthy();
    expect(screen.getByText("OFFLINE")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith("rotor_stop", {}));
  });
  it("shows radio-only observation without fabricated station or rotor telemetry", () => {
    render(<Monitor snapshot={flex()} map={<div>Map</div>} />);
    expect(screen.getByText(/DIRECT FLEX LAN/)).toBeTruthy();
    expect(screen.getByText("PTT UNKNOWN")).toBeTruthy();
    expect(screen.queryByText(/KPA500|KAT500|ROTOR|TX POWER|SWR/)).toBeNull();
    expect(screen.getByText(/no amplifier, tuner or rotor telemetry/)).toBeTruthy();
  });
  it("only offers advertised tune and cancel, with transmit opt-in", async () => {
    const onRequest = vi.fn(async () => ({ accepted: true, confirmed: false }));
    render(<Monitor snapshot={flex()} map={<div>Map</div>} onRequest={onRequest} />);
    fireEvent.click(screen.getByRole("button", { name: "Tune" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith("station_action", { action: "tune" }));
    expect(screen.queryByRole("button", { name: /Operate|Standby|Turn/ })).toBeNull();
    cleanup();
    render(<Monitor snapshot={flex({ allow_transmit: false })} map={<div>Map</div>} onRequest={onRequest} />);
    expect(screen.getByRole("button", { name: "Tune" }).hasAttribute("disabled")).toBe(true);
  });
  it("delegates durable Cancel feedback without hiding a newer command failure", async () => {
    const onRequest = vi.fn(async (_method: string, params: Record<string, unknown> = {}) => {
      if (params.action === "cancel") throw new Error("Cancel acknowledgement lost");
      throw new Error("Newer tune failure");
    });
    render(<Monitor snapshot={flex()} map={<div>Map</div>} onRequest={onRequest} externalCancelFeedback />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel tune / release TX" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith("station_action", { action: "cancel" }));
    expect(screen.queryByText("Cancel acknowledgement lost")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tune" }));
    expect(await screen.findByText("Newer tune failure")).toBeTruthy();
  });
  it("delegates durable Tune feedback without retaining a duplicate lost ACK or hiding newer Stop errors", async () => {
    const onRequest=vi.fn(async()=>{throw new Error("Tune acknowledgement lost");});
    const stop=vi.fn(async()=>{throw new Error("Newer Stop failure");});
    render(<Monitor snapshot={flex({rotor:{owner:"native_dcu1",connected:true,azimuth:53}})} map={<div>Map</div>} onRequest={onRequest} onRotorRequest={stop} externalCancelFeedback externalTuneFeedback/>);
    fireEvent.click(screen.getByRole("button",{name:"Tune"}));
    await waitFor(()=>expect(onRequest).toHaveBeenCalledWith("station_action",{action:"tune"}));
    expect(screen.queryByText("Tune acknowledgement lost")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Stop"}));
    expect(await screen.findByText("Newer Stop failure")).toBeTruthy();
    expect(screen.queryByText("Tune acknowledgement lost")).toBeNull();
  });
});
