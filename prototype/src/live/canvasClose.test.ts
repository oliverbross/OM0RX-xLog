import { beforeEach, expect, it, vi } from "vitest";
import { prepareCanvasClose } from "./canvasClose";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
beforeEach(() => { vi.resetAllMocks(); api.invoke.mockResolvedValue(undefined); });
it("correlates each preflight with the live editor veto without closing or flushing", async () => {
  let handler!: (event: { payload: { request: string } }) => void, blocked = true;
  const stop = vi.fn(), explain = vi.fn();
  api.listen.mockImplementation(async (_event, callback) => { handler = callback; return stop; });
  const dispose = prepareCanvasClose(() => blocked, explain, vi.fn()); await Promise.resolve();
  handler({ payload: { request: "first" } });
  expect(api.invoke).toHaveBeenLastCalledWith("workspace_canvas_close_ack", { request: "first", ready: false });
  expect(explain).toHaveBeenCalledOnce();
  blocked = false; handler({ payload: { request: "second" } });
  expect(api.invoke).toHaveBeenLastCalledWith("workspace_canvas_close_ack", { request: "second", ready: true });
  dispose(); handler({ payload: { request: "third" } });
  expect(api.invoke).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledOnce();
});
it("fails closed when local-buffer state cannot be inspected", async () => {
  let handler!: (event: { payload: { request: string } }) => void;
  api.listen.mockImplementation(async (_event, callback) => { handler = callback; return vi.fn(); });
  const dispose = prepareCanvasClose(() => { throw new Error("unavailable"); }, vi.fn(), vi.fn());
  handler({ payload: { request: "request" } });
  expect(api.invoke).toHaveBeenCalledWith("workspace_canvas_close_ack", { request: "request", ready: false }); dispose();
});
