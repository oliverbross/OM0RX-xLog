import { normalizedCall } from "./draftEnrichment";
import { settingsLoadingLookup } from "./callsignIntelligenceContext";

type Request = (method: string, params?: Record<string, any>) => Promise<any>;
const delays = [250, 500, 1_000, 2_000, 4_000, 4_000, 4_000, 4_000];
export const callsignLookupDeadlineMs = 46_000 + delays.reduce((total, delay) => total + delay, 0);
const transientCodes = new Set(["worker_busy", "worker_unavailable", "worker_stopping", "network_timeout"]);
// Older native dispatch failures are strings, before the worker envelope exists.
const nativeAdmissionCodes = new Map([
  ["Prototype worker is busy; try again", "worker_busy"],
  ["Station service is busy; try again.", "worker_busy"],
  ["Station service unavailable; retry the request", "worker_unavailable"],
  ["Station service unavailable", "worker_unavailable"],
]);
export function transientLookupReadFailure(cause: unknown): boolean {
  const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  if (typeof code === "string") return transientCodes.has(code);
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return nativeAdmissionCodes.has(message);
}
type Entry = { promise: Promise<any>; users: number };
const pending = new WeakMap<Request, Map<string, Entry>>();
function acquire(request: Request, call: string, scope: string) {
  let reads = pending.get(request);
  if (!reads) { reads = new Map(); pending.set(request, reads); }
  const key = JSON.stringify([scope, normalizedCall(call)]);
  let entry = reads.get(key);
  if (!entry) {
    const created: Entry = { users: 0, promise: Promise.resolve().then(() => request("lookup_call", { call })).finally(() => {
      if (reads!.get(key) === created) reads!.delete(key);
    }) };
    entry = created; reads.set(key, entry);
  }
  entry.users++;
  let released = false;
  return { promise: entry.promise, release: () => {
    if (released) return;
    released = true; entry!.users--;
    if (!entry!.users && reads!.get(key) === entry) reads!.delete(key);
  } };
}

/** Only lookup_call is retried. Provider unavailable/auth/not-found profiles are
 * terminal results: the native provider does not expose a safe transient code. */
export function boundedCallsignLookup(request: Request, call: string, timeoutMs = callsignLookupDeadlineMs,
                                     options: { signal?: AbortSignal; scope?: string } = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false, retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let current: ReturnType<typeof acquire> | undefined;
    const finish = (ok: boolean, value?: any) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); if (retryTimer) clearTimeout(retryTimer);
      options.signal?.removeEventListener("abort", abort); current?.release();
      if (ok) resolve(value); else reject(value);
    };
    const abort = () => finish(false, new DOMException("Callsign lookup cancelled.", "AbortError"));
    const retry = (exhausted: () => void) => {
      current?.release(); current = undefined;
      if (retries >= delays.length) { exhausted(); return; }
      retryTimer = setTimeout(attempt, delays[retries++]);
    };
    const attempt = () => {
      if (settled || options.signal?.aborted) { abort(); return; }
      current = acquire(request, call, options.scope ?? "");
      void current.promise.then(value => {
        if (settled) return;
        if (settingsLoadingLookup(value)) { retry(() => finish(true, value)); return; }
        finish(true, value);
      }, cause => {
        if (settled) return;
        if (transientLookupReadFailure(cause)) { retry(() => finish(false, cause)); return; }
        finish(false, cause);
      });
    };
    // One fixed overall budget includes bounded admission backoff plus the
    // provider's existing 46-second allowance. Retries never reset this timer.
    const deadline = setTimeout(() => finish(false, new Error("Callsign lookup timed out.")), timeoutMs);
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    attempt();
  });
}
