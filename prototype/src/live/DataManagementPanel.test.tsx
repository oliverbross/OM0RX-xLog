// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataManagementPanel from "./DataManagementPanel";

const manifest = { createdAt: "2026-10-12T10:00:00Z", qsoCount: 42, pendingSyncCount: 3,
  databaseBytes: 1_048_576, includesReferenceData: true };
const listing = { backups: [] };
const reference = { running: false, status: "Current", cty_source: "bundled", state: {} };
afterEach(cleanup);

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
