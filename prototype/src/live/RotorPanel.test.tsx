// @vitest-environment jsdom
import { useCallback, useState } from "react";
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
    const request = vi.fn(async (method: string) => { if (method === "hamlib_models") return { models: [] }; throw new Error("retirement unconfirmed"); });
    render(<RotorPanel snapshot={initial} request={request} onManual={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    expect(request.mock.calls.some(([method]) => method === "rotor_disconnect")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "retirement unconfirmed");
    expect(request).toHaveBeenCalledWith("rotor_disconnect", { owner: "native_dcu1", generation: 4 });
    expect(screen.getByRole("button", { name: "Local rotor · Hamlib" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Active rotor: DCU-1/)).toBeTruthy();
  });
  it("browses and retains both connection drafts without disconnecting, moving, or disarming auto", async () => {
    const request = vi.fn(async (_method: string) => ({ models: [{ id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" }] })), manual = vi.fn();
    render(<RotorPanel snapshot={initial} request={request} onManual={manual} />);
    fireEvent.change(screen.getByLabelText("Rotor TCP host"), { target: { value: "unsaved-rotor.example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    await screen.findByRole("option", { name: "Hamlib Dummy · 1 · Stable" });
    fireEvent.change(screen.getByLabelText("Rotor model"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "DCU-1 · TCP" }));
    expect((screen.getByLabelText("Rotor TCP host") as HTMLInputElement).value).toBe("unsaved-rotor.example.invalid");
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    expect((screen.getByLabelText("Rotor model") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByRole("button", { name: "Reconnect rotor" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.map(([method]) => method)).toEqual(["hamlib_models"]); expect(manual).not.toHaveBeenCalled();
  });
  it("explicitly applies a retired owner without connecting or touching the radio", async () => {
    const manual = vi.fn(), mutations: string[] = [];
    function Harness() { const [state, setState] = useState<RotorSnapshot>(initial);
      const request = useCallback(async (method: string) => { if (method === "hamlib_models") return { models: [] }; mutations.push(method); const retired: RotorSnapshot = { owner: null, generation: 5, state: "disconnected" }; setState(retired); return { ...retired }; }, []);
      return <RotorPanel snapshot={state} request={request} onManual={manual} />; }
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    await screen.findByText("Rotor selection applied; connect the selected rotor explicitly completed.");
    expect(localStorage.getItem("xlog.integration.rotor")).toBe("hamlib"); expect(manual).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Apply rotor selection" })).toBeNull();
    expect(mutations).toEqual(["rotor_disconnect"]);
  });
  it("rejects an unconfirmed retirement response rather than applying or connecting", async () => {
    const request = vi.fn(async (method: string) => method === "hamlib_models" ? { models: [] } : { ...initial, state: "uncertain" });
    render(<RotorPanel snapshot={initial} request={request} onManual={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" })); fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    expect((await screen.findByRole("alert")).textContent).toContain("retirement is unconfirmed");
    expect(localStorage.getItem("xlog.integration.rotor")).toBeNull(); expect(screen.getByText(/Active rotor: DCU-1/)).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === "rotor_connect")).toBe(false);
  });
});
