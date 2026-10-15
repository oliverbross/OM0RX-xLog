// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualRotorGotoSession } from "./manualRotorGoto";
import { ManualRotorControl, ManualRotorStatus } from "./ManualRotorControl";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { StationReceipt } from "./stationSession";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T00:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function fixture(owner: "native_dcu1" | "hamlib" = "native_dcu1") {
  let pending: string | null = null;
  const snapshot = { generation: "station", revision: 4, last_receipt: null, worker_generation: owner === "hamlib" ? 0 : 9,
    rotor: { available: true, revision: 12, received_at_ms: Date.now(), snapshot: { owner, generation: 7, state: "active" as const,
      backend_available: true, backend: owner === "hamlib" ? { fields: { position: { Azimuth: "42" } } } : { connected: true, azimuth: 42 } } } };
  const read = vi.fn(async () => structuredClone(snapshot));
  const request = vi.fn(async (params: Record<string, unknown>): Promise<StationReceipt | null> =>
    ({ operation_id: params.operation_id as string, status: "acknowledged", request: { action: "manual_rotor_goto" } }));
  const journal = { read: () => pending, write: (id: string | null) => { pending = id; } };
  const session = new ManualRotorGotoSession({ snapshot: read, request }, journal);
  return { session, snapshot, read, request, journal, get pending() { return pending; } };
}

it("journals before one exact owner-fenced native Goto and clears only its acknowledgement", async () => {
  const f = fixture(); f.request.mockImplementation(async params => {
    expect(f.pending).toBe(params.operation_id);
    expect(params).toMatchObject({ action: "manual_rotor_goto", generation: "station", revision: 4, rotor_owner: "native_dcu1",
      rotor_generation: 7, rotor_revision: 12, worker_generation: 9, bearing: 92.5, label: "K1ABC" });
    return { operation_id: params.operation_id as string, status: "acknowledged", request: { action: "manual_rotor_goto" } };
  });
  await expect(f.session.goto("native_dcu1", 7, 92.5, "K1ABC")).resolves.toMatchObject({ acknowledged: true });
  expect(f.pending).toBeNull(); expect(f.request).toHaveBeenCalledOnce();
});

it("keeps Hamlib independent of the integration worker generation", async () => {
  const f = fixture("hamlib");
  await f.session.goto("hamlib", 7, 180);
  expect(f.request.mock.calls[0][0]).toMatchObject({ rotor_owner: "hamlib", worker_generation: 0 });
});

it("lost replies survive remount and receipt recovery never repeats motion", async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(new Error("lost reply"));
  await expect(f.session.goto("native_dcu1", 7, 90)).rejects.toThrow("lost reply");
  const operation = f.pending!; const restored = new ManualRotorGotoSession({ snapshot: f.read, request: f.request }, f.journal);
  await expect(restored.goto("native_dcu1", 7, 90)).rejects.toThrow(/existing manual rotor/);
  f.request.mockResolvedValue({ operation_id: operation, status: "acknowledged", request: { action: "manual_rotor_goto" } });
  await restored.check();
  expect(f.request.mock.calls[1]).toEqual([{ action: "receipt", operation_id: operation }]); expect(f.pending).toBeNull();
});

it("rejects stale ownership, stale observation and invalid bearing before dispatch", async () => {
  const f = fixture(); await expect(f.session.goto("native_dcu1", 8, 90)).rejects.toThrow(/Refresh/);
  f.snapshot.rotor.received_at_ms -= 5001; await expect(f.session.goto("native_dcu1", 7, 90)).rejects.toThrow(/Refresh/);
  await expect(f.session.goto("native_dcu1", 7, 361)).rejects.toThrow(/bearing/); expect(f.request).not.toHaveBeenCalled();
});

it("unknown and mismatched receipts remain reviewable without replay", async () => {
  const f = fixture(); f.request.mockImplementation(async params => ({ operation_id: params.operation_id as string, status: "unknown", request: { action: "manual_rotor_goto" } }));
  await expect(f.session.goto("native_dcu1", 7, 90)).rejects.toThrow(/unknown/); const operation = f.pending!;
  f.request.mockResolvedValue({ operation_id: "wrong", status: "acknowledged", request: { action: "manual_rotor_goto" } });
  await expect(f.session.check()).rejects.toThrow(/does not match/); expect(f.pending).toBe(operation); expect(f.request).toHaveBeenCalledTimes(2);
});

it("clears the renderer journal only after exact native durable review", async () => {
  const f = fixture(); f.request.mockImplementation(async params => params.action === "review"
    ? ({ operation_id: params.operation_id as string, status: "reviewed", request: { action: "manual_rotor_goto" } })
    : ({ operation_id: params.operation_id as string, status: "unknown", request: { action: "manual_rotor_goto" } }));
  await expect(f.session.goto("native_dcu1", 7, 90)).rejects.toThrow(/unknown/); const operation = f.pending!;
  await f.session.review();
  expect(f.request.mock.calls[1][0]).toEqual({ action: "review", operation_id: operation, reviewed_action: "manual_rotor_goto" });
  expect(f.pending).toBeNull();
});

it("recovers a lost native review acknowledgement without replay", async () => {
  const f=fixture();f.request.mockImplementation(async params=>({operation_id:params.operation_id as string,status:"unknown",request:{action:"manual_rotor_goto"}}));
  await expect(f.session.goto("native_dcu1",7,90)).rejects.toThrow(/unknown/);const operation=f.pending!;
  f.request.mockRejectedValueOnce(new Error("review reply lost"));await expect(f.session.review()).rejects.toThrow("review reply lost");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"reviewed",request:{action:"manual_rotor_goto"}});
  await f.session.check();expect(f.pending).toBeNull();expect(f.request.mock.calls.at(-1)?.[0]).toEqual({action:"receipt",operation_id:operation});
});

it("Station Control exposes one explicit Goto through the shared owner", async () => {
  const f = fixture(), context = syntheticMonitorContext();
  context.rotor.revision = 12; context.rotor.snapshot!.generation = 7;
  render(<ManualRotorControl context={context} session={f.session} />);
  fireEvent.change(screen.getByLabelText("Manual rotor bearing degrees"), { target: { value: "135" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn rotor" })); });
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.request.mock.calls[0][0]).toMatchObject({ action: "manual_rotor_goto", rotor_owner: "native_dcu1",
    rotor_generation: 7, rotor_revision: 12, worker_generation: 9, bearing: 135 });
  expect(screen.getByRole("status").textContent).toMatch(/acknowledged/);
});

it("Desk status recovers a lost acknowledgement without repeating motion", async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(new Error("lost reply"));
  await expect(f.session.goto("native_dcu1", 7, 90)).rejects.toThrow("lost reply");
  const operation = f.pending!;
  render(<ManualRotorStatus session={f.session} />);
  f.request.mockResolvedValue({ operation_id: operation, status: "acknowledged", request: { action: "manual_rotor_goto" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check rotor receipt" })); });
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[1][0]).toEqual({ action: "receipt", operation_id: operation });
  expect(screen.queryByRole("button", { name: "Check rotor receipt" })).toBeNull();
});

it("clears the initiating rotor control lost-reply error after terminal Check recovery", async () => {
  const f = fixture(), context = syntheticMonitorContext();
  context.rotor.revision = 12; context.rotor.snapshot!.generation = 7;
  f.request.mockRejectedValueOnce(new Error("turn reply lost"));
  render(<ManualRotorControl context={context} session={f.session} />);
  fireEvent.change(screen.getByLabelText("Manual rotor bearing degrees"), { target: { value: "135" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn rotor" })); });
  expect(screen.getByRole("alert").textContent).toContain("turn reply lost");
  const operation = f.pending!;
  f.request.mockResolvedValueOnce({ operation_id: operation, status: "acknowledged", request: { action: "manual_rotor_goto" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check rotor receipt" })); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("clears the initiating rotor control unknown-outcome error after exact durable review", async () => {
  const f = fixture(), context = syntheticMonitorContext();
  context.rotor.revision = 12; context.rotor.snapshot!.generation = 7;
  f.request.mockImplementationOnce(async params => ({ operation_id: params.operation_id as string, status: "unknown", request: { action: "manual_rotor_goto" } }));
  render(<ManualRotorControl context={context} session={f.session} />);
  fireEvent.change(screen.getByLabelText("Manual rotor bearing degrees"), { target: { value: "135" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn rotor" })); });
  expect(screen.getByRole("alert").textContent).toContain("outcome is unknown");
  const operation = f.pending!;
  f.request.mockResolvedValueOnce({ operation_id: operation, status: "reviewed", request: { action: "manual_rotor_goto" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Acknowledge unknown turn" })); });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears stale check and review errors after later verified recovery", async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(new Error("lost reply"));
  await expect(f.session.goto("native_dcu1",7,90)).rejects.toThrow("lost reply"); const operation=f.pending!;
  render(<ManualRotorStatus session={f.session} />);
  f.request.mockRejectedValueOnce(new Error("receipt unavailable"));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check rotor receipt"}));});
  expect(screen.getByRole("alert").textContent).toContain("receipt unavailable");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"unknown",request:{action:"manual_rotor_goto"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check rotor receipt"}));});
  expect(screen.queryByRole("alert")).toBeNull();
  f.request.mockRejectedValueOnce(new Error("review unavailable"));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Acknowledge unknown turn"}));});
  expect(screen.getByRole("alert").textContent).toContain("review unavailable");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"reviewed",request:{action:"manual_rotor_goto"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Acknowledge unknown turn"}));});
  expect(screen.queryByRole("alert")).toBeNull(); expect(f.pending).toBeNull();
});
