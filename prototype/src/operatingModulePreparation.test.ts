import { beforeEach, expect, it, vi } from "vitest";
import { prepareOperatingModuleTransition } from "./operatingModulePreparation";

const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));

beforeEach(() => { vi.resetAllMocks(); api.invoke.mockResolvedValue(undefined); });

it("freezes and flushes before acknowledging, then resumes only a cancelled request", async () => {
  const handlers = new Map<string, (event: { payload: { request: string } }) => void>();
  api.listen.mockImplementation(async (name: string, handler: (event: { payload: { request: string } }) => void) => {
    handlers.set(name, handler); return vi.fn();
  });
  const controller = { freeze: vi.fn(), prepare: vi.fn(async () => undefined), resume: vi.fn() };
  const dispose = prepareOperatingModuleTransition(() => controller);
  await Promise.resolve();
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "transition-a" } });
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("operating_module_transition_ack", {
    request: "transition-a", ready: true,
  }));
  expect(controller.freeze).toHaveBeenCalledOnce();
  expect(controller.prepare).toHaveBeenCalledOnce();
  expect(controller.resume).not.toHaveBeenCalled();
  handlers.get("xlog:operating-module-cancel")!({ payload: { request: "transition-a" } });
  expect(controller.resume).toHaveBeenCalledOnce();
  dispose();
});

it("fails closed and resumes when the buffered contest draft cannot be prepared", async () => {
  const handlers = new Map<string, (event: { payload: { request: string } }) => void>();
  api.listen.mockImplementation(async (name: string, handler: (event: { payload: { request: string } }) => void) => {
    handlers.set(name, handler); return vi.fn();
  });
  const controller = { freeze: vi.fn(), prepare: vi.fn(async () => { throw new Error("busy"); }), resume: vi.fn() };
  const dispose = prepareOperatingModuleTransition(() => controller);
  await Promise.resolve();
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "transition-b" } });
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("operating_module_transition_ack", {
    request: "transition-b", ready: false,
  }));
  expect(controller.resume).toHaveBeenCalledOnce();
  dispose();
});

it("rejects preparation when no contest draft controller is mounted", async () => {
  const handlers = new Map<string, (event: { payload: { request: string } }) => void>();
  api.listen.mockImplementation(async (name: string, handler: (event: { payload: { request: string } }) => void) => {
    handlers.set(name, handler); return vi.fn();
  });
  const dispose = prepareOperatingModuleTransition(() => null);
  await Promise.resolve();
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "transition-c" } });
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("operating_module_transition_ack", {
    request: "transition-c", ready: false,
  }));
  dispose();
});
