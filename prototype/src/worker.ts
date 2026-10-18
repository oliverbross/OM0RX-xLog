import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BandMapViewPreferences } from "./live/BandMaps";
export const desktop = isTauri();
export type DetachedMapKind = "world-map" | "band-maps";
export type DetachedSpotKind = DetachedMapKind | "dx-cluster";
export type StationProvider = "direct_agent" | "direct_flex_lan" | "direct_tci" | "hamlib";
export type WorkerResponse<T = unknown> = { id: string; ok: true; result: T } |
  { id: string; ok: false; error: { code?: string; message?: string; outcome?: "confirmed" | "uncertain" } };
export type DetachedMapProjection = {
  revision?: number;
  spots: Record<string, any>[]; palette?: Record<string, unknown>;
  home?: { call?: string; lat: number; lon: number; grid?: string; country?: string } | null;
  dxccStatuses?: Record<number, "needed" | "worked" | "confirmed"> | null;
  radioFrequencyHz?: number; selected?: string | null;
  target?: { call: string; lat: number; lon: number; country?: string; locationSource?: string };
  bandMapPreferences?: BandMapViewPreferences;
};
export type MonitorProjection = DetachedMapProjection & {
  station: Record<string, any> | null;
  provider: StationProvider;
  controlsEnabled: boolean;
};
export function validMonitorProjection(value: unknown): value is MonitorProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.spots) && item.spots.length <= 500 &&
    (item.station === null || typeof item.station === "object" && !Array.isArray(item.station)) &&
    (item.provider === "direct_agent" || item.provider === "direct_flex_lan" || item.provider === "direct_tci" || item.provider === "hamlib") &&
    typeof item.controlsEnabled === "boolean" &&
    (item.station === null || (item.station as Record<string, unknown>).source === item.provider);
}
const detachedKinds: DetachedMapKind[] = ["world-map", "band-maps"];
export function detachedMapKind(value: unknown): DetachedMapKind | null {
  return typeof value === "string" && detachedKinds.includes(value as DetachedMapKind) ? value as DetachedMapKind : null;
}
export function findDetachedSpot(payload: unknown, spots: Record<string, any>[]): Record<string, any> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { spotId, kind } = payload as Record<string, unknown>;
  if (!(detachedMapKind(kind) || kind === "dx-cluster") || typeof spotId !== "string" || !spotId || spotId.length > 128) return null;
  return spots.find((spot) => spot.id === spotId) ?? null;
}
export async function openDetachedMap(kind: DetachedMapKind): Promise<void> {
  if (!detachedMapKind(kind)) throw new Error("Unknown map window.");
  if (!desktop) throw new Error("Detached maps require the desktop app.");
  await invoke("open_detached_map", { kind });
}
export async function onDetachedSpot(handler: (payload: unknown) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-spot", (event) => handler(event.payload)) : () => {};
}
export async function onDetachedReady(handler: (kind: DetachedMapKind) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-ready", (event) => { const kind = detachedMapKind(event.payload); if (kind) handler(kind); }) : () => {};
}
export async function onDetachedProjection(handler: (value: DetachedMapProjection) => void): Promise<UnlistenFn> {
  return desktop ? listen<DetachedMapProjection>("xlog:detached-projection", (event) => handler(event.payload)) : () => {};
}
export async function announceDetachedReady(kind: DetachedMapKind): Promise<void> {
  if (desktop) await emitTo("main", "xlog:detached-ready", kind);
}
export async function publishDetachedProjection(kind: DetachedMapKind, projection: DetachedMapProjection): Promise<void> {
  if (desktop) await emitTo(kind, "xlog:detached-projection", projection);
}
export async function requestDetachedSpot(kind: DetachedSpotKind, spotId: string): Promise<void> {
  if (!(detachedMapKind(kind) || kind === "dx-cluster") || typeof spotId !== "string" || !spotId || spotId.length > 128) return;
  if (desktop) await emitTo("main", "xlog:detached-spot", { kind, spotId });
}
export async function onDetachedBandMapPreferences(handler: (value: unknown) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:detached-band-map-preferences", event => handler(event.payload)) : () => {};
}
export async function requestDetachedBandMapPreferences(preferences: BandMapViewPreferences): Promise<void> {
  if (desktop) await emitTo("main", "xlog:detached-band-map-preferences", preferences);
}
export async function onMonitorProjection(handler: (value: MonitorProjection) => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:monitor-projection", (event) => {
    if (validMonitorProjection(event.payload)) handler(event.payload);
  }) : () => {};
}
export async function onMonitorReady(handler: () => void): Promise<UnlistenFn> {
  return desktop ? listen("xlog:monitor-ready", () => handler()) : () => {};
}
export async function announceMonitorReady(): Promise<void> {
  if (desktop) await emitTo("main", "xlog:monitor-ready", null);
}
export async function publishMonitorProjection(projection: MonitorProjection): Promise<void> {
  if (desktop) await emitTo("monitor", "xlog:monitor-projection", projection);
}
export async function framedWorkerRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<WorkerResponse<T>> {
  if (!desktop)
    throw new Error(
      "The browser cannot connect to station services. Launch OM0RX-xLog on your desktop.",
    );
  const operating = await invoke<{ context: string }>("operating_module_status");
  return invoke<WorkerResponse<T>>("worker_request", {
    request: { id: crypto.randomUUID(), method, params, operatingContext: operating.context },
  });
}
export async function workerRequest(
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await framedWorkerRequest(method, params);
  if (!response.ok)
    throw new Error(
      response.error?.message || "The operation failed; no successful outcome was confirmed.",
    );
  return response;
}
export async function openMonitor() {
  if (desktop) {
    await invoke("open_monitor");
    return "Detached station monitor opened";
  }
  const w = window.open(
    `${window.location.pathname}?view=monitor`,
    "xlog-p1-monitor",
    "width=760,height=660",
  );
  if (!w)
    throw new Error("Monitor preview was blocked. Allow popups and try again.");
  return "Browser monitor preview opened";
}

export type QSODataQualityScope = { contactID: string; generation: string; expectedRevision: number; conflictID?: string };
export type QSODataQualityEvidence = {
  field: string; value: string; source: string; dateRole: string;
  date: string | null; rawDate: string | null; referenceSource: string | null; referenceVersion: string | null;
};
export type QSODataQualityReport = {
  contactID: string; contactRevision: number; contactStart: string; recordUpdatedAtNotFieldOrigin: string;
  retainedFields: QSODataQualityEvidence[]; referenceStatus: string;
  referenceComparison: QSODataQualityEvidence | null; retainedPowerObservation: QSODataQualityEvidence | null;
  findings: { kind: string; field: string; severity: string; message: string; retained: QSODataQualityEvidence;
    comparison: QSODataQualityEvidence | null; reviewImpacts: string[] }[];
  duplicateReview?: { rule: "nativePossibleDuplicate600SecondsV1"; windowSeconds: 600; candidateLimit: 5;
    status: "complete" | "truncated" | "unknown"; unresolvedRequirements: string[];
    candidates: { contactID: string; contactRevision: number; call: string; contactStart: string; band: string; mode: string }[] } | null;
};
export type QSODataQualityResponse = {
  generation: string; read_only?: true; status?: "workspace_changed" | "contact_changed";
  duplicate_review?: "notPerformed" | "boundedLocalReview"; conflict_review?: "notRequested" | "retainedConflict";
  data_quality?: QSODataQualityReport | null;
};

/** On-demand, exact-contact read only; this does not refresh references or resolve findings. */
export async function requestQSODataQuality(scope: QSODataQualityScope,
  request: (method: string, params: Record<string, unknown>) => Promise<any> = workerRequest): Promise<QSODataQualityResponse> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(scope.contactID) || !uuid.test(scope.generation) ||
      !Number.isSafeInteger(scope.expectedRevision) || scope.expectedRevision < 0 || scope.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      scope.conflictID !== undefined && !uuid.test(scope.conflictID)) throw new Error("Invalid contact review scope.");
  const params: Record<string, unknown> = {
    contactID: scope.contactID, generation: scope.generation, expectedRevision: scope.expectedRevision,
  };
  if (scope.conflictID !== undefined) params.conflictID = scope.conflictID;
  const response = await request("logbook_data_quality", params);
  const result = (response?.result ?? response) as QSODataQualityResponse | undefined;
  if (result?.status === "workspace_changed" && !result.data_quality) return result;
  if (!result || typeof result.generation !== "string" || result.generation.toLowerCase() !== scope.generation.toLowerCase() || result.read_only !== true ||
      result.data_quality && (typeof result.data_quality.contactID !== "string" || result.data_quality.contactID.toLowerCase() !== scope.contactID.toLowerCase() ||
        result.data_quality.contactRevision !== scope.expectedRevision)) throw new Error("Contact review context changed; discard these findings.");
  return result;
}

export type QSOCorrectionPreview = {
  contactID: string; expectedRevision: number; observedRevision: number; field: "dxcc";
  retainedValue: string | null; proposedValue: string; changeCount: 1; diffStatus: "complete";
};
export type QSOCorrectionPreviewResponse = {
  generation: string; read_only?: true;
  status?: "workspace_changed" | "contact_changed" | "contact_missing" | "reviewed";
  scope?: "ctyReferenceDXCCOnly"; evidence?: QSODataQualityEvidence; preview?: QSOCorrectionPreview | null;
};

/** Preview one exact current CTY DXCC comparison. This route has no operation or apply capability. */
export async function requestQSOCorrectionPreview(scope: QSODataQualityScope, evidence: QSODataQualityEvidence,
  request: (method: string, params: Record<string, unknown>) => Promise<any> = workerRequest): Promise<QSOCorrectionPreviewResponse> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(scope.contactID) || !uuid.test(scope.generation) || scope.conflictID !== undefined ||
      !Number.isSafeInteger(scope.expectedRevision) || scope.expectedRevision < 0 || scope.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !evidence || evidence.field !== "dxcc" || evidence.source !== "suppliedCTYReference" || typeof evidence.value !== "string" ||
      typeof evidence.dateRole !== "string" || [evidence.date, evidence.rawDate, evidence.referenceSource, evidence.referenceVersion]
        .some(value => value !== null && typeof value !== "string")) throw new Error("Invalid correction preview scope.");
  const response = await request("logbook_correction_preview", {
    contactID: scope.contactID, generation: scope.generation, expectedRevision: scope.expectedRevision, evidence,
  });
  const result = (response?.result ?? response) as QSOCorrectionPreviewResponse | undefined;
  if (!result || typeof result.generation !== "string" || result.generation.toLowerCase() !== scope.generation.toLowerCase() ||
      result.read_only !== true) throw new Error("Correction preview context changed; discard this preview.");
  if (result.status !== "reviewed") return result;
  const preview = result.preview;
  const returned = result.evidence;
  if (result.scope !== "ctyReferenceDXCCOnly" || !preview || preview.contactID.toLowerCase() !== scope.contactID.toLowerCase() ||
      preview.expectedRevision !== scope.expectedRevision || preview.observedRevision !== scope.expectedRevision || preview.field !== "dxcc" ||
      preview.changeCount !== 1 || preview.diffStatus !== "complete" || typeof preview.proposedValue !== "string" ||
      preview.retainedValue !== null && typeof preview.retainedValue !== "string" || !returned ||
      (["field", "value", "source", "dateRole", "date", "rawDate", "referenceSource", "referenceVersion"] as const)
        .some(key => returned[key] !== evidence[key])) throw new Error("Correction preview evidence changed; discard this preview.");
  return result;
}
