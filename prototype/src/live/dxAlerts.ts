import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DxAlertGeography = { dxEntity?: number | null; dxContinent?: string | null; dxCqZone?: number | null; dxItuZone?: number | null; spotterEntity?: number | null; spotterContinent?: string | null };
export type DxAlertRule = { id: string; name: string; enabled: boolean; sources?: ("cluster" | "wsjtx")[]; callsignGlob: string; commentContains: string; bands: string[]; modes: string[]; callStatuses: string[]; dxccStatuses: string[]; specials: string[]; dxEntities?: number[]; dxContinents?: string[]; dxCqZones?: number[]; dxItuZones?: number[]; spotterEntities?: number[]; spotterContinents?: string[] };
export type DxAlertConfiguration = { generation: string; revision: number; enabled: boolean; dedupSeconds: number; retentionMinutes: number; nativePopup: boolean; notificationSound: boolean; rules: DxAlertRule[] };
export type DxAlertEntry = { id: string; test: boolean; source?: "cluster" | "wsjtx" | "test"; callsign: string; frequencyKHz: number; band: string; mode: string; comment: string; callStatus: string; dxccStatus: string; specialTags: string[]; ruleNames: string[]; count: number; firstSeenMs: number; lastSeenMs: number; geography?: DxAlertGeography; observation?: {id:string; activation:{sourceEpoch:string;spotVersion:string}} | null };
export type DxAlertsSnapshot = { epoch: string; revision: number; configuration: DxAlertConfiguration; storageError: string | null; source: { available: boolean; baselined: boolean; revision: number; receivedAtMs: number }; activitySource?: { available: boolean; baselined: boolean; revision: number; classificationRevision?: number; receivedAtMs: number }; entries: DxAlertEntry[]; delivery: { error: string | null; suppressed: number; maximumPerWindow: number; windowSeconds: number }; limits: { maximumRules: number; maximumEntries: number } };

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const identifier = /^[a-z0-9-]{1,64}$/;
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const numbers = (value: unknown, max:number) => value === undefined || Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(n => Number.isSafeInteger(n) && n >= 1 && n <= max);
const continents = (value:unknown) => value === undefined || Array.isArray(value) && value.length <= 7 && new Set(value).size === value.length && value.every(s => ["AF","AN","AS","EU","NA","OC","SA"].includes(s));
const validGeography = (value:DxAlertGeography|undefined) => value === undefined || !!value && typeof value === "object" &&
  [value.dxEntity,value.spotterEntity].every(n=>n==null||Number.isSafeInteger(n)&&n>=1&&n<=999) &&
  (value.dxCqZone==null||Number.isSafeInteger(value.dxCqZone)&&value.dxCqZone>=1&&value.dxCqZone<=40) &&
  (value.dxItuZone==null||Number.isSafeInteger(value.dxItuZone)&&value.dxItuZone>=1&&value.dxItuZone<=90) &&
  [value.dxContinent,value.spotterContinent].every(s=>s==null||["AF","AN","AS","EU","NA","OC","SA"].includes(s));
const validObservation = (value:DxAlertEntry["observation"]) => value==null || !!value && typeof value.id==="string" && value.id.length>0 && value.id.length<=128 && !!value.activation && uuid.test(value.activation.sourceEpoch) && uuid.test(value.activation.spotVersion);
const strings = (value: unknown, maximum: number) => Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === "string" && item.length <= 80);
export function checkedDxAlerts(input: unknown): DxAlertsSnapshot {
  const value = input as DxAlertsSnapshot;
  if (!value || !uuid.test(value.epoch) || !integer(value.revision) || !value.configuration || !value.source || !value.delivery || !value.limits ||
    typeof value.configuration.generation !== "string" || !uuid.test(value.configuration.generation) || !integer(value.configuration.revision) ||
    typeof value.configuration.enabled !== "boolean" || typeof value.configuration.nativePopup !== "boolean" || typeof value.configuration.notificationSound !== "boolean" || value.configuration.notificationSound && !value.configuration.nativePopup || !integer(value.configuration.dedupSeconds, 3_600) || value.configuration.dedupSeconds < 15 || !integer(value.configuration.retentionMinutes, 1_440) || value.configuration.retentionMinutes < 1 ||
    !Array.isArray(value.configuration.rules) || value.configuration.rules.length > 32 || value.configuration.rules.some(rule => !rule || !identifier.test(rule.id) ||
      typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 80 || typeof rule.enabled !== "boolean" || typeof rule.callsignGlob !== "string" || rule.callsignGlob.length > 32 ||
      rule.sources !== undefined && (!Array.isArray(rule.sources) || rule.sources.length < 1 || rule.sources.length > 2 || new Set(rule.sources).size !== rule.sources.length || rule.sources.some(source => !["cluster", "wsjtx"].includes(source))) ||
      typeof rule.commentContains !== "string" || new TextEncoder().encode(rule.commentContains).length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(rule.commentContains) || !!rule.commentContains && !rule.commentContains.trim() ||
      !numbers(rule.dxEntities,999) || !numbers(rule.spotterEntities,999) || !numbers(rule.dxCqZones,40) || !numbers(rule.dxItuZones,90) || !continents(rule.dxContinents) || !continents(rule.spotterContinents) || !strings(rule.bands, 13) || !strings(rule.modes, 3) || !strings(rule.callStatuses, 7) || !strings(rule.dxccStatuses, 10) || !strings(rule.specials, 16)) ||
    typeof value.storageError !== "string" && value.storageError !== null || typeof value.source.available !== "boolean" || typeof value.source.baselined !== "boolean" ||
    !integer(value.source.revision) || !integer(value.source.receivedAtMs) || !Array.isArray(value.entries) || value.entries.length > 200 ||
    value.activitySource !== undefined && (!value.activitySource || typeof value.activitySource.available !== "boolean" || typeof value.activitySource.baselined !== "boolean" || !integer(value.activitySource.revision) ||
      value.activitySource.classificationRevision !== undefined && !integer(value.activitySource.classificationRevision) || !integer(value.activitySource.receivedAtMs)) ||
    value.entries.some(entry => !entry || !uuid.test(entry.id) || typeof entry.test !== "boolean" || typeof entry.callsign !== "string" || entry.callsign.length > 24 ||
      typeof entry.frequencyKHz !== "number" || !Number.isFinite(entry.frequencyKHz) || typeof entry.band !== "string" || typeof entry.mode !== "string" ||
      entry.source !== undefined && !["cluster", "wsjtx", "test"].includes(entry.source) ||
      typeof entry.comment !== "string" || new TextEncoder().encode(entry.comment).length > 512 || /[\x00-\x1f\x7f-\x9f]/.test(entry.comment) ||
      !validGeography(entry.geography) || !validObservation(entry.observation) ||
      typeof entry.callStatus !== "string" || typeof entry.dxccStatus !== "string" || !strings(entry.specialTags, 16) || !strings(entry.ruleNames, 32) ||
      !integer(entry.count) || entry.count < 1 || !integer(entry.firstSeenMs) || !integer(entry.lastSeenMs)) ||
    typeof value.delivery.error !== "string" && value.delivery.error !== null || !integer(value.delivery.suppressed) || !integer(value.delivery.maximumPerWindow, 20) || value.delivery.maximumPerWindow < 1 || !integer(value.delivery.windowSeconds, 300) || value.delivery.windowSeconds < 1 ||
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
export const clearSelectedDxAlerts = (snapshot: DxAlertsSnapshot, ids: string[]) =>
  invoke("dx_alerts_clear_selected", { expectedEpoch: snapshot.epoch, ids }).then(checkedDxAlerts);

export const previewDxAlerts = (rules:DxAlertRule[]) => invoke<{matches:{callsign:string;frequencyKHz:number;ruleNames:string[]}[]}>("dx_alerts_preview",{rules});
export const reviewDxAlert = (epoch:string,id:string) => invoke<{entry:DxAlertEntry;observation:DxAlertEntry["observation"];admissible:boolean;reason:string|null;alternatives?:{id:string;callsign:string;frequencyKHz:number;activation:{sourceEpoch:string;spotVersion:string}}[]}>("dx_alerts_review",{epoch,id});
export const dxRuleSummary = (rule:DxAlertRule) => [rule.bands.join(" / "),rule.modes.join(" / ").toUpperCase(),rule.callsignGlob,rule.dxccStatuses.join(" / "),
  rule.dxEntities?.length ? `DXCC ${rule.dxEntities.join(" / ")}` : "",rule.dxContinents?.join(" / "),
  rule.dxCqZones?.length ? `DX CQ ${rule.dxCqZones.join(" / ")}` : "",rule.dxItuZones?.length ? `DX ITU ${rule.dxItuZones.join(" / ")}` : "",
  rule.spotterEntities?.length ? `spotter DXCC ${rule.spotterEntities.join(" / ")}` : "",rule.spotterContinents?.length ? `spotter in ${rule.spotterContinents.join(" / ")}` : "",
  rule.commentContains ? `comment contains “${rule.commentContains}”` : ""].filter(Boolean).join(" + ");
