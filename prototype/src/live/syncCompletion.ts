import { isTauri } from "@tauri-apps/api/core";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;

/** Browser-only fallback. Native owns its single completion channel even when
 * the main renderer is absent. Schedule after responses; never overlap polls. */
export function watchSyncCompletion(request: Request, changed: () => void) {
  if (isTauri()) return () => {};
  let active = true, completion: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const summary = await request("sync_summary", {});
      if (!active) return;
      const token = typeof summary.completion_id === "string" ? summary.completion_id
        : typeof summary.finished_at === "string" ? summary.finished_at : undefined;
      if (summary.running === false && token) {
        if (token !== completion) changed();
        completion = token;
      }
    } catch { /* A transient summary failure is retried without hiding the draft. */ }
    finally { if (active) timer = setTimeout(() => void poll(), 5_000); }
  };
  void poll();
  return () => { active = false; clearTimeout(timer); };
}
