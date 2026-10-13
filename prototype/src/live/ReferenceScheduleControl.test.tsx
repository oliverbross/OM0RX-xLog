// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReferenceScheduleControl from "./ReferenceScheduleControl";
import { referenceAutoCheckChanged, referenceAutoCheckKey } from "./referenceSchedule";

beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("native reference preference", () => {
  it("loads the native preference instead of a stale legacy browser setting", async () => {
    localStorage.setItem(referenceAutoCheckKey, "true");
    const request = vi.fn(async () => ({ automatic_check: false }));
    render(<ReferenceScheduleControl visible request={request} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(checkbox.checked).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("reference_status");
  });
  it("migrates only an unset preference without overwriting a native choice", async () => {
    localStorage.setItem(referenceAutoCheckKey, "false");
    const request = vi.fn(async (method: string) => ({ automatic_check: method === "reference_status" ? null : true }));
    render(<ReferenceScheduleControl visible request={request} />);
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
    expect(request).toHaveBeenCalledWith("reference_configure", { enabled: false, only_if_unset: true });
  });
  it("retains the last confirmed value during saving and after failure, without a wake or storage write", async () => {
    localStorage.setItem(referenceAutoCheckKey, "true");
    let rejectSave!: (error: Error) => void;
    const request = vi.fn(async (method: string) => method === "reference_status" ? { automatic_check: true } : new Promise((_resolve, reject) => { rejectSave = reject; }));
    const wake = vi.fn(); window.addEventListener(referenceAutoCheckChanged, wake);
    const view = render(<ReferenceScheduleControl visible request={request} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(true);
    await act(async () => {});
    expect(request).toHaveBeenCalledWith("reference_configure", { enabled: false });
    await act(async () => { rejectSave(new Error("denied")); });
    expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("last confirmed preference");
    expect(localStorage.getItem(referenceAutoCheckKey)).toBe("true"); expect(wake).not.toHaveBeenCalled();
    view.unmount(); window.removeEventListener(referenceAutoCheckChanged, wake);
  });
  it("applies confirmed native saves and emits a wake only on success", async () => {
    const request = vi.fn(async (method: string) => ({ automatic_check: method === "reference_status" }));
    const wake = vi.fn(); window.addEventListener(referenceAutoCheckChanged, wake);
    render(<ReferenceScheduleControl visible request={request} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));
    expect(wake).toHaveBeenCalledOnce();
    expect(localStorage.getItem(referenceAutoCheckKey)).toBeNull();
    window.removeEventListener(referenceAutoCheckChanged, wake);
  });
  it("shows an unavailable preference without guessing and does not migrate after unmount", async () => {
    const failed = vi.fn(async () => { throw new Error("offline"); });
    const view = render(<ReferenceScheduleControl visible request={failed} />);
    await screen.findByRole("alert");
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    view.unmount();
    let resolveStatus!: (value: any) => void;
    const pending = vi.fn(() => new Promise(resolve => { resolveStatus = resolve; }));
    const late = render(<ReferenceScheduleControl visible request={pending} />);
    await act(async () => {});
    late.unmount();
    await act(async () => { resolveStatus({ automatic_check: null }); });
    expect(pending).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight save before reloading after a tab switch", async () => {
    let resolveSave!: (value: any) => void;
    let enabled = false;
    const request = vi.fn(async (method: string) => {
      if (method === "reference_status") return { automatic_check: enabled };
      return new Promise(resolve => { resolveSave = resolve; });
    });
    const view = render(<ReferenceScheduleControl visible request={request} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await act(async () => {});
    view.rerender(<ReferenceScheduleControl visible={false} request={request} />);
    view.rerender(<ReferenceScheduleControl visible request={request} />);
    await act(async () => {});
    expect(request.mock.calls.filter(([method]) => method === "reference_status")).toHaveLength(1);
    await act(async () => { enabled = true; resolveSave({ automatic_check: true }); });
    expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(false);
    expect(request.mock.calls.filter(([method]) => method === "reference_status")).toHaveLength(2);
  });
});
