import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StationProvider } from "../worker";
import { hamlibProjection } from "./hamlibStation";

/** Display stream only. Tune/command confirmation must use explicit readback. */
export function connectStationTelemetry(provider: StationProvider, changed: (snapshot: Record<string, any>) => void, failed: () => void, context: () => unknown = () => null): (() => void) | null {
  if (!isTauri()) return null;
  let active = true, revision = -1, lastReceived = Date.now(), unavailable = false;
  let stop: (() => void) | undefined;
  const failure = () => { if (active) { unavailable = true; failed(); } };
  const accept = (value: any) => {
    if (!active || !value || !Number.isSafeInteger(value.revision) || value.revision <= revision || value.revision < 0 || typeof value.available !== "boolean") return;
    if (value.provider !== provider) { failure(); return; }
    revision = value.revision;
    if (!value.available) { if (value.snapshot) failure(); return; }
    const age = Date.now() - value.received_at_ms;
    if (!Number.isSafeInteger(value.received_at_ms) || age < -1000 || age > 5000 ||
        !value.snapshot || typeof value.snapshot !== "object" || Array.isArray(value.snapshot) ||
        provider !== "hamlib" && value.snapshot.source !== provider) { failure(); return; }
    lastReceived = value.received_at_ms; unavailable = false;
    changed(provider === "hamlib" ? hamlibProjection(value.snapshot, null) : value.snapshot);
  };
  let reading = false, again = false;
  // Notifications are wake-ups, not authoritative observations. Read retained
  // native state after each wake so a queued pre-command event cannot resurrect
  // an invalidated observation. Also fence local spot/draft selection changes.
  const recover = async () => {
    if (!active) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false;
      const captured = context();
      try {
        const value = await invoke("station_telemetry_snapshot", { provider });
        if (active && captured === context()) accept(value);
      } catch { if (active && captured === context()) failure(); }
    } while (active && again);
    reading = false;
  };
  const timer = setInterval(() => { if (unavailable || Date.now() - lastReceived > 5000) failure(); }, 1000);
  const focus = () => { if (stop) void recover(); };
  window.addEventListener("focus", focus);
  void listen("xlog:station-telemetry", () => { void recover(); }).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; void recover();
  }).catch(failure);
  return () => { active = false; stop?.(); clearInterval(timer); window.removeEventListener("focus", focus); };
}
