import { isTauri } from "@tauri-apps/api/core";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;

/** Read only the small sync summary. Schedule after each response so a slow
 * worker never accumulates overlapping polls. Native completion events wake all
 * windows; the browser fallback refreshes its own workspace. */
export function watchSyncCompletion(request: Request, changed: () => void) {
  let active = true, completion: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const summary = await request("sync_summary", {});
      if (!active) return;
      const token = typeof summary.completion_id === "string" ? summary.completion_id
        : typeof summary.finished_at === "string" ? summary.finished_at : undefined;
      if (summary.running === false && token) {
        if (token !== completion && !isTauri()) changed();
        completion = token;
      }
    } catch { /* A transient summary failure is retried without hiding the draft. */ }
    finally { if (active) timer = setTimeout(() => void poll(), 5_000); }
  };
  void poll();
  return () => { active = false; clearTimeout(timer); };
}
