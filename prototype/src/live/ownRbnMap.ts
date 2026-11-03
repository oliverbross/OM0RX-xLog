import type { OwnRBNSpot } from "./hfPropagationModel";
import { currentOwnRbnSourceTime, ownRbnWindowMilliseconds } from "./ownRbnPolicy";
export const ownRbnWindow = ownRbnWindowMilliseconds;
export type RBNReceiver = OwnRBNSpot & { key: string; call: string; updates: number; location: { lat: number; lon: number; provenance: string } | null };
export function receiverLocation(grid: string): RBNReceiver["location"] {
  const value = grid.trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?$/.test(value)) return null;
  let lon = (value.charCodeAt(0) - 65) * 20 - 180 + Number(value[2]) * 2;
  let lat = (value.charCodeAt(1) - 65) * 10 - 90 + Number(value[3]);
  let width = 2, height = 1;
  if (value.length >= 6) { width /= 24; height /= 24; lon += (value.charCodeAt(4) - 65) * width; lat += (value.charCodeAt(5) - 65) * height; }
  if (value.length === 8) { width /= 10; height /= 10; lon += Number(value[6]) * width; lat += Number(value[7]) * height; }
  return { lat: lat + height / 2, lon: lon + width / 2, provenance: `${value} locator centre` };
}
export function ownRbnReceivers(spots: OwnRBNSpot[], call: string, band: string | null, now = Date.now()): RBNReceiver[] {
  const groups = new Map<string, RBNReceiver>();
  const seen = new Set<string>();
  for (const spot of [...spots].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))) {
    if (!currentOwnRbnSourceTime(spot.time, now) || band && spot.band !== band) continue;
    const key = `${call}|RBN|${spot.spotter}|${spot.band}|${spot.mode}`;
    const observation = `${key}|${spot.id}|${spot.time}`;
    if (seen.has(observation)) continue;
    seen.add(observation);
    const previous = groups.get(key);
    if (previous) previous.updates++;
    else if (groups.size < 200) groups.set(key, { ...spot, key, call, updates: 1, location: receiverLocation(spot.grid) });
  }
  return [...groups.values()];
}
