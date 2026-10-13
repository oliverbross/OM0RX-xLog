import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validRotorSnapshot, type RotorSnapshot } from "./rotorControl";

/** Subscribe before reading the retained projection. No renderer poller or
 * command fallback: a failed stream makes controls unavailable. */
export function connectRotorTelemetry(changed: (snapshot: RotorSnapshot) => void, failed: () => void): (() => void) | null {
  if (!isTauri()) return null;
  let active = true, revision = -1, lastReceived = Date.now(), unavailable = false;
  let stop: (() => void) | undefined;
  const failure = () => { if (active) { unavailable = true; failed(); } };
  const accept = (value: any) => {
    if (!active || !value || !Number.isSafeInteger(value.revision) || value.revision <= revision || value.revision < 0 || typeof value.available !== "boolean") return;
    revision = value.revision;
    if (!value.available) { if (revision > 0) failure(); return; }
    const age = Date.now() - value.received_at_ms;
    if (!Number.isSafeInteger(value.received_at_ms) || age < -1000 || age > 5000 || !validRotorSnapshot(value.snapshot)) { failure(); return; }
    lastReceived = value.received_at_ms; unavailable = false; changed(value.snapshot);
  };
  const recover = () => { void invoke("rotor_telemetry_snapshot").then(accept).catch(failure); };
  // Continue fencing loss: an explicit command readback may temporarily update
  // the view, but it must not silently re-arm automatic use of a dead stream.
  const timer = setInterval(() => { if (unavailable || Date.now() - lastReceived > 5000) failure(); }, 1000);
  const focus = () => { if (stop) recover(); };
  window.addEventListener("focus", focus);
  void listen("xlog:rotor-telemetry", event => accept(event.payload)).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; recover();
  }).catch(failure);
  return () => { active = false; stop?.(); clearInterval(timer); window.removeEventListener("focus", focus); };
}
