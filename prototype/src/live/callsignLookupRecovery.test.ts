import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { boundedCallsignLookup, transientLookupReadFailure } from "./callsignLookupRecovery";
const busy = () => Object.assign(new Error("Busy"), { code: "worker_busy" });
const profile = { call: "FW3GT", source: "QRZ", name: "Provider" };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("recovers a restored callsign after multiple coded admission failures with bounded backoff", async () => {
  const read = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue(profile);
  const work = boundedCallsignLookup(read, "FW3GT", 46_000, { scope: "generation/draft" });
  await vi.advanceTimersByTimeAsync(1_750);
  await expect(work).resolves.toBe(profile);
  expect(read).toHaveBeenCalledTimes(4);
  expect(read.mock.calls.every(([method]) => method === "lookup_call")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops retrying after its finite admission budget and permits an explicit fresh attempt", async () => {
  const read = vi.fn().mockRejectedValue(busy());
  const work = boundedCallsignLookup(read, "FW3GT");
  const rejected = expect(work).rejects.toMatchObject({ code: "worker_busy" });
  await vi.advanceTimersByTimeAsync(30_000); await rejected;
  expect(read).toHaveBeenCalledTimes(9);
  expect(vi.getTimerCount()).toBe(0);
  read.mockResolvedValue(profile);
  await expect(boundedCallsignLookup(read, "FW3GT")).resolves.toBe(profile);
  expect(read).toHaveBeenCalledTimes(10);
});

it("retries settings_busy but never retries a generic provider failure or permanent code", async () => {
  const read = vi.fn().mockResolvedValueOnce({ call: "FW3GT", lookup_status: "settings_busy", qrz_status: "settings_busy" }).mockResolvedValue(profile);
  const work = boundedCallsignLookup(read, "FW3GT");
  await vi.advanceTimersByTimeAsync(250); await expect(work).resolves.toBe(profile);
  const unavailable = { call: "FW3GT", lookup_status: "unavailable", lookup_warning: "Invalid credentials" };
  const terminal = vi.fn().mockResolvedValue(unavailable);
  await expect(boundedCallsignLookup(terminal, "FW3GT")).resolves.toBe(unavailable);
  expect(terminal).toHaveBeenCalledTimes(1);
  const denied = Object.assign(new Error("Prototype worker is busy; try again"), { code: "credential_required" });
  expect(transientLookupReadFailure(denied)).toBe(false);
  const rejected = vi.fn().mockRejectedValue(denied);
  await expect(boundedCallsignLookup(rejected, "FW3GT")).rejects.toBe(denied);
  expect(rejected).toHaveBeenCalledTimes(1);
  expect(transientLookupReadFailure(new Error("Prototype worker is busy; try again"))).toBe(true);
  expect(transientLookupReadFailure(new Error("Callsign not found"))).toBe(false);
});

it("cancels backoff immediately without admitting more reads", async () => {
  const controller = new AbortController(), read = vi.fn().mockRejectedValue(busy());
  const work = boundedCallsignLookup(read, "FW3GT", 46_000, { signal: controller.signal });
  const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await rejected;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("does not let one cancelled consumer release another consumer's current lookup", async () => {
  let finish!: (value: any) => void;
  const read = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const first = boundedCallsignLookup(read, "FW3GT", 46_000, { scope: "same", signal: controller.signal });
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = boundedCallsignLookup(read, "FW3GT", 46_000, { scope: "same" });
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await cancelled;
  const third = boundedCallsignLookup(read, "FW3GT", 46_000, { scope: "same" });
  await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(1);
  finish(profile); await expect(second).resolves.toBe(profile); await expect(third).resolves.toBe(profile);
});

it("retires a hung lookup at its outer deadline so explicit retry can reach a replacement worker", async () => {
  const read = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(profile);
  const work = boundedCallsignLookup(read, "FW3GT", 100);
  const rejected = expect(work).rejects.toThrow("Callsign lookup timed out");
  await vi.advanceTimersByTimeAsync(100); await rejected;
  await expect(boundedCallsignLookup(read, "FW3GT", 100)).resolves.toBe(profile);
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([undefined, null, "", 0])("never manufactures a successful lookup from a falsy rejection (%s)", async cause => {
  const read = vi.fn().mockRejectedValue(cause);
  await expect(boundedCallsignLookup(read, "FW3GT")).rejects.toBe(cause);
  expect(read).toHaveBeenCalledTimes(1);
});

it("keeps one full provider refresh allowance after the bounded startup admission backoff", async () => {
  const read = vi.fn();
  for (let attempt = 0; attempt < 8; attempt++) read.mockRejectedValueOnce(busy());
  read.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(profile), 40_000)));
  const work = boundedCallsignLookup(read, "FW3GT");
  await vi.advanceTimersByTimeAsync(59_750);
  await expect(work).resolves.toBe(profile);
  expect(read).toHaveBeenCalledTimes(9); expect(vi.getTimerCount()).toBe(0);
});
