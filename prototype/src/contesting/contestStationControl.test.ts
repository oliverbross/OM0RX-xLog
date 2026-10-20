import { expect, it, vi } from "vitest";
import { setContestCWSpeed } from "./contestStationControl";

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
