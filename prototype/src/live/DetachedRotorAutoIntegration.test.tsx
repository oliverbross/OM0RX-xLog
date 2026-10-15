// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedRotorSurface } from "./DetachedRotorSurface";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const rotor = () => ({ owner: "native_dcu1", generation: 7, state: "active", backend_available: true,
  backend: { connected: true, name: "Existing rotor", azimuth: 123.4, observed_at: Date.now() / 1000, status: "Observed" } });
const observation = () => ({ revision: 1, available: true, snapshot: rotor(), received_at_ms: Date.now() });
const automatic = (armed = false, epoch = 2) => ({ armed, epoch, owner: armed ? "native_dcu1" : null,
  generation: armed ? 7 : null, target: null, activation_pending: false, canonical_pending: false, error: "" });

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  native.listen.mockResolvedValue(native.dispose);
  native.invoke.mockImplementation(async (command, params) => {
    if (command === "rotor_telemetry_snapshot") return observation();
    if (command === "auto_rotor_snapshot") return automatic();
    if (command === "auto_rotor_set") {
      expect(params).toEqual({ armed: true, owner: "native_dcu1", generation: 7 });
      return automatic(true, 3);
    }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("arms from the detached Rotor through the real native auto-rotor hook", async () => {
  render(<DetachedRotorSurface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const toggle = screen.getByRole("checkbox", { name: "Auto rotor" });
  expect(toggle).toHaveProperty("disabled", false);
  await act(async () => { fireEvent.click(toggle); });
  expect(native.invoke.mock.calls.filter(([command]) => command === "auto_rotor_set")).toHaveLength(1);
  expect(toggle).toHaveProperty("checked", true);
});
