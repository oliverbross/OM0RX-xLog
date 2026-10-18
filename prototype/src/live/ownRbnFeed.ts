import { cleanCall, parseOwnRBN, type OwnRBNSpot } from "./hfPropagationModel";

export type OwnRBNTransport = (source: string, parameters?: Record<string, unknown>) => Promise<string>;

type FeedEntry = {
  loadedAt: number;
  spots: OwnRBNSpot[];
  pending?: Promise<OwnRBNSpot[]>;
};

const feeds = new WeakMap<OwnRBNTransport, Map<string, FeedEntry>>();

function entryFor(transport: OwnRBNTransport, ownCall: string) {
  let transportFeeds = feeds.get(transport);
  if (!transportFeeds) { transportFeeds = new Map(); feeds.set(transport, transportFeeds); }
  const call = cleanCall(ownCall);
  let entry = transportFeeds.get(call);
  if (!entry) { entry = { loadedAt: 0, spots: [] }; transportFeeds.set(call, entry); }
  return { call, entry };
}

export async function loadOwnRBNPickups(
  transport: OwnRBNTransport,
  ownCall: string,
  maximumAgeMilliseconds = 15_000,
): Promise<OwnRBNSpot[]> {
  const { call, entry } = entryFor(transport, ownCall);
  if (!call) return [];
  if (entry.pending) return entry.pending;
  if (entry.loadedAt && Date.now() - entry.loadedAt < maximumAgeMilliseconds) return entry.spots;
  const pending = transport("own_rbn", { sinceSeconds: 600, ownCall: call })
    .then(payload => parseOwnRBN(JSON.parse(payload), call))
    .then(spots => { entry.spots = spots; entry.loadedAt = Date.now(); return spots; })
    .finally(() => { entry.pending = undefined; });
  entry.pending = pending;
  return pending;
}
