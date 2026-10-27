import { expect, it, vi } from "vitest";
import { requestContestLaneOutput, setContestCWSpeed, type ContestLaneOutputContext } from "./contestStationControl";

it("uses only the typed native contest speed route", async () => {
  const request = vi.fn(async () => ({accepted:true}));
  await setContestCWSpeed(26, request);
  expect(request).toHaveBeenCalledExactlyOnceWith("contest_cw_speed_request",{params:{words_per_minute:26}});
});

it("rejects invalid speed before invoking the native owner", async () => {
  const request = vi.fn(async () => ({}));
  await expect(setContestCWSpeed(4,request)).rejects.toThrow("5 and 100");
  await expect(setContestCWSpeed(101,request)).rejects.toThrow("5 and 100");
  await expect(setContestCWSpeed(26.5,request)).rejects.toThrow("5 and 100");
  expect(request).not.toHaveBeenCalled();
});

it("propagates a native selected-radio failure without repeating the command", async () => {
  const request = vi.fn(async () => { throw new Error("Connection changed"); });
  await expect(setContestCWSpeed(26,request)).rejects.toThrow("Connection changed");
  expect(request).toHaveBeenCalledTimes(1);
});

const lane: ContestLaneOutputContext = { sessionID: "session", workspaceGeneration: "workspace", laneID: "laneB", draftID: "draft-b", bindingVersion: 3,
  operatingContext: "operating-context", workerGeneration: 4,
  binding: { radioID: "radio2", receiverID: "receiver2", vfo: "B", sliceID: null, generation: "exact-generation" } };
it("passes the exact nonfocus lane route without resolving or falling back to active radio", async () => {
  const request = vi.fn(async () => ({ externalIO: false, simulated: true }));
  await requestContestLaneOutput(lane, "tune", { frequencyHz: 14025000, mode: "CW" }, request);
  expect(request).toHaveBeenCalledExactlyOnceWith("contest_lane_output_request", { params: { ...lane, action: "tune", frequencyHz: 14025000, mode: "CW" } });
});
it("releases the retained native lane target even after the displayed binding changes", async () => {
  const request = vi.fn(async () => ({ receipt: { confirmed: false } }));
  await requestContestLaneOutput({ ...lane, bindingVersion: 4, binding: { ...lane.binding!, generation: "new-generation" } }, "stop", { stopOutcome: "uncertain" }, request);
  expect(request).toHaveBeenCalledExactlyOnceWith("contest_lane_output_request", { params: { action: "stop", sessionID: "session", workspaceGeneration: "workspace", laneID: "laneB", operatingContext: "operating-context", stopOutcome: "uncertain" } });
});
it("never sends an unbound lane and never retries a rejected native route", async () => {
  const request = vi.fn(async () => { throw Error("Exact receiver unavailable"); });
  await expect(requestContestLaneOutput({ ...lane, binding: null }, "send", { text: "CQ" }, request)).rejects.toThrow("Bind this lane");
  expect(request).not.toHaveBeenCalled();
  await expect(requestContestLaneOutput(lane, "listen", {}, request)).rejects.toThrow("Exact receiver unavailable");
  expect(request).toHaveBeenCalledTimes(1);
});
it("allows unbound capability discovery but requires its native worker generation before dispatch", async () => {
  const request = vi.fn(async () => ({ nativeContext: { workerGeneration: 5 } }));
  await requestContestLaneOutput({ ...lane, binding: null, workerGeneration: undefined }, "capabilities", {}, request);
  expect(request).toHaveBeenCalledTimes(1);
  await expect(requestContestLaneOutput({ ...lane, workerGeneration: undefined }, "requestTX", {}, request)).rejects.toThrow("Refresh native lane capabilities");
  expect(request).toHaveBeenCalledTimes(1);
});
