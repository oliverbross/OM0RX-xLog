import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export type AlertCode = "radio_inhibitors" | "radio_alarm" | "rotor_uncertain";
export type AlertsSnapshot = { epoch: string; revision: number; radio_report: boolean; rotor_report: boolean; items: { code: AlertCode; count: number }[] };
type Adapter = { read: () => Promise<unknown>; listen: (wake: () => void) => Promise<() => void> };
function checked(input: unknown): AlertsSnapshot {
  const value = input as AlertsSnapshot;
  if (!value || Object.keys(value).length !== 5 || typeof value.epoch !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.epoch) ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.radio_report !== "boolean" || typeof value.rotor_report !== "boolean" ||
    !Array.isArray(value.items) || value.items.length > 3 || new Set(value.items.map(item => item?.code)).size !== value.items.length ||
    value.items.some(item => !item || Object.keys(item).length !== 2 || !["radio_inhibitors", "radio_alarm", "rotor_uncertain"].includes(item.code) ||
      !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 10_000 ||
      (item.code === "rotor_uncertain" ? !value.rotor_report : !value.radio_report))) throw new Error("Retained alerts could not be verified.");
  return value;
}
/** Events are wakes only. No poller, worker fallback, acknowledgement or control. */
export function connectAlerts(changed: (value: AlertsSnapshot) => void, failed: (message: string) => void, invalidated: () => void,
  adapter: Adapter = { read: () => invoke("alerts_snapshot"), listen: wake => listen("xlog:alerts", wake) }) {
  let active = true, ready = false, reading = false, again = false, epoch = 0, warning = "";
  let stop: (() => void) | undefined, latest: AlertsSnapshot | null = null;
  const recover = async () => {
    if (!active || !ready) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = epoch;
      try {
        const value = checked(await adapter.read());
        if (active && captured === epoch) {
          if (!latest || value.epoch !== latest.epoch || value.revision >= latest.revision) {
            if (latest && value.epoch === latest.epoch && value.revision === latest.revision && JSON.stringify(value) !== JSON.stringify(latest)) throw new Error("Alerts changed without a verified revision.");
            latest = value; changed(value);
          }
          if (warning) failed(warning);
        }
      } catch (cause) { if (active && captured === epoch) failed(cause instanceof Error ? cause.message : "Retained alerts unavailable."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { if (!active) return; epoch++; invalidated(); void recover(); };
  window.addEventListener("focus", wake);
  void adapter.listen(wake).then(dispose => { if (!active) { dispose(); return; } stop = dispose; ready = true; void recover(); })
    .catch(() => { if (active) { warning = "Alerts notifications unavailable. Refocus to reload retained reports."; ready = true; void recover(); } });
  return () => { active = false; epoch++; stop?.(); window.removeEventListener("focus", wake); };
}
