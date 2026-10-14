import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DxAlertRule = { id: string; name: string; enabled: boolean; callsignGlob: string; bands: string[]; modes: string[]; callStatuses: string[]; dxccStatuses: string[]; specials: string[] };
export type DxAlertConfiguration = { generation: string; revision: number; enabled: boolean; dedupSeconds: number; retentionMinutes: number; rules: DxAlertRule[] };
export type DxAlertEntry = { id: string; test: boolean; callsign: string; frequencyKHz: number; band: string; mode: string; callStatus: string; dxccStatus: string; specialTags: string[]; ruleNames: string[]; count: number; firstSeenMs: number; lastSeenMs: number };
export type DxAlertsSnapshot = { epoch: string; revision: number; configuration: DxAlertConfiguration; storageError: string | null; source: { available: boolean; baselined: boolean; revision: number; receivedAtMs: number }; entries: DxAlertEntry[]; limits: { maximumRules: number; maximumEntries: number } };

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const strings = (value: unknown, maximum: number) => Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === "string" && item.length <= 80);
export function checkedDxAlerts(input: unknown): DxAlertsSnapshot {
  const value = input as DxAlertsSnapshot;
  if (!value || !uuid.test(value.epoch) || !integer(value.revision) || !value.configuration || !value.source || !value.limits ||
    typeof value.configuration.generation !== "string" || !uuid.test(value.configuration.generation) || !integer(value.configuration.revision) ||
    typeof value.configuration.enabled !== "boolean" || !integer(value.configuration.dedupSeconds, 3_600) || value.configuration.dedupSeconds < 15 || !integer(value.configuration.retentionMinutes, 1_440) || value.configuration.retentionMinutes < 1 ||
    !Array.isArray(value.configuration.rules) || value.configuration.rules.length > 32 || value.configuration.rules.some(rule => !rule || !uuid.test(rule.id) ||
      typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 80 || typeof rule.enabled !== "boolean" || typeof rule.callsignGlob !== "string" || rule.callsignGlob.length > 24 ||
      !strings(rule.bands, 13) || !strings(rule.modes, 3) || !strings(rule.callStatuses, 7) || !strings(rule.dxccStatuses, 10) || !strings(rule.specials, 16)) ||
    typeof value.storageError !== "string" && value.storageError !== null || typeof value.source.available !== "boolean" || typeof value.source.baselined !== "boolean" ||
    !integer(value.source.revision) || !integer(value.source.receivedAtMs) || !Array.isArray(value.entries) || value.entries.length > 200 ||
    value.entries.some(entry => !entry || !uuid.test(entry.id) || typeof entry.test !== "boolean" || typeof entry.callsign !== "string" || entry.callsign.length > 24 ||
      typeof entry.frequencyKHz !== "number" || !Number.isFinite(entry.frequencyKHz) || typeof entry.band !== "string" || typeof entry.mode !== "string" ||
      typeof entry.callStatus !== "string" || typeof entry.dxccStatus !== "string" || !strings(entry.specialTags, 16) || !strings(entry.ruleNames, 32) ||
      !integer(entry.count) || entry.count < 1 || !integer(entry.firstSeenMs) || !integer(entry.lastSeenMs)) ||
    !integer(value.limits.maximumRules, 32) || !integer(value.limits.maximumEntries, 200)) throw new Error("DX alerts could not be verified.");
  return value;
}

type Adapter = { read: () => Promise<unknown>; listen: (wake: () => void) => Promise<() => void> };
export function connectDxAlerts(changed: (value: DxAlertsSnapshot) => void, failed: (message: string) => void,
  adapter: Adapter = { read: () => invoke("dx_alerts_snapshot"), listen: wake => listen("xlog:dx-alerts", wake) }) {
  let active = true, reading = false, again = false, latest: DxAlertsSnapshot | null = null, stop: (() => void) | undefined;
  const read = async () => {
    if (!active) return; if (reading) { again = true; return; } reading = true;
    do { again = false; try { const next = checkedDxAlerts(await adapter.read());
      if (!latest || next.epoch !== latest.epoch || next.revision > latest.revision) { latest = next; changed(next); }
      else if (next.revision === latest.revision && JSON.stringify(next) !== JSON.stringify(latest)) throw new Error("DX alerts changed without a verified revision.");
    } catch (cause) { failed(cause instanceof Error ? cause.message : "DX alerts unavailable."); } } while (active && again);
    reading = false;
  };
  void adapter.listen(() => void read()).then(dispose => { if (!active) dispose(); else { stop = dispose; void read(); } })
    .catch(() => { failed("DX alert notifications unavailable. Refocus to reload."); void read(); });
  const focus = () => void read(); window.addEventListener("focus", focus);
  return () => { active = false; stop?.(); window.removeEventListener("focus", focus); };
}

export const saveDxAlerts = (snapshot: DxAlertsSnapshot, configuration: Omit<DxAlertConfiguration, "generation" | "revision">) =>
  invoke("dx_alerts_save", { expectedGeneration: snapshot.configuration.generation, expectedRevision: snapshot.configuration.revision, configuration }).then(checkedDxAlerts);
export const testDxAlert = () => invoke("dx_alerts_test").then(checkedDxAlerts);
export const clearDxAlerts = () => invoke("dx_alerts_clear").then(checkedDxAlerts);
