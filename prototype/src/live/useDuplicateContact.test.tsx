// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { duplicateContactMode, useDuplicateContact } from "./useDuplicateContact";

afterEach(cleanup);
const draft = { id: "fixture", call: " w1aw/p ", band: "20M", mode: "MFSK", submode: "FT8" };
const observed = (call = "W1AW/P", band = "20m", mode = "FT8") => ({ call, band, mode, last_worked_at: "2026-10-12T23:55:00Z" });
it("matches the complete call, band and effective contact mode and formats the date in UTC", async () => {
  const request = vi.fn(async () => observed());
  const { result } = renderHook(() => useDuplicateContact(draft, false, request, 0));
  await waitFor(() => expect(result.current).toBe("12/10/26"));
  expect(request).toHaveBeenCalledWith("logbook_duplicate", { call: "W1AW/P", band: "20m", mode: "FT8" });
  expect(duplicateContactMode("USB")).toBe("SSB");
  expect(duplicateContactMode("CW", " ")).toBe("CW");
  expect(duplicateContactMode("MFSK", "FT4")).toBe("FT4");
});
it("removes old evidence immediately and discards replies crossed by callsign, band or mode changes", async () => {
  const replies: Array<(value: unknown) => void> = [];
  const request = vi.fn(() => new Promise(resolve => replies.push(resolve)));
  const { result, rerender } = renderHook(({ value, refresh }) => useDuplicateContact(value, false, request, refresh),
    { initialProps: { value: draft, refresh: 0 } });
  await waitFor(() => expect(replies).toHaveLength(1));
  rerender({ value: { ...draft, call: "W1AW" }, refresh: 0 });
  await act(async () => replies[0](observed()));
  expect(result.current).toBeNull();
  await waitFor(() => expect(replies).toHaveLength(2));
  await act(async () => replies[1](observed("W1AW")));
  expect(result.current).toBe("12/10/26");
  rerender({ value: { ...draft, call: "W1AW", band: "40m" }, refresh: 0 });
  expect(result.current).toBeNull();
  await waitFor(() => expect(replies).toHaveLength(3));
  rerender({ value: { ...draft, call: "W1AW", band: "40m", submode: "FT4" }, refresh: 0 });
  await act(async () => replies[2](observed("W1AW", "40m")));
  expect(result.current).toBeNull();
  await waitFor(() => expect(replies).toHaveLength(4));
  await act(async () => replies[3](observed("W1AW", "40m", "FT4")));
  expect(result.current).toBe("12/10/26");
  rerender({ value: { ...draft, call: "W1AW", band: "40m", submode: "FT4" }, refresh: 1 });
  expect(result.current).toBeNull();
});
it.each([null, "bad-date", "2026-02-31T23:55:00Z", "2026-10-12T23:55:00+00:00", undefined])("never invents a date from invalid or missing history %j", async last_worked_at => {
  const request = vi.fn(async () => ({ ...observed(), last_worked_at }));
  const { result } = renderHook(() => useDuplicateContact(draft, false, request, 0));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(result.current).toBeNull();
});
it("rejects mismatched history and excludes the current logged contact on edit", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const request = vi.fn(async () => observed("OTHER"));
  const { result } = renderHook(() => useDuplicateContact({ ...draft, id }, true, request, 0));
  await waitFor(() => expect(request).toHaveBeenCalledWith("logbook_duplicate", { call: "W1AW/P", band: "20m", mode: "FT8", exclude_id: id }));
  expect(result.current).toBeNull();
});
it("retains no duplicate on request failure and stays inert for incomplete inputs", async () => {
  const request = vi.fn(async () => { throw new Error("history unavailable"); });
  const { result, rerender } = renderHook(({ value }) => useDuplicateContact(value, false, request, 0), { initialProps: { value: { ...draft, call: "" } } });
  expect(request).not.toHaveBeenCalled();
  rerender({ value: draft });
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(result.current).toBeNull();
});
