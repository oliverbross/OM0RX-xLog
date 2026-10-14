// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RemoteBackupPanel from "./RemoteBackupPanel";
const key = "xlog.remote-backup.intent.v1.main";
const owner = { generation: "workspace", revision: 0, token: null };
const initial = () => ({ owner, available: true, prepared: false, registered: false, approved: false, running: false, busy: false });
afterEach(() => { cleanup(); localStorage.clear(); });

it("does not request anything while hidden and production availability never exposes account or start controls", async () => {
  const request = vi.fn(async () => ({ ...initial(), available: false }));
  const view = render(<RemoteBackupPanel request={request} visible={false} />);
  expect(request).not.toHaveBeenCalled();
  view.rerender(<RemoteBackupPanel request={request} visible />);
  await screen.findByText(/Remote backup account setup and execution are unavailable/);
  expect(request).toHaveBeenCalledExactlyOnceWith("remote_backup_request", { action: "snapshot" });
  expect(screen.queryByRole("button", { name: "Start approved backup" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps native account verification, explicit approval and Start separate", async () => {
  let state: Record<string, any> = initial();
  let last: any;
  const request = vi.fn(async (_method, params) => {
    if (params.action === "snapshot") return state;
    if (params.action === "receipt") return { receipt: last };
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(params);
    const { action, operation_id, owner } = params;
    last = { operation_id, status: "acknowledged", request: { action, owner } };
    state = { ...state, owner: { ...state.owner, revision: state.owner.revision + 1, token: "native-review" } };
    if (action === "prepare") Object.assign(state, { prepared: true, account: "dbid:fixture", folder: "id:folder", backup_id: "native-backup", byte_count: 123 });
    if (action === "verify_account") state.registered = true;
    if (action === "approve") state.approved = true;
    if (action === "start") state.running = true;
    return last;
  });
  render(<RemoteBackupPanel request={request} visible />);
  const prepare = await screen.findByRole("button", { name: "Review native Dropbox setup" });
  await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(prepare);
  await screen.findByText("dbid:fixture");
  fireEvent.click(screen.getByRole("button", { name: "Verify native account registration" }));
  await screen.findByText("Native account registration verified; backup not approved.");
  expect((screen.getByRole("button", { name: "Approve one backup" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Approve one backup" }));
  await screen.findByText("Approved; waiting for explicit Start.");
  expect(request.mock.calls.some(([, p]) => p.action === "start")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Start approved backup" }));
  await screen.findByText(/Backup execution is active. This is not verified completion/);
  expect(request.mock.calls.filter(([, p]) => !["snapshot", "receipt"].includes(p.action)).map(([, p]) => p.action))
    .toEqual(["prepare", "verify_account", "approve", "start"]);
  expect(localStorage.getItem(key)).toBeNull();
});

it("recovers a lost acknowledgement after remount using only snapshot and exact receipt reads", async () => {
  const intent = { action: "start", operation_id: "operation", owner };
  localStorage.setItem(key, JSON.stringify(intent));
  const request = vi.fn(async (_method, params) => params.action === "snapshot" ? initial()
    : { receipt: { operation_id: "OPERATION", status: "acknowledged", request: { owner, action: "start" } } });
  render(<RemoteBackupPanel request={request} visible />);
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  expect(request.mock.calls.map(([, params]) => params.action)).toEqual(["snapshot", "receipt"]);
});

it("keeps unknown receipts pending across focus and never replays setup or Start", async () => {
  const intent = { action: "start", operation_id: "operation", owner };
  localStorage.setItem(key, JSON.stringify(intent));
  const request = vi.fn(async (_method, params) => params.action === "snapshot" ? initial() : { receipt: null });
  render(<RemoteBackupPanel request={request} visible />);
  await screen.findByText(/last backup command has an unknown outcome/);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(request.mock.calls.every(([, params]) => ["snapshot", "receipt"].includes(params.action))).toBe(true);
  expect(localStorage.getItem(key)).not.toBeNull();
  expect((screen.getByRole("button", { name: "Review native Dropbox setup" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /dismiss unresolved backup intent/ }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});

it("an account/context refresh revokes a checkbox confirmation and never exposes deletion", async () => {
  let state = { ...initial(), prepared: true, registered: true, account: "dbid:fixture", folder: "id:folder" };
  const request = vi.fn(async () => state);
  render(<RemoteBackupPanel request={request} visible />);
  await screen.findByText("dbid:fixture");
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  state = { ...state, owner: { ...owner, revision: 1 } };
  fireEvent.click(screen.getByRole("button", { name: "Refresh remote backup status" }));
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false));
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  expect(request.mock.calls.every(([, params]: any) => params?.action === "snapshot")).toBe(true);
});
