import type { MapSpot } from "../MapSpots";

export type DXpeditionStatus = "live" | "active" | "recent" | "on_air" | "upcoming" | "idle";
export type NativeActivation = { sourceEpoch: string; spotVersion: string };

export type DXpeditionCatalogueItem = {
  id: string;
  kind: string;
  callsign: string;
  aliases?: string[];
  name: string;
  comment: string;
  source: string;
  source_url: string;
  starts_at?: string | null;
  ends_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: string;
  qsl_route?: string | null;
  activation?: NativeActivation;
  callsign_history?: { worked_count: number; confirmed_count: number; worked_modes: string[]; confirmed_modes: string[] } | null;
};

export type DXpeditionClusterSpot = {
  id: string;
  callsign: string;
  frequencyKHz: number;
  band: string;
  mode: string;
  receivedAt: number | string;
  spotter?: string;
  comment?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  activation?: NativeActivation;
};

export type DXpeditionObservation = {
  id: string;
  callsign: string;
  frequencyHz: number;
  band: string;
  mode: string;
  reportedAt: Date;
  spotter: string;
  comment: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  activation?: NativeActivation;
};

export type DXpeditionOperation = {
  id: string;
  primaryCall: string;
  aliases: string[];
  entity: string;
  qslRoute: string;
  notes: string;
  source: string;
  sourceURL: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: DXpeditionStatus;
  latitude: number | null;
  longitude: number | null;
  locationSource: string;
  observations: DXpeditionObservation[];
  bands: Map<string, Set<string>>;
  activation?: NativeActivation;
  history: DXpeditionCatalogueItem["callsign_history"];
};

const FOUNDATION_EPOCH_SECONDS = 978_307_200;
const statusRank: Record<DXpeditionStatus, number> = { live: 0, active: 1, recent: 2, on_air: 3, upcoming: 4, idle: 5 };

export const baselineDXpeditionBands = ["160m", "80m", "40m", "20m", "15m", "10m", "6m"] as const;

export function clusterReportedAt(value: unknown): Date | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const unixMs = value > 10_000_000_000 ? value : (value + FOUNDATION_EPOCH_SECONDS) * 1000;
  const parsed = new Date(unixMs);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function cleanCall(value: unknown): string {
  const call = typeof value === "string" ? value.trim().toUpperCase() : "";
  return call.length <= 64 && /^[A-Z0-9/]+$/.test(call) ? call : "";
}

function normalizedObservation(spot: DXpeditionClusterSpot): DXpeditionObservation | null {
  const callsign = cleanCall(spot.callsign), reportedAt = clusterReportedAt(spot.receivedAt);
  const frequencyHz = Math.round(spot.frequencyKHz * 1000);
  if (!callsign || !reportedAt || !Number.isSafeInteger(frequencyHz) || frequencyHz < 100_000 || frequencyHz > 300_000_000_000) return null;
  return {
    id: spot.id,
    callsign,
    frequencyHz,
    band: typeof spot.band === "string" ? spot.band : "",
    mode: typeof spot.mode === "string" ? spot.mode.trim().toUpperCase() : "",
    reportedAt,
    spotter: typeof spot.spotter === "string" ? spot.spotter : "",
    comment: typeof spot.comment === "string" ? spot.comment : "",
    country: typeof spot.country === "string" ? spot.country : "",
    latitude: validCoordinate(spot.latitude, 90) ? spot.latitude : null,
    longitude: validCoordinate(spot.longitude, 180) ? spot.longitude : null,
    activation: spot.activation,
  };
}

export function dxpeditionStatus(operation: Pick<DXpeditionOperation, "startsAt" | "endsAt" | "observations">, now: Date): DXpeditionStatus {
  const newest = operation.observations[0]?.reportedAt;
  const age = newest ? now.getTime() - newest.getTime() : Number.POSITIVE_INFINITY;
  if (age >= -60_000 && age < 45 * 60_000) return "live";
  if (operation.startsAt && operation.startsAt.getTime() > now.getTime()) return "upcoming";
  if (age >= -60_000 && age < 6 * 3_600_000) return "active";
  if (age >= -60_000 && age < 48 * 3_600_000) return "recent";
  if (operation.startsAt && operation.startsAt.getTime() <= now.getTime() &&
      (!operation.endsAt || operation.endsAt.getTime() >= now.getTime())) return "on_air";
  return "idle";
}

export function buildDXpeditionOperations(catalogue: readonly DXpeditionCatalogueItem[], cluster: readonly DXpeditionClusterSpot[], now = new Date()): DXpeditionOperation[] {
  const observations = cluster.map(normalizedObservation).filter((value): value is DXpeditionObservation => !!value);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = today.getTime() + 30 * 86_400_000;
  return catalogue.filter(item => item.kind === "dxpedition").flatMap(item => {
    const primaryCall = cleanCall(item.callsign);
    if (!primaryCall || typeof item.id !== "string" || !item.id) return [];
    const aliases = [...new Set([primaryCall, ...(item.aliases ?? []).map(cleanCall)].filter(Boolean))];
    const startsAt = date(item.starts_at), endsAt = date(item.ends_at);
    const aliasSet = new Set(aliases);
    const matched = observations.filter(spot => aliasSet.has(spot.callsign)
      && (!startsAt || spot.reportedAt.getTime() >= startsAt.getTime())
      && (!endsAt || spot.reportedAt.getTime() <= endsAt.getTime()))
      .sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime()).slice(0, 15);
    const currentOrUpcoming = !!startsAt && startsAt.getTime() <= horizon && (!endsAt || endsAt.getTime() >= today.getTime());
    const recentlyObserved = matched.some(spot => now.getTime() - spot.reportedAt.getTime() <= 48 * 3_600_000);
    if (!currentOrUpcoming && !recentlyObserved) return [];
    const latestLocation = matched.find(spot => spot.latitude !== null && spot.longitude !== null);
    const feedLocation = validCoordinate(item.latitude, 90) && validCoordinate(item.longitude, 180);
    const bands = new Map<string, Set<string>>();
    for (const spot of matched) {
      if (!spot.band) continue;
      const modes = bands.get(spot.band) ?? new Set<string>();
      modes.add(spot.mode || "Unknown"); bands.set(spot.band, modes);
    }
    const operation: DXpeditionOperation = {
      id: item.id,
      primaryCall,
      aliases,
      entity: typeof item.name === "string" ? item.name : "",
      qslRoute: typeof item.qsl_route === "string" ? item.qsl_route : "",
      notes: typeof item.comment === "string" ? item.comment : "",
      source: typeof item.source === "string" ? item.source : "",
      sourceURL: typeof item.source_url === "string" ? item.source_url : "",
      startsAt,
      endsAt,
      status: "idle",
      latitude: feedLocation ? item.latitude! : latestLocation?.latitude ?? null,
      longitude: feedLocation ? item.longitude! : latestLocation?.longitude ?? null,
      locationSource: feedLocation ? item.location_source || "Published catalogue position" : latestLocation ? "Latest configured-cluster report" : "No published coordinates",
      observations: matched,
      bands,
      activation: item.activation,
      history: item.callsign_history ?? null,
    };
    operation.status = dxpeditionStatus(operation, now);
    return [operation];
  }).sort((a, b) => {
    const status = statusRank[a.status] - statusRank[b.status];
    if (status) return status;
    const aTime = a.status === "upcoming" ? a.startsAt?.getTime() ?? Infinity : -(a.observations[0]?.reportedAt.getTime() ?? 0);
    const bTime = b.status === "upcoming" ? b.startsAt?.getTime() ?? Infinity : -(b.observations[0]?.reportedAt.getTime() ?? 0);
    return aTime - bTime || a.primaryCall.localeCompare(b.primaryCall) || a.id.localeCompare(b.id);
  });
}

export type DXpeditionStatusFilter = "all" | "live" | "active" | "recent" | "upcoming";
export function filterDXpeditionOperations(operations: readonly DXpeditionOperation[], status: DXpeditionStatusFilter, band: string, query: string): DXpeditionOperation[] {
  const needle = query.trim().toUpperCase();
  return operations.filter(operation => {
    const statusMatches = status === "all" || status === "live" && operation.status === "live" ||
      status === "active" && ["live", "active"].includes(operation.status) ||
      status === "recent" && ["live", "active", "recent", "on_air"].includes(operation.status) ||
      status === "upcoming" && operation.status === "upcoming";
    const bandMatches = band === "all" || operation.bands.has(band);
    const textMatches = !needle || operation.primaryCall.includes(needle) || operation.aliases.some(call => call.includes(needle)) || operation.entity.toUpperCase().includes(needle);
    return statusMatches && bandMatches && textMatches;
  });
}

const statusColor: Record<DXpeditionStatus, string> = {
  live: "#3ee58d", active: "#ffd166", recent: "#ff9f43", on_air: "#45d4ff", upcoming: "#b891ff", idle: "#83909d",
};

function mapMode(value: string | undefined): MapSpot["mode"] {
  if (value === "CW" || value === "FT8") return value;
  return "SSB";
}

export function dxpeditionMapSpots(operations: readonly DXpeditionOperation[]): MapSpot[] {
  return operations.filter(operation => operation.latitude !== null && operation.longitude !== null).map(operation => {
    const latest = operation.observations[0];
    return {
      id: operation.id,
      call: operation.primaryCall,
      receivedAt: latest?.reportedAt.getTime(),
      mhz: latest ? latest.frequencyHz / 1_000_000 : 0,
      mode: mapMode(latest?.mode),
      band: latest?.band || "",
      country: operation.entity,
      grid: "",
      lon: operation.longitude!,
      lat: operation.latitude!,
      reporter: latest?.spotter,
      note: latest?.comment || operation.notes,
      state: "needed",
      callStatus: operation.status.replace("_", " "),
      statusHex: statusColor[operation.status],
      locationOnly: !latest,
    };
  });
}
