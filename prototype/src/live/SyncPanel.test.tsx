// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SyncPanel from "./SyncPanel";

const fixture = () => ({ running: false, status: "Not started", conflicts: [{
  id: "conflict-1", revision: "revision-1", localQSO: { call: "OM0RX" }, remoteQSO: { call: "OM0RX" },
  fields: [{ key: "comment", label: "Comment", local: "local note", remote: "remote note" }, { key: "name", label: "Name", local: "Local name", remote: "Remote name" }],
}], outbox: [{ id: "qso-1", call: "OM0RX", attempt_count: 2, waiting: false, has_error: true }] });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Wavelog conflict merge", () => {
  it("explains missing credentials without retrieving a token or starting sync", async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, any>) => {
      if (method === "settings_load") return { settings: { wavelogURL: "https://example.invalid", wavelogStationID: 1 } };
      if (method === "secret_status") return { "wavelog-token": false };
      return fixture();
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync off");
    fireEvent.click(screen.getByRole("button", { name: "Check setup" }));
    await screen.findByText(/Setup incomplete: Wavelog API v2 token/);
    expect(request.mock.calls.every(([method]) => ["sync_status", "settings_load", "secret_status"].includes(method))).toBe(true);
  });

  it("does not claim authentication merely because a credential is saved", async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, any>) => {
      if (method === "settings_load") return { settings: { wavelogURL: "https://example.invalid", wavelogStationID: 1 } };
      if (method === "secret_status") return { "wavelog-token": true };
      return fixture();
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Check setup" }));
    await screen.findByText(/Server authentication is not yet verified/);
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });

  it("loads read-only and saves selected fields without starting sync", async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, any>) => method === "sync_status" ? fixture() : { resolved: true });
    const changed = vi.fn(); render(<SyncPanel request={request} onChanged={changed} />);
    await screen.findByLabelText("Comment remote");
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
    expect((screen.getByLabelText("Name local") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Comment remote"));
    fireEvent.click(screen.getByRole("button", { name: "Save merged contact" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("sync_resolve", { id: "conflict-1", remote_fields: ["comment"], expected_revision: "revision-1" });
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
    expect(screen.getByText("OM0RX merged locally and queued for the next manual sync.")).toBeTruthy();
  });

  it("supports all remote and all local without mutating until save", async () => {
    const request = vi.fn(async (_method: string, _params?: Record<string, any>) => fixture());
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByLabelText("Name remote");
    fireEvent.click(screen.getByRole("button", { name: "All remote" }));
    expect((screen.getByLabelText("Comment remote") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Name remote") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All local" }));
    expect((screen.getByLabelText("Name local") as HTMLInputElement).checked).toBe(true);
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
  });

  it("requires single-writer confirmation before explicit synchronization", async () => {
    const request = vi.fn(async (_method: string, _params?: Record<string, any>) => fixture());
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByLabelText("Name local");
    expect(screen.getByRole("button", { name: "Synchronize now" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Synchronize now" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_run", { confirm_single_writer: true }));
  });

  it("requires a new review when polling changes the contact revision", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state = fixture();
    const request = vi.fn(async (_method: string, _params?: Record<string, any>) => state);
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByLabelText("Comment remote");
    fireEvent.click(screen.getByLabelText("Comment remote"));
    state = { ...fixture(), conflicts: [{ ...fixture().conflicts[0], revision: "revision-2" }] };
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("alert").textContent).toContain("changed while you were choosing");
    expect(screen.getByRole("button", { name: "Save merged contact" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review updated values" }));
    expect((screen.getByLabelText("Comment local") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save merged contact" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows failed outbox and requeues locally without sync", async () => {
    const request = vi.fn(async (_method: string, _params?: Record<string, any>) => fixture());
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Failed");
    fireEvent.click(screen.getByRole("button", { name: "Requeue" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_retry", { id: "qso-1" }));
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });
});

describe("persistent automatic synchronization controls", () => {
  it("reports held ambiguous history separately from failures while automatic sync stays enabled", async () => {
    const request = vi.fn(async () => ({ ...fixture(), conflicts: [], outbox: [], automatic_sync: true,
      interval_minutes: 1, status: "Completed; ambiguous remote contacts held for review", held: 2,
      finished_at: "2026-10-13T12:00:00Z", pushed: 1, pulled: 12, deleted: 0, failed: 0 }));
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync on");
    expect(screen.getByText(/2 remote contacts held:/).textContent).toContain("other contacts continue to synchronize");
    expect(screen.getByText(/1 uploaded · 12 remote records checked/)).toBeTruthy();
  });

  it("removes the started notice after polling reports failure", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state: Record<string, any> = { ...fixture(), automatic_sync: true, running: false };
    const request = vi.fn(async (method: string) => {
      if (method === "sync_run") state = { ...state, running: true, status: "Synchronizing" };
      return state;
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync on");
    fireEvent.click(screen.getByRole("button", { name: "Synchronize now" }));
    await screen.findByText("Synchronization started. Progress appears below.");
    state = { ...state, running: false, status: "Failed · Wavelog rejected a request.", finished_at: "2026-10-13T12:00:00Z" };
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Synchronization started. Progress appears below.")).toBeNull();
    expect(screen.getByText("Failed · Wavelog rejected a request.")).toBeTruthy();
  });

  it("requires consent and saves an explicit interval without running sync from the view", async () => {
    let state = { ...fixture(), automatic_sync: false, interval_minutes: 5 };
    const request = vi.fn(async (method: string, params?: Record<string, any>) => {
      if (method === "sync_configure") state = { ...state, automatic_sync: params!.enabled, interval_minutes: params!.interval_minutes };
      return state;
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync off");
    const enable = screen.getByRole("button", { name: "Enable automatic sync" });
    expect(enable.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Sync interval in minutes"), { target: { value: "10" } });
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
    fireEvent.click(enable);
    await screen.findByText("Automatic sync on");
    expect(request).toHaveBeenCalledWith("sync_configure", { enabled: true, interval_minutes: 10, confirm_single_writer: true });
    fireEvent.change(screen.getByLabelText("Sync interval in minutes"), { target: { value: "2" } });
    expect(request.mock.calls.filter(([method]) => method === "sync_configure")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save interval" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_configure", { enabled: true, interval_minutes: 2, confirm_single_writer: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await screen.findByText("Automatic sync off");
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });

  it("does not claim enabled when saving fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sync_configure") throw new Error("Consent could not be saved");
      return { ...fixture(), automatic_sync: false, interval_minutes: 5 };
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync off");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Enable automatic sync" }));
    await screen.findByText("Consent could not be saved");
    expect(screen.queryByText("Automatic sync on")).toBeNull();
  });

  it("reads saved consent on mount and refreshes parent once when a run finishes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state: Record<string, any> = { ...fixture(), automatic_sync: true, interval_minutes: 10, running: true };
    const request = vi.fn(async (_method: string) => state), changed = vi.fn();
    render(<SyncPanel request={request} onChanged={changed} />);
    await screen.findByText("Automatic sync on");
    expect(screen.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
    state = { ...state, running: false, status: "Completed", finished_at: "2026-10-13T07:00:00Z", next_attempt: "2026-10-13T07:10:00Z", pulled: 67909, pushed: 0, deleted: 0, failed: 0 };
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByText(/67,909 remote records checked/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(changed).toHaveBeenCalledOnce();
    expect(request.mock.calls.every(args => args.length === 1 && args[0] === "sync_status")).toBe(true);
  });
});
