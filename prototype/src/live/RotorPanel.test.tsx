// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RotorPanel from "./RotorPanel";
import type { RotorSnapshot } from "./rotorControl";

const initial: RotorSnapshot = { owner: "native_dcu1", generation: 4, state: "active", backend: { connected: true, name: "Antenna", azimuth: 53 } };
afterEach(cleanup);
beforeEach(() => localStorage.clear());
describe("independent rotor panel", () => {
  it("does not connect or move on mount; explicit motion carries the owner generation", async () => {
    const request = vi.fn(async () => ({ ...initial, backend: { accepted: true, confirmed: false } }));
    const manual = vi.fn();
    render(<RotorPanel snapshot={initial} request={request} onManual={manual} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText("053°")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rotor bearing degrees"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn rotor" }));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith("rotor_goto", { owner: "native_dcu1", generation: 4, bearing: 90, label: "Manual bearing" }));
    expect(manual).toHaveBeenCalledOnce();
    expect(await screen.findByText("Rotor move accepted; watch the observed bearing.")).toBeTruthy();
  });
  it("offers stop and disconnect for an uncertain owned connection", async () => {
    const request = vi.fn(async () => ({ ...initial, generation: 5, state: "uncertain" }));
    render(<RotorPanel snapshot={{ ...initial, state: "uncertain", backend: null }} request={request} onManual={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Turn rotor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Disconnect rotor" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Stop rotor" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 4 }));
  });
  it("requires successful retirement before changing rotor owner and never reconnects implicitly", async () => {
    const request = vi.fn(async () => { throw new Error("retirement unconfirmed"); });
    render(<RotorPanel snapshot={initial} request={request} onManual={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "retirement unconfirmed");
    expect(request).toHaveBeenCalledExactlyOnceWith("rotor_disconnect", { owner: "native_dcu1", generation: 4 });
    expect(screen.getByRole("button", { name: "DCU-1 · TCP" }).getAttribute("aria-pressed")).toBe("true");
  });
});
