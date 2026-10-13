import { useEffect } from "react";

export const referenceAutoCheckKey = "xlog.integration.referenceAutoCheck";
export const referenceAutoCheckChanged = "xlog:reference-auto-check";
export type ReferenceRequest = (method: string, params?: Record<string, any>) => Promise<any>;

export function legacyReferenceAutomaticCheck(): boolean {
  try { return localStorage.getItem(referenceAutoCheckKey) !== "false"; }
  catch { return true; }
}

export async function migrateReferenceSchedule(request: ReferenceRequest): Promise<boolean> {
  // Native persistence owns the preference after this one-time, per-workspace migration.
  const result = await request("reference_configure", { enabled: legacyReferenceAutomaticCheck(), only_if_unset: true });
  if (typeof result?.automatic_check !== "boolean") throw new Error("Reference preference was not confirmed.");
  return result.automatic_check;
}

export function useReferenceSchedule(ready: boolean, request: ReferenceRequest) {
  useEffect(() => {
    if (!ready) return;
    let disposed = false, migrating = false, migrated = false, pending = false, queued = false;
    let lastAttempt: number | null = null;
    let lastMigrationAttempt: number | null = null;
    const check = () => {
      if (disposed) return;
      if (!migrated) { queued = true; void migrate(); return; }
      if (pending || (lastAttempt !== null && Date.now() - lastAttempt < 60_000)) return;
      lastAttempt = Date.now(); pending = true;
      void request("reference_schedule").catch(() => { /* Evidence is shown in Reference data. */ })
        .finally(() => { pending = false; });
    };
    const migrate = async () => {
      if (disposed || migrating || migrated || (lastMigrationAttempt !== null && Date.now() - lastMigrationAttempt < 60_000)) return;
      lastMigrationAttempt = Date.now();
      migrating = true;
      try {
        await migrateReferenceSchedule(request);
        if (disposed) return;
        migrated = true;
        if (queued) { queued = false; check(); }
      } catch { /* Retry on the next wake; never run before migration is confirmed. */ }
      finally { migrating = false; }
    };
    void migrate();
    const start = window.setTimeout(check, 30_000);
    const wake = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener(referenceAutoCheckChanged, check);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true; window.clearTimeout(start);
      window.removeEventListener("focus", check);
      window.removeEventListener(referenceAutoCheckChanged, check);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ready, request]);
}
