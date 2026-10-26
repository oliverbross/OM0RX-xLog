// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { prepareOperatingModuleEditor, prepareOperatingModuleTransition } from "./operatingModulePreparation";

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
    request: "transition-b", ready: false, reason: "busy",
  }));
  expect(controller.resume).toHaveBeenCalledOnce();
  dispose();
});

it("recovers preparation sent before listener startup without preparing a request twice", async () => {
  const handlers = new Map<string, (event: { payload: { request: string } }) => void>();
  api.listen.mockImplementation(async (name: string, handler: any) => { handlers.set(name, handler); return vi.fn(); });
  api.invoke.mockImplementation(async (command: string) => command === "operating_module_transition_pending" ? "early" : undefined);
  const controller = { freeze: vi.fn(), prepare: vi.fn(async () => undefined), resume: vi.fn() };
  const dispose = prepareOperatingModuleTransition(() => controller);
  await vi.waitFor(() => expect(controller.prepare).toHaveBeenCalledOnce());
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "early" } });
  expect(controller.prepare).toHaveBeenCalledOnce();
  dispose();
});

it("freezes detached editor input until cancellation and retains an unsaved editor veto", async () => {
  const handlers = new Map<string, (event: { payload: { request: string } }) => void>();
  api.listen.mockImplementation(async (name: string, handler: any) => { handlers.set(name, handler); return vi.fn(); });
  document.body.inert = false;
  let blocked = false;
  const explain = vi.fn(), dispose = prepareOperatingModuleEditor(() => blocked, explain);
  await Promise.resolve();
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "editor" } });
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("operating_module_transition_ack", { request: "editor", ready: true }));
  expect(document.body.inert).toBe(true);
  handlers.get("xlog:operating-module-cancel")!({ payload: { request: "editor" } });
  expect(document.body.inert).toBe(false);
  blocked = true;
  handlers.get("xlog:operating-module-prepare")!({ payload: { request: "unsaved" } });
  await vi.waitFor(() => expect(explain).toHaveBeenCalledOnce());
  expect(document.body.inert).toBe(false);
  expect(api.invoke).toHaveBeenCalledWith("operating_module_transition_ack", expect.objectContaining({ request: "unsaved", ready: false }));
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
