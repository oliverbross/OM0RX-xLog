// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RotorPanel from "./RotorPanel";
import type { RotorSnapshot } from "./rotorControl";
import { defaultRotorConfiguration, RotorConfigurationSession } from "./rotorConfigurationSession";
import { ManualRotorGotoSession } from "./manualRotorGoto";

const initial: RotorSnapshot = { owner: "native_dcu1", generation: 4, state: "active", backend: { connected: true, name: "Antenna", azimuth: 53 } };
const workspaceGeneration = "12345678-1234-4234-8234-123456789abc";
async function configuredSession() {
  let snapshot = { revision: 0, generation: workspaceGeneration, configuration: defaultRotorConfiguration() };
  const request = vi.fn(async (method: string, params: any = {}) => {
    if (method === "workspace_rotor_configuration_load") return structuredClone(snapshot);
    if (method === "workspace_rotor_configuration_save") {
      const next = { revision: snapshot.revision + (JSON.stringify(snapshot.configuration) === JSON.stringify(params.configuration) ? 0 : 1),
        generation: workspaceGeneration, configuration: structuredClone(params.configuration) };
      snapshot = next;
      return { status: "applied", ...next, receipt: { mutation: { ...structuredClone(params),
        operationID: params.operationID.toUpperCase(), generation: params.generation.toUpperCase() }, snapshot: structuredClone(next) } };
    }
    if (method === "workspace_rotor_configuration_receipt") return { receipt: null };
    throw new Error(`Unexpected configuration method ${method}`);
  });
  const session = new RotorConfigurationSession(request, () => {}, null, () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await session.load();
  return { session, request };
}
afterEach(cleanup);
beforeEach(() => localStorage.clear());
describe("independent rotor panel", () => {
  it("saves startup opt-in and allowed bands without touching hardware", async () => {
    const configuration = await configuredSession(), request = vi.fn();
    render(<RotorPanel snapshot={null} request={request} configurationOnly configurationSession={configuration.session} />);
    fireEvent.click(screen.getByLabelText("40m"));
    fireEvent.click(screen.getByRole("button", { name: "Save rotor configuration" }));
    await screen.findByText("Rotor configuration saved. No connection or motion was started.");
    expect(configuration.session.getSnapshot().base?.configuration).toMatchObject({
      auto_rotor_at_startup: true,
      auto_rotor_bands: expect.not.arrayContaining(["40m"]),
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("exposes live Auto rotor state separately from persisted startup and band policy", async () => {
    const configuration = await configuredSession(), request = vi.fn(), changeAutomatic = vi.fn(async () => {});
    render(<RotorPanel snapshot={initial} request={request} configurationSession={configuration.session}
      automaticRotorAvailable automaticRotorArmed={false} onAutomaticRotorChange={changeAutomatic} />);
    const toggle = screen.getByRole("checkbox", { name: "Auto rotor" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(changeAutomatic).toHaveBeenCalledExactlyOnceWith(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "40m" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rotor configuration" }));
    await screen.findByText("Rotor configuration saved. No connection or motion was started.");
    expect(configuration.session.getSnapshot().base?.configuration.auto_rotor_bands).not.toContain("40m");
    expect(request).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", { name: "Enable Auto Rotor at app start" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: "40m" })).toBeTruthy();
  });
  it("keeps Auto rotor off for an uncertain connection and explains the recovery path", async () => {
    const configuration = await configuredSession(), changeAutomatic = vi.fn(async () => {});
    render(<RotorPanel snapshot={{ ...initial, state: "uncertain", backend_available: false }} request={vi.fn()}
      configurationSession={configuration.session} automaticRotorArmed={false} automaticRotorAvailable={false}
      onAutomaticRotorChange={changeAutomatic} />);
    const toggle = screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText("The rotor connection needs attention. Stop or disconnect it, then reconnect before enabling Auto rotor.")).toBeTruthy();
    fireEvent.click(toggle);
    expect(changeAutomatic).not.toHaveBeenCalled();
  });
  it("shows the native actionable failure when a manual Auto rotor arm is rejected", async () => {
    const configuration = await configuredSession();
    const changeAutomatic = vi.fn(async () => { throw "No fresh rotor bearing is available. Wait for a current bearing or reconnect before enabling Auto rotor."; });
    render(<RotorPanel snapshot={initial} request={vi.fn()} configurationSession={configuration.session}
      automaticRotorArmed={false} automaticRotorAvailable onAutomaticRotorChange={changeAutomatic} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto rotor" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent",
      "No fresh rotor bearing is available. Wait for a current bearing or reconnect before enabling Auto rotor.");
  });
  it("confirms a revision-zero DCU-1 settings save with a native UUID receipt and no hardware call", async () => {
    const configuration = await configuredSession(), request = vi.fn();
    render(<RotorPanel snapshot={null} request={request} configurationOnly configurationSession={configuration.session} />);
    fireEvent.change(screen.getByLabelText("Rotor TCP host"), { target: { value: "Arco.Example.Invalid" } });
    fireEvent.change(screen.getByLabelText("Rotor name"), { target: { value: "ARCO Garden" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rotor configuration" }));
    await screen.findByText("Rotor configuration saved. No connection or motion was started.");
    expect(configuration.session.getSnapshot().base?.revision).toBe(1);
    expect(configuration.session.getSnapshot().pending).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use saved values" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not connect or move on mount; explicit motion carries the owner generation", async () => {
    const configuration = await configuredSession();
    const request = vi.fn(async () => ({ ...initial, backend: { accepted: true, confirmed: false } }));
    const manual = vi.fn();
    render(<RotorPanel snapshot={initial} request={request} onManual={manual} configurationSession={configuration.session} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText("053°")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rotor bearing degrees"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn rotor" }));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith("rotor_goto", { owner: "native_dcu1", generation: 4, bearing: 90, label: "Manual bearing" }));
    expect(manual).toHaveBeenCalledOnce();
    expect(await screen.findByText("Rotor move accepted; watch the observed bearing.")).toBeTruthy();
  });
  it("clears its lost-reply error and message after terminal manual-turn receipt recovery", async () => {
    const configuration = await configuredSession(); let pending: string | null = null;
    const receipt = vi.fn().mockRejectedValueOnce(new Error("panel turn reply lost"));
    const journal = { read: () => pending, write: (value: string | null) => { pending = value; } };
    const rotorSession = new ManualRotorGotoSession({ snapshot: async () => ({ generation: "station", revision: 4, last_receipt: null,
      worker_generation: 9, rotor: { available: true, revision: 12, received_at_ms: Date.now(), snapshot: { ...initial, backend_available: true } } }),
      request: receipt }, journal);
    const request = vi.fn(async (method: string, params: any) => {
      if (method !== "rotor_goto") throw new Error("Unexpected operation");
      return rotorSession.goto(params.owner, params.generation, params.bearing, params.label);
    });
    render(<RotorPanel snapshot={initial} request={request} configurationSession={configuration.session} rotorSession={rotorSession} />);
    fireEvent.change(screen.getByLabelText("Rotor bearing degrees"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn rotor" }));
    expect((await screen.findByRole("alert")).textContent).toContain("panel turn reply lost");
    const operation = pending!;
    receipt.mockResolvedValueOnce({ operation_id: operation, status: "acknowledged", request: { action: "manual_rotor_goto" } });
    fireEvent.click(screen.getByRole("button", { name: "Check rotor receipt" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText(/Rotor move accepted/)).toBeNull();
  });
  it("keeps a newer Stop failure when an older lost Goto receipt resolves", async () => {
    const configuration = await configuredSession(); let pending: string | null = null;
    const receipt = vi.fn().mockRejectedValueOnce(new Error("old Goto reply lost"));
    const journal = { read: () => pending, write: (value: string | null) => { pending = value; } };
    const rotorSession = new ManualRotorGotoSession({ snapshot: async () => ({ generation: "station", revision: 4, last_receipt: null,
      worker_generation: 9, rotor: { available: true, revision: 12, received_at_ms: Date.now(), snapshot: { ...initial, backend_available: true } } }),
      request: receipt }, journal);
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "rotor_goto") return rotorSession.goto(params.owner, params.generation, params.bearing, params.label);
      if (method === "rotor_stop") throw new Error("newer Stop failed");
      throw new Error("Unexpected operation");
    });
    render(<RotorPanel snapshot={initial} request={request} configurationSession={configuration.session} rotorSession={rotorSession} />);
    fireEvent.change(screen.getByLabelText("Rotor bearing degrees"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn rotor" }));
    expect((await screen.findByRole("alert")).textContent).toContain("old Goto reply lost");
    fireEvent.click(screen.getByRole("button", { name: "Stop rotor" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("newer Stop failed"));
    const operation = pending!;
    receipt.mockResolvedValueOnce({ operation_id: operation, status: "acknowledged", request: { action: "manual_rotor_goto" } });
    fireEvent.click(screen.getByRole("button", { name: "Check rotor receipt" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Check rotor receipt" })).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("newer Stop failed");
  });
  it("offers stop and disconnect for an uncertain owned connection", async () => {
    const configuration = await configuredSession();
    const request = vi.fn(async () => ({ ...initial, generation: 5, state: "uncertain" }));
    render(<RotorPanel snapshot={{ ...initial, state: "uncertain", backend: null }} request={request} onManual={vi.fn()} configurationSession={configuration.session} />);
    expect((screen.getByRole("button", { name: "Turn rotor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Disconnect rotor" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Stop rotor" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 4 }));
  });
  it("requires successful retirement before changing rotor owner and never reconnects implicitly", async () => {
    const configuration = await configuredSession();
    const request = vi.fn(async (method: string) => { if (method === "hamlib_models") return { models: [] }; throw new Error("retirement unconfirmed"); });
    render(<RotorPanel snapshot={initial} request={request} onManual={vi.fn()} configurationSession={configuration.session} />);
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    expect(request.mock.calls.some(([method]) => method === "rotor_disconnect")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "retirement unconfirmed");
    expect(request).toHaveBeenCalledWith("rotor_disconnect", { owner: "native_dcu1", generation: 4 });
    expect(screen.getByRole("button", { name: "Local rotor · Hamlib" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Active rotor: DCU-1/)).toBeTruthy();
  });
  it("browses and retains both connection drafts without disconnecting, moving, or disarming auto", async () => {
    const configuration = await configuredSession();
    const request = vi.fn(async (_method: string) => ({ models: [{ id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" }] })), manual = vi.fn();
    render(<RotorPanel snapshot={initial} request={request} onManual={manual} configurationSession={configuration.session} />);
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
    const configuration = await configuredSession();
    const manual = vi.fn(), mutations: string[] = [];
    function Harness() { const [state, setState] = useState<RotorSnapshot>(initial);
      const request = useCallback(async (method: string) => { if (method === "hamlib_models") return { models: [] }; mutations.push(method); const retired: RotorSnapshot = { owner: null, generation: 5, state: "disconnected" }; setState(retired); return { ...retired }; }, []);
      return <RotorPanel snapshot={state} request={request} onManual={manual} configurationSession={configuration.session} />; }
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    await screen.findByText("Rotor selection saved; connect the selected rotor explicitly.");
    expect(configuration.session.getSnapshot().base?.configuration.owner).toBe("hamlib"); expect(manual).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Apply rotor selection" })).toBeNull();
    expect(mutations).toEqual(["rotor_disconnect"]);
  });
  it("rejects an unconfirmed retirement response rather than applying or connecting", async () => {
    const configuration = await configuredSession();
    const request = vi.fn(async (method: string) => method === "hamlib_models" ? { models: [] } : { ...initial, state: "uncertain" });
    render(<RotorPanel snapshot={initial} request={request} onManual={vi.fn()} configurationSession={configuration.session} />);
    fireEvent.click(screen.getByRole("button", { name: "Local rotor · Hamlib" })); fireEvent.click(screen.getByRole("button", { name: "Apply rotor selection" }));
    expect((await screen.findByRole("alert")).textContent).toContain("retirement is unconfirmed");
    expect(configuration.session.getSnapshot().base?.configuration.owner).toBe("native_dcu1"); expect(screen.getByText(/Active rotor: DCU-1/)).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === "rotor_connect")).toBe(false);
  });
});
