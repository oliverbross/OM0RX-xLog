import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
type Data = Record<string, any>;
export type PropagationProjection = { epoch: string; revision: number; pending: boolean; snapshot: Data | null; error: string };
type Action = "snapshot" | "ensure" | "refresh";
type Adapter = { read: (action: Action) => Promise<unknown>; listen: (wake: () => void) => Promise<() => void> };
function checked(value: any): PropagationProjection {
  if (!value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.epoch)
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.pending !== "boolean" || typeof value.error !== "string"
    || value.error.length > 1024 || value.snapshot !== null && (!value.snapshot || value.snapshot.source !== "N0NBH / HamQSL"
      || typeof value.snapshot.stale !== "boolean" || !Number.isFinite(value.snapshot.received_at)
      || !Array.isArray(value.snapshot.bands) || !value.snapshot.bands.length || value.snapshot.bands.length > 16
      || value.snapshot.bands.some((band: any) => typeof band?.name !== "string" || band.name.length > 40 ||
        [band.day, band.night].some(rating => !["good", "fair", "poor", "closed", "unknown"].includes(rating))))) {
    throw new Error("Shared propagation observation could not be verified.");
  }
  return value;
}
/** Renderers request freshness on mount, focus and a ten-minute cadence. Native
 * owns TTL/concurrency admission and its terminal projection; lost manual
 * replies trigger retained reads, never another fetch. */
export function connectPropagation(changed: (value: PropagationProjection) => void, failed: (message: string) => void,
  adapter: Adapter = { read: action => invoke("propagation_session_request", { action }), listen: wake => listen("xlog:propagation", wake) }) {
  let active = true, ready = false, reading = false, again = false, ensureQueued = false, refreshing = false, wakeEpoch = 0;
  let latest: PropagationProjection | null = null, stop: (() => void) | undefined, subscriptionError = "";
  const accept = (input: unknown) => {
    const value = checked(input);
    if (!latest || value.epoch !== latest.epoch || value.revision >= latest.revision) { latest = value; changed(value); }
    if (subscriptionError) failed(subscriptionError);
  };
  const recover = async (ensure = false) => {
    if (!active || !ready) return;
    if (reading) { again = true; ensureQueued ||= ensure; return; }
    reading = true;
    do {
      again = false; const captured = wakeEpoch, action: Action = ensure || ensureQueued ? "ensure" : "snapshot";
      ensure = false; ensureQueued = false;
      try { const value = await adapter.read(action); if (active && captured === wakeEpoch) accept(value); }
      catch (cause) { if (active && captured === wakeEpoch) failed(cause instanceof Error ? cause.message : "Shared propagation unavailable."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; wakeEpoch++; void recover(true); };
  window.addEventListener("focus", wake);
  const timer = window.setInterval(wake, 600_000);
  void adapter.listen(wake).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; ready = true; void recover(true);
  }).catch(() => {
    if (!active) return;
    subscriptionError = "Propagation notifications unavailable; refocus to read retained state.";
    ready = true; void recover(true);
  });
  return {
    async refresh() {
      if (!active || refreshing) return;
      refreshing = true;
      try { const value = await adapter.read("refresh"); if (active) accept(value); }
      catch (cause) { if (active) failed(cause instanceof Error ? cause.message : "Propagation refresh could not be confirmed. It was not retried."); }
      finally { refreshing = false; if (active) void recover(); }
    },
    dispose() { active = false; wakeEpoch++; stop?.(); window.clearInterval(timer); window.removeEventListener("focus", wake); },
  };
}
