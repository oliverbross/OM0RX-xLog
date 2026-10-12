// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Monitor from "./Monitor";

afterEach(cleanup);
const flex = (overrides: Record<string, any> = {}) => ({ source: "direct_flex_lan", generated_at: Date.now() / 1000,
  allow_transmit: true, station: null, rotor: null,
  radio: { observed: true, connected: true, frequency_hz: 14_074_000, mode: "USB", receive_vfo: "A",
    transmit_vfo: "A", transmitting: null, vfos: [{ letter: "A", frequency_hz: 14_074_000 }] },
  capabilities: { supported_commands: ["tune", "cancel"] }, ...overrides });

describe("direct FLEX detached monitor", () => {
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
});
