// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SyncPanel from "./SyncPanel";
const nativeChanges = vi.hoisted(() => ({ wakes: new Set<() => void>() }));
vi.mock("./syncChanges", () => ({ connectSyncChanges: (refresh: () => void) => {
  nativeChanges.wakes.add(refresh); refresh(); return () => { nativeChanges.wakes.delete(refresh); };
} }));
const wakeSync = () => { for (const wake of nativeChanges.wakes) wake(); };

const syncRequest = (implementation: (method: string, params?: Record<string, any>) => Promise<any>) => vi.fn(async (method: string, params?: Record<string, any>) => {
  if (method !== "sync_mutation") return implementation(method, params);
  await implementation(params!.method, params!.params);
  return { operation_id: params!.operation_id, status: "acknowledged", request: { owner: params!.owner, method: params!.method, params: params!.params } };
});
const fixture = () => ({ mutation_owner: { generation: "workspace-1", revision: 0, context: "context-1" }, running: false, status: "Not started", conflicts: [{
  id: "conflict-1", revision: "revision-1", localQSO: { call: "OM0RX" }, remoteQSO: { call: "OM0RX" },
  fields: [{ key: "comment", label: "Comment", local: "local note", remote: "remote note" }, { key: "name", label: "Name", local: "Local name", remote: "Remote name" }],
}], outbox: [{ id: "qso-1", call: "OM0RX", attempt_count: 2, waiting: false, has_error: true }] });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const runFixture = () => ({ run_id: "run-1", trigger: "automatic", outcome: "completed", started_at: "2026-10-27T01:00:00Z",
  finished_at: "2026-10-27T01:01:00Z", upload_tracking: true, upload_attempts: 2, confirmed_creates: 1,
  confirmed_updates: 1, confirmed_deletes: 0, unknown_writes: 0, upload_counts_complete: true,
  report_counts: { acknowledged_contacts: 12, remote_contacts_processed: 120, deletions_reconciled: 0, failures: 0 } });

describe("durable synchronization provenance", () => {
  it("shows measured local changes separately from remote rows and baseline repairs", async () => {
    const run = { ...runFixture(), local_counts_complete: true, report_counts: { ...runFixture().report_counts,
      remote_contacts_processed: 125, local_inserted: 3, local_updated: 120, local_marked_deleted: 2, baseline_repairs: 1 } };
    render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
    await screen.findByText(/Remote reconciliation: 3 local contacts added · 120 local contacts updated · 2 local contacts marked deleted · 1 baseline metadata repairs/);
    expect(screen.getByText(/125 remote records processed/)).toBeTruthy();
  });
  it.each(["running", "interrupted", "failed", "completed"])("keeps missing local totals unknown for a %s receipt", async outcome => {
    const run = { ...runFixture(), outcome, local_counts_complete: false };
    render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
    await screen.findByText("Local change totals are unavailable for this run; they are not assumed to be zero.");
    expect(screen.queryByText(/Remote reconciliation:/)).toBeNull();
  });
  it("distinguishes confirmed writes from acknowledged contacts and checked history", async () => {
    const request = syncRequest(async () => ({ ...fixture(), recent_runs: [runFixture()] }));
    render(<SyncPanel request={request} onChanged={vi.fn()} />);
    await screen.findByText(/Confirmed remote writes: 1 creates · 1 updates · 0 deletes/);
    expect(screen.getByText(/12 local contacts acknowledged · 120 remote records processed/)).toBeTruthy();
    expect(screen.getByText(/Remote records processed are not a count of new local contacts/)).toBeTruthy();
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
  });
  it.each(["failed", "cancelled", "interrupted"])("keeps %s write outcomes unknown", async outcome => {
    const run = { ...runFixture(), outcome, finished_at: null, confirmed_creates: 0, confirmed_updates: 0,
      upload_attempts: 1, unknown_writes: 1, upload_counts_complete: false, report_counts: null };
    render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
    await screen.findByText(/1 write attempts have an unknown outcome/);
    expect(screen.getByText(/Finished: Not confirmed/)).toBeTruthy();
    if (outcome === "interrupted") expect(screen.getByText(/Interrupted · completion unknown/)).toBeTruthy();
  });
  it.each(["running", "interrupted"].flatMap(outcome => [0, 2].map(confirmed => ({ outcome, confirmed }))))(
    "marks $outcome totals incomplete with $confirmed confirmed writes and no pending attempts", async ({ outcome, confirmed }) => {
      const run = { ...runFixture(), outcome, finished_at: null, upload_attempts: confirmed,
        confirmed_creates: confirmed, confirmed_updates: 0, unknown_writes: 0, upload_counts_complete: false };
      render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
      await screen.findByText("Upload totals are incomplete. Counts show confirmed writes so far.");
      expect(screen.getByText(`Confirmed remote writes: ${confirmed} creates · 0 updates · 0 deletes.`)).toBeTruthy();
      expect(screen.queryByText(/write attempts have an unknown outcome/)).toBeNull();
    });
  it("shows a completed zero-write run without an incomplete-count warning", async () => {
    const run = { ...runFixture(), upload_attempts: 0, confirmed_creates: 0, confirmed_updates: 0 };
    render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
    await screen.findByText("Confirmed remote writes: 0 creates · 0 updates · 0 deletes.");
    expect(screen.queryByText("Upload totals are incomplete. Counts show confirmed writes so far.")).toBeNull();
  });
  it("does not invent zero uploads for older activity or an untracked run", async () => {
    const request = syncRequest(async () => ({ ...fixture(), recent_runs: [] }));
    const view = render(<SyncPanel request={request} onChanged={vi.fn()} />);
    await screen.findByText("No durable run receipts yet. Earlier upload counts are unknown.");
    view.unmount();
    const run = { ...runFixture(), upload_tracking: false, upload_attempts: null, confirmed_creates: null,
      confirmed_updates: null, confirmed_deletes: null, unknown_writes: null, upload_counts_complete: false };
    render(<SyncPanel request={syncRequest(async () => ({ ...fixture(), recent_runs: [run] }))} onChanged={vi.fn()} />);
    await screen.findByText("Upload counts unavailable for this run.");
    expect(screen.queryByText(/Confirmed remote writes:/)).toBeNull();
  });
});

describe("Wavelog conflict merge", () => {
  it("keeps local mode passive and disables remote setup and synchronization", async () => {
    const request = syncRequest(async () => ({ ...fixture(), mode: "local", sync_available: false }));
    render(<SyncPanel request={request} onChanged={vi.fn()} />);
    await screen.findByText(/Integrated-only mode keeps your contacts/);
    for (const name of ["Check setup", "Synchronize now", "Enable automatic sync"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
  });
  it("explains missing credentials without retrieving a token or starting sync", async () => {
    const request = syncRequest(async (method: string, _params?: Record<string, any>) => {
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
    const request = syncRequest(async (method: string, _params?: Record<string, any>) => {
      if (method === "settings_load") return { settings: { wavelogURL: "https://example.invalid", wavelogStationID: 1 } };
      if (method === "secret_status") return { "wavelog-token": true };
      return fixture();
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync off");
    fireEvent.click(screen.getByRole("button", { name: "Check setup" }));
    await screen.findByText(/Server authentication is not yet verified/);
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });

  it("loads read-only and saves selected fields without starting sync", async () => {
    const request = syncRequest(async (method: string, _params?: Record<string, any>) => method === "sync_status" ? fixture() : { resolved: true });
    const changed = vi.fn(); render(<SyncPanel request={request} onChanged={changed} />);
    await screen.findByLabelText("Comment remote");
    expect(request.mock.calls.every(([method]) => method === "sync_status")).toBe(true);
    expect((screen.getByLabelText("Name local") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Comment remote"));
    fireEvent.click(screen.getByRole("button", { name: "Save merged contact" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("sync_mutation", expect.objectContaining({ method: "sync_resolve", owner: fixture().mutation_owner, params: { id: "conflict-1", remote_fields: ["comment"], expected_revision: "revision-1" } }));
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
    expect(screen.getByText("OM0RX merged locally and queued for the next manual sync.")).toBeTruthy();
  });

  it("supports all remote and all local without mutating until save", async () => {
    const request = syncRequest(async (_method: string, _params?: Record<string, any>) => fixture());
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
    const request = syncRequest(async (_method: string, _params?: Record<string, any>) => fixture());
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByLabelText("Name local");
    expect(screen.getByRole("button", { name: "Synchronize now" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Synchronize now" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_mutation", expect.objectContaining({ method: "sync_run", params: { confirm_single_writer: true } })));
  });

  it("requires a new review when a native wake changes the contact revision", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state = fixture();
    const request = syncRequest(async (_method: string, _params?: Record<string, any>) => state);
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByLabelText("Comment remote");
    fireEvent.click(screen.getByLabelText("Comment remote"));
    state = { ...fixture(), conflicts: [{ ...fixture().conflicts[0], revision: "revision-2" }] };
    await act(async () => { wakeSync(); });
    expect(screen.getByRole("alert").textContent).toContain("changed while you were choosing");
    expect(screen.getByRole("button", { name: "Save merged contact" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review updated values" }));
    expect((screen.getByLabelText("Comment local") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save merged contact" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows failed outbox and requeues locally without sync", async () => {
    const request = syncRequest(async (_method: string, _params?: Record<string, any>) => fixture());
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Failed");
    fireEvent.click(screen.getByRole("button", { name: "Requeue" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_mutation", expect.objectContaining({ method: "sync_retry", params: { id: "qso-1" } })));
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });
});

describe("persistent automatic synchronization controls", () => {
  it("reports held ambiguous history separately from failures while automatic sync stays enabled", async () => {
    const request = syncRequest(async () => ({ ...fixture(), conflicts: [], outbox: [], automatic_sync: true,
      interval_minutes: 1, status: "Completed; ambiguous remote contacts held for review", held: 2,
      held_groups: [{ identity: "K8DLD|1782488895|17m|FT8|18101575", remote_ids: [174610, 174611],
        differing_fields: ["QRZCOM_QSO_DOWNLOAD_DATE", "QRZCOM_QSO_DOWNLOAD_STATUS"],
        value_shapes: ["QRZCOM_QSO_DOWNLOAD_DATE: empty and populated"] }],
      finished_at: "2026-10-13T12:00:00Z", pushed: 1, pulled: 12, deleted: 0, failed: 0 }));
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync on");
    expect(screen.getByText(/2 Wavelog records held for review/).parentElement?.textContent).toContain("other contacts continue to synchronize");
    expect(screen.getByText(/K8DLD · 17m · FT8/).textContent).toContain("2 Wavelog IDs");
    fireEvent.click(screen.getByText(/K8DLD · 17m · FT8/));
    expect(screen.getByText("174610, 174611")).toBeTruthy();
    expect(screen.getByText("QRZCOM_QSO_DOWNLOAD_DATE: empty and populated")).toBeTruthy();
    expect(screen.getByText(/1 local contacts acknowledged · 12 remote records checked/)).toBeTruthy();
  });

  it("removes the started notice after a native wake reports failure", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state: Record<string, any> = { ...fixture(), automatic_sync: true, running: false };
    const request = syncRequest(async (method: string) => {
      if (method === "sync_run") state = { ...state, running: true, status: "Synchronizing" };
      return state;
    });
    render(<SyncPanel request={request} onChanged={() => {}} />);
    await screen.findByText("Automatic sync on");
    fireEvent.click(screen.getByRole("button", { name: "Synchronize now" }));
    await screen.findByText("Synchronization started. Progress appears below.");
    state = { ...state, running: false, status: "Failed · Wavelog rejected a request.", finished_at: "2026-10-13T12:00:00Z" };
    await act(async () => { wakeSync(); });
    expect(screen.queryByText("Synchronization started. Progress appears below.")).toBeNull();
    expect(screen.getByText("Failed · Wavelog rejected a request.")).toBeTruthy();
  });

  it("requires consent and saves an explicit interval without running sync from the view", async () => {
    let state = { ...fixture(), automatic_sync: false, interval_minutes: 5 };
    const request = syncRequest(async (method: string, params?: Record<string, any>) => {
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
    expect(request).toHaveBeenCalledWith("sync_mutation", expect.objectContaining({ method: "sync_configure", params: { enabled: true, interval_minutes: 10, confirm_single_writer: true } }));
    fireEvent.change(screen.getByLabelText("Sync interval in minutes"), { target: { value: "2" } });
    expect(request.mock.calls.filter(([method]) => method === "sync_mutation")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save interval" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("sync_mutation", expect.objectContaining({ method: "sync_configure", params: { enabled: true, interval_minutes: 2, confirm_single_writer: true } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await screen.findByText("Automatic sync off");
    expect(request.mock.calls.some(([method]) => method === "sync_run")).toBe(false);
  });

  it("does not claim enabled when saving fails", async () => {
    const request = syncRequest(async (method: string) => {
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
    const request = syncRequest(async (_method: string) => state), changed = vi.fn();
    render(<SyncPanel request={request} onChanged={changed} />);
    await screen.findByText("Automatic sync on");
    expect(screen.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
    state = { ...state, running: false, status: "Completed", finished_at: "2026-10-13T07:00:00Z", next_attempt: "2026-10-13T07:10:00Z", pulled: 67909, pushed: 0, deleted: 0, failed: 0 };
    await act(async () => { wakeSync(); });
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByText(/67,909 remote records checked/)).toBeTruthy();
    await act(async () => { wakeSync(); });
    expect(changed).toHaveBeenCalledOnce();
    expect(request.mock.calls.every(args => args.length === 1 && args[0] === "sync_status")).toBe(true);
  });
});

it("two Sync views share native refresh wakes and never create renderer timers", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const first = vi.fn(async (_method: string) => fixture()), second = vi.fn(async (_method: string) => fixture());
  const view = render(<><SyncPanel request={first} onChanged={vi.fn()} /><SyncPanel request={second} onChanged={vi.fn()} /></>);
  await waitFor(() => { expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1); });
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  await act(async () => { wakeSync(); });
  expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
  expect(first.mock.calls.every(args => args.length === 1 && args[0] === "sync_status")).toBe(true);
  view.unmount(); expect(nativeChanges.wakes.size).toBe(0);
});

it("coalesces native wakes and does not apply an older in-flight response", async () => {
  let finish!: (value: Record<string, any>) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done; }))
    .mockResolvedValue({ ...fixture(), status: "Latest native refresh" });
  render(<SyncPanel request={request} onChanged={vi.fn()} />);
  await act(async () => { for (let i = 0; i < 20; i++) wakeSync(); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => { finish({ ...fixture(), status: "Obsolete response" }); });
  expect(request).toHaveBeenCalledTimes(2); expect(screen.getByText("Latest native refresh")).toBeTruthy();
  expect(screen.queryByText("Obsolete response")).toBeNull();
});

it("disables mutations while an invalidated native observation is being reloaded", async () => {
  let finish!: (value: Record<string, any>) => void;
  const request = vi.fn().mockResolvedValueOnce(fixture()).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  render(<SyncPanel request={request} onChanged={vi.fn()} />);
  await screen.findByText("Automatic sync off"); fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Synchronize now" }).hasAttribute("disabled")).toBe(false);
  await act(async () => { wakeSync(); });
  expect(screen.getByRole("button", { name: "Synchronize now" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Save merged contact" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Synchronize now" })); expect(request).toHaveBeenCalledTimes(2);
  await act(async () => { finish(fixture()); });
  expect(screen.getByRole("button", { name: "Synchronize now" }).hasAttribute("disabled")).toBe(false);
});

it("drops a late response when the view changes request sources and refreshes only the new source", async () => {
  let finish!: (value: Record<string, any>) => void;
  const first = vi.fn(() => new Promise<Record<string, any>>(done => { finish = done; }));
  const second = vi.fn(async () => ({ ...fixture(), status: "New request source" }));
  const view = render(<SyncPanel request={first} onChanged={vi.fn()} />);
  view.rerender(<SyncPanel request={second} onChanged={vi.fn()} />);
  await act(async () => { finish({ ...fixture(), status: "Old request source" }); });
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  expect(screen.getByText("New request source")).toBeTruthy(); expect(screen.queryByText("Old request source")).toBeNull();
});

it("offers explicit read-only recovery after a failed observation without a timer or mutation", async () => {
  const request = vi.fn().mockRejectedValueOnce(Error("Observation unavailable")).mockResolvedValue(fixture());
  render(<SyncPanel request={request} onChanged={vi.fn()} />);
  await screen.findByText("Observation unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Refresh Sync state" }));
  await screen.findByText("Automatic sync off");
  expect(request.mock.calls.map(([method]) => method)).toEqual(["sync_status", "sync_status"]);
  expect(screen.queryByText("Observation unavailable")).toBeNull();
});
