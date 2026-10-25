import { formatSpotFrequency } from "./spotFrequency";
import type { Spot } from "./model";

export type MapSpot = Omit<Spot, "mode"> & { mode: string; receivedAt?: number; locationOnly?: boolean };

export const normalizedMapCall = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

/** One valid location per callsign, retaining the newest spot's feed identity. */
export function normalizeMapSpots<T extends MapSpot>(data: readonly T[]): T[] {
  const current = new Map<string, T>();
  for (const spot of data) {
    const call = normalizedMapCall(spot.call);
    if (!call || /^(NONE|NULL|UNDEFINED)$/i.test(call) || !spot.id ||
        !Number.isFinite(spot.mhz) || (spot.mhz <= 0 && !(spot.locationOnly && spot.mhz === 0)) ||
        !Number.isFinite(spot.lat) || Math.abs(spot.lat) > 90 ||
        !Number.isFinite(spot.lon) || Math.abs(spot.lon) > 180) continue;
    const prior = current.get(call);
    const timestamp = Number.isFinite(spot.receivedAt) ? spot.receivedAt! : -Infinity;
    const priorTimestamp = prior && Number.isFinite(prior.receivedAt) ? prior.receivedAt! : -Infinity;
    // Equal or missing timestamps retain input order, including synthetic fixtures.
    if (!prior || timestamp > priorTimestamp) current.set(call, { ...spot, call });
  }
  return [...current.values()];
}

export function dxccPrefixLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const prefix = value.replaceAll("_", "/").split(",", 1)[0].split("-", 1)[0].trim();
  return /^(?:none|null|undefined|n\/a)$/i.test(prefix) ? "" : prefix;
}

export function mapSpotDetails(spot: MapSpot): string[] {
  return [
    spot.locationOnly ? "Scheduled operation · frequency not supplied" : `${formatSpotFrequency(spot.mhz * 1_000_000)} MHz · ${spot.band} · ${spot.mode}`,
    [spot.country, spot.callStatus ?? spot.state].filter(Boolean).join(" · "),
    ...(spot.reporter ? [`Reported by ${spot.reporter}`] : []),
    ...(spot.note ? [spot.note] : []),
  ];
}

/** Smallest longitude span, including Pacific groups crossing the date line. */
export function mapSpotBounds(spots: readonly MapSpot[]): [[number, number], [number, number]] | null {
  if (!spots.length) return null;
  const longitudes = spots.map(spot => (spot.lon + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1, start = longitudes[0];
  for (let index = 0; index < longitudes.length; index++) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1] : longitudes[0] + 360;
    if (next - longitudes[index] > largestGap) { largestGap = next - longitudes[index]; start = next % 360; }
  }
  if (start > 180) start -= 360;
  return [[start, Math.min(...spots.map(spot => spot.lat))], [start + 360 - largestGap, Math.max(...spots.map(spot => spot.lat))]];
}
