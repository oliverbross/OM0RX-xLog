// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DataManagementPanel, { safeReferenceSource } from "./DataManagementPanel";

const manifest = { createdAt: "2026-10-12T10:00:00Z", qsoCount: 42, pendingSyncCount: 3,
  databaseBytes: 1_048_576, includesReferenceData: true };
const listing = { backups: [] };
const reference = { running: false, status: "Current", cty_source: "bundled", state: {} };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("verified external backup workflow", () => {
  it("uses a native picker, imports a verified copy, then requires separate restore confirmation", async () => {
    const pickBackup = vi.fn(async () => "/chosen/Native.xlogbackup");
    const changed = vi.fn();
    const request = vi.fn(async (method: string) => {
      if (method === "backup_list") return listing;
      if (method === "reference_status") return reference;
      if (method === "backup_import" || method === "backup_inspect") return {
        name: "Imported-safe.xlogbackup", manifest, includes_settings: true, includes_preferences: true,
      };
      if (method === "backup_restore") return { qso_count: 42, recovery_backup: "before.xlogbackup" };
      throw new Error(`Unexpected ${method}`);
    });
    render(<DataManagementPanel onRequest={request} onChanged={changed} pickBackup={pickBackup} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import xLog backup…" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("backup_import", { source_path: "/chosen/Native.xlogbackup" }));
    expect(pickBackup).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("backup_inspect", { name: "Imported-safe.xlogbackup" });
    expect(request).not.toHaveBeenCalledWith("backup_restore", expect.anything());
    await screen.findByText(/Verified · 42 QSOs/);
    expect(screen.getByRole("checkbox", { name: /Restore workspace preferences/ }).hasAttribute("checked")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /Restore workspace preferences/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand this replaces/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore integrated copy" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("backup_restore", {
      name: "Imported-safe.xlogbackup", confirm_restore: true,
      restore_settings: true, restore_preferences: true, restore_reference_data: true,
    }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("does not send any import or restore request when file selection is canceled", async () => {
    const request = vi.fn(async (method: string) => method === "backup_list" ? listing : reference);
    render(<DataManagementPanel onRequest={request} onChanged={vi.fn()} pickBackup={vi.fn(async () => null)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import xLog backup…" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("reference_status"));
    expect(request.mock.calls.some(([method]) => method === "backup_import" || method === "backup_restore")).toBe(false);
  });
});

describe("reference dataset evidence", () => {
  it("shows each dataset's recorded source, validator, check date, size and count without claiming currentness", async () => {
    const status = { running: false, status: "Not refreshed in this session", cty_source: "workspace_download", state: {
      clubLogUpdatedAt: "2026-01-01T12:00:00Z", clubLogBytes: 12345,
      activationUpdatedAt: { pota: "2026-10-12T00:00:00Z" }, activationBytes: { pota: 5555 }, activationCounts: { pota: 1200 },
      validators: { "cty.xml": { eTag: "cty-revision-1", lastModified: "Wed, 01 Jan 2025 00:00:00 GMT" } },
    } };
    const request = vi.fn(async (method: string) => method === "backup_list" ? listing : status);
    render(<DataManagementPanel section="references" onRequest={request} onChanged={vi.fn()} sourceSettings={{ clubLogCTYURL: "https://user:unit-password@cdn.clublog.org/cty.php?api=unit-key", lotwActivityURL: "https://lotw.example.invalid/activity.csv" }} />);
    const table = await screen.findByRole("table", { name: "Reference dataset evidence" });
    await waitFor(() => expect(within(table).getByText("cty-revision-1", { exact: false })).toBeTruthy());
    const club = within(within(table).getByRole("row", { name: /Club Log CTY/ }));
    expect(club.getByText("https://cdn.clublog.org/cty.php")).toBeTruthy();
    expect(club.getByText("Workspace CTY in use")).toBeTruthy();
    expect(club.getByText("12,345 bytes recorded")).toBeTruthy();
    expect(club.getByText("Record count not reported")).toBeTruthy();
    expect(club.getByText("No successful check recorded")).toBeTruthy();
    expect(club.getByText("Successful refresh/check: Not recorded")).toBeTruthy();
    expect(club.getByText(/Legacy cache date:/)).toBeTruthy();
    const pota = within(within(table).getByRole("row", { name: /^POTA/ }));
    expect(pota.getByText("1,200 records")).toBeTruthy();
    expect(pota.getByText("Freshness not assessed")).toBeTruthy();
    expect(table.textContent).not.toContain("unit-password");
    expect(table.textContent).not.toContain("unit-key");
    expect(table.textContent).not.toMatch(/up.to.date/i);
    expect(within(table).getAllByText("Per-dataset errors: not recorded")).toHaveLength(8);
    expect(within(table).getAllByText("Last download: not tracked separately")).toHaveLength(8);
    expect(request.mock.calls.some(([method]) => method === "reference_refresh")).toBe(false);
    expect(screen.queryByRole("button", { name: "Create backup" })).toBeNull();
  });
  it("does not derive a successful check or freshness just from bytes, cache existence or bundled fallback", async () => {
    const request = vi.fn(async (method: string) => method === "backup_list" ? listing : { ...reference, state: { clubLogBytes: 90000 } });
    render(<DataManagementPanel section="references" onRequest={request} onChanged={vi.fn()} />);
    await screen.findByText("Bundled CTY fallback in use");
    const row = within(screen.getByRole("row", { name: /Club Log CTY/ }));
    expect(row.getByText("No successful check recorded")).toBeTruthy();
    expect(row.getByText("Freshness not assessed")).toBeTruthy();
    expect(row.getByText("Successful refresh/check: Not recorded")).toBeTruthy();
    expect(screen.getByText("Bulk source unavailable")).toBeTruthy();
  });
  it("keeps backup listing usable when independent reference status fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "reference_status") throw new Error("Reference service unavailable");
      return { backups: [{ name: "Retained.xlogbackup" }] };
    });
    render(<DataManagementPanel section="backups" onRequest={request} onChanged={vi.fn()} />);
    expect((await screen.findByText("Retained.xlogbackup")).getAttribute("role")).toBe("listitem");
    expect(screen.queryByRole("table", { name: "Reference dataset evidence" })).toBeNull();
  });
  it("sanitizes source endpoints without exposing userinfo or query credentials", () => {
    expect(safeReferenceSource("https://user:password@example.com/feed?api=key#secret")).toBe("https://example.com/feed");
    for (const value of [null, "", "not a URL", "javascript:alert(1)"]) expect(safeReferenceSource(value)).toBe("Not reported");
  });
  it("uses separate downloaded/check/attempt metadata and shows failure without replacing earlier success evidence", async () => {
    const status = { ...reference, state: { sourceMetadata: {
      "cty.xml": { downloadedAt: "2026-09-01T00:00:00Z", checkedAt: "2026-10-01T00:00:00Z", lastAttemptAt: "2026-10-01T00:00:00Z", status: "up_to_date" },
      "lotw-user-activity.csv": { downloadedAt: "2026-09-01T00:00:00Z", checkedAt: "2026-09-01T00:00:00Z", lastAttemptAt: "2026-10-12T00:00:00Z", status: "failed", lastError: "download_or_validation_failed" },
      "pota-parks.csv": { downloadedAt: "2026-10-12T00:00:00Z", checkedAt: "2026-10-12T00:00:00Z", lastAttemptAt: "2026-10-12T00:00:00Z", status: "downloaded" },
      "sota-summits.csv": { checkedAt: "2026-10-12T00:00:00Z", status: "up_to_date" },
      "iota-groups.json": { checkedAt: "2026-10-12T00:00:00Z", status: "up_to_date" },
      "wwff-directory.csv": { checkedAt: "2026-10-12T00:00:00Z", status: "up_to_date" },
    } } };
    const request = vi.fn(async (method: string) => method === "backup_list" ? listing : status);
    render(<DataManagementPanel section="references" onRequest={request} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Source unchanged at last check")).toHaveLength(4));
    const club = within(screen.getByRole("row", { name: /Club Log CTY/ }));
    expect(club.getByText("Unchanged at the recorded source check")).toBeTruthy();
    expect(club.getByText(/Last download:/).textContent).not.toContain("not tracked");
    const lotw = within(screen.getByRole("row", { name: /LoTW activity/ }));
    expect(lotw.getByText("Last attempt failed")).toBeTruthy();
    expect(lotw.getByText("Latest check failed; freshness unknown")).toBeTruthy();
    expect(lotw.getByText("Last error: download_or_validation_failed")).toBeTruthy();
    const pota = within(screen.getByRole("row", { name: /^POTA/ }));
    expect(pota.getByText("Last result: downloaded")).toBeTruthy();
    expect(pota.getByText("Updated at the recorded source check")).toBeTruthy();
    for (const name of ["SOTA", "IOTA", "WWFF"]) expect(within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getByText("Source unchanged at last check")).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === "reference_refresh")).toBe(false);
  });

  it("observes native background progress while idle, coalesces slow status reads and stops when hidden", async () => {
    vi.useFakeTimers();
    let resolveStatus!: (value: any) => void;
    let reads = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "backup_list") return listing;
      reads++;
      if (reads === 1) return reference;
      return new Promise(resolve => { resolveStatus = resolve; });
    });
    const view = render(<DataManagementPanel section="references" onRequest={request} onChanged={vi.fn()} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(reads).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(reads).toBe(2);
    await act(async () => { resolveStatus({ ...reference, running: true, status: "Updating activations" }); });
    expect(screen.getAllByText("Refresh running")).toHaveLength(4);
    view.rerender(<DataManagementPanel section="references" visible={false} onRequest={request} onChanged={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(reads).toBe(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(reads).toBe(2);
  });

  it("does not poll reference status while showing only backups", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (method: string) => method === "backup_list" ? listing : reference);
    render(<DataManagementPanel section="backups" onRequest={request} onChanged={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(request.mock.calls.filter(([method]) => method === "reference_status")).toHaveLength(1);
  });
});
