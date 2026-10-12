import { useEffect } from "react";
export const referenceAutoCheckKey = "xlog.integration.referenceAutoCheck";
export const referenceAutoCheckChanged = "xlog:reference-auto-check";
export function useReferenceSchedule(ready: boolean, request: (method: string) => Promise<unknown>) {
  useEffect(() => {
    if (!ready) return;
    let disposed = false, pending = false, lastAttempt = 0;
    const check = () => {
      if (disposed || pending || localStorage.getItem(referenceAutoCheckKey) === "false" || Date.now() - lastAttempt < 60_000) return;
      lastAttempt = Date.now(); pending = true;
      void request("reference_schedule").catch(() => { /* Per-source evidence is shown in Reference data. */ }).finally(() => { pending = false; });
    };
    const start = window.setTimeout(check, 30_000);
    const interval = window.setInterval(check, 60 * 60_000);
    const wake = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener(referenceAutoCheckChanged, check);
    document.addEventListener("visibilitychange", wake);
    return () => { disposed = true; clearTimeout(start); clearInterval(interval); window.removeEventListener("focus", check); window.removeEventListener(referenceAutoCheckChanged, check); document.removeEventListener("visibilitychange", wake); };
  }, [ready, request]);
}
