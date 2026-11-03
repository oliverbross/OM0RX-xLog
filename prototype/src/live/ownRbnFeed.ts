import { parseOwnRBN, type OwnRBNSpot } from "./hfPropagationModel";

export type OwnRBNTransport = (source: string, parameters?: Record<string, unknown>) => Promise<string>;

type FeedEntry = {
  loadedAt: number;
  spots: OwnRBNSpot[];
  pending?: Promise<OwnRBNSpot[]>;
};

export function retainOwnRBN(previous: OwnRBNSpot[], incoming: OwnRBNSpot[], seconds = 600, now = Date.now()): OwnRBNSpot[] {
  const seen = new Set<string>();
  return [...incoming, ...previous].filter(spot => spot.time >= now - seconds * 1000 && spot.time <= now + 60_000)
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
    .filter(spot => { const key = `${spot.spotter}|${spot.band}|${spot.mode}|${spot.id}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 2000);
}

const feeds = new WeakMap<OwnRBNTransport, Map<string, FeedEntry>>();

function entryFor(transport: OwnRBNTransport, ownCall: string, sinceSeconds: number) {
  let transportFeeds = feeds.get(transport);
  if (!transportFeeds) { transportFeeds = new Map(); feeds.set(transport, transportFeeds); }
  const normalized = ownCall.trim().toUpperCase();
  const call = /^[A-Z0-9/]{3,16}$/.test(normalized) ? normalized : "";
  const key = `${call}|${sinceSeconds}`;
  let entry = transportFeeds.get(key);
  if (!entry) { entry = { loadedAt: 0, spots: [] }; transportFeeds.set(key, entry); }
  return { call, entry };
}

export async function loadOwnRBNPickups(
  transport: OwnRBNTransport,
  ownCall: string,
  maximumAgeMilliseconds = 15_000,
  sinceSeconds = 600,
): Promise<OwnRBNSpot[]> {
  const { call, entry } = entryFor(transport, ownCall, sinceSeconds);
  if (!call) return [];
  if (entry.pending) return entry.pending;
  if (entry.loadedAt && Date.now() - entry.loadedAt < maximumAgeMilliseconds) return entry.spots;
  const pending = transport("own_rbn", { sinceSeconds, ownCall: call })
    .then(payload => parseOwnRBN(JSON.parse(payload), call))
    .then(spots => { entry.spots = retainOwnRBN(entry.spots, spots, sinceSeconds); entry.loadedAt = Date.now(); return entry.spots; })
    .finally(() => { entry.pending = undefined; });
  entry.pending = pending;
  return pending;
}
