import { useEffect, useMemo, useState } from "react";
import { RadioTower } from "lucide-react";
import { loadOwnRBNPickups, type OwnRBNTransport } from "./ownRbnFeed";
import { useOwnSpotWindowPreference } from "./ownSpotPreferences";
import type { OwnRBNSpot } from "./hfPropagationModel";
import "./SidebarOwnSpots.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type RawSpot = Record<string, any>;

export type SidebarOwnSpot = {
  id: string;
  callsign: string;
  spotter: string;
  frequencyKHz: number;
  band: string;
  mode: string;
  source: string;
  comment: string;
  receivedAt: number;
};

const maximumCards = 4;

function milliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(raw: RawSpot): SidebarOwnSpot | null {
  const frequencyKHz = Number(raw.frequencyKHz ?? raw.frequency_khz);
  const receivedAt = milliseconds(raw.arrivedAt ?? raw.receivedAt ?? raw.reportedAt);
  const callsign = String(raw.callsign || "").trim().toUpperCase();
  if (!raw.id || !callsign || !Number.isFinite(frequencyKHz) || !receivedAt) return null;
  return {
    id: String(raw.id), callsign, receivedAt, frequencyKHz,
    spotter: String(raw.spotter || "Unknown").trim().toUpperCase(),
    band: String(raw.band || "—"), mode: String(raw.mode || "—").toUpperCase(),
    source: String(raw.source || "cluster").toLowerCase(), comment: String(raw.comment || "").trim(),
  };
}

export function sidebarOwnSpotItems(history: RawSpot[], live: RawSpot[], ownCall: string, now = Date.now(), windowMinutes = 15) {
  const call = ownCall.trim().toUpperCase();
  if (!call) return [];
  const windowMilliseconds = windowMinutes * 60 * 1000;
  const unique = new Map<string, SidebarOwnSpot>();
  for (const raw of [...history, ...live]) {
    const spot = normalize(raw);
    if (!spot || spot.callsign !== call || spot.receivedAt < now - windowMilliseconds || spot.receivedAt > now + 60_000) continue;
    const key = `${spot.callsign}|${spot.spotter}|${spot.frequencyKHz.toFixed(1)}|${Math.floor(spot.receivedAt / 30_000)}`;
    const previous = unique.get(key);
    if (!previous || spot.receivedAt > previous.receivedAt) unique.set(key, spot);
  }
  return [...unique.values()].sort((left, right) => right.receivedAt - left.receivedAt).slice(0, maximumCards);
}

function age(time: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  return seconds < 60 ? "now" : `${Math.floor(seconds / 60)}m`;
}

function responseRows(raw: any): RawSpot[] {
  const value = raw && typeof raw === "object" && "result" in raw ? raw.result : raw;
  return Array.isArray(value?.page?.rows) ? value.page.rows : [];
}

function directRBNRows(spots: OwnRBNSpot[], ownCall: string): RawSpot[] {
  const callsign = ownCall.trim().toUpperCase();
  return spots.map(spot => ({
    id: `direct-rbn:${spot.id}`,
    callsign,
    spotter: spot.spotter,
    frequencyKHz: spot.frequencyKHz,
    band: spot.band,
    mode: spot.mode,
    source: "rbl",
    comment: `${spot.snr >= 0 ? "+" : ""}${spot.snr} dB${spot.speed ? ` · ${spot.speed} WPM` : ""}${spot.grid ? ` · ${spot.grid}` : ""}`,
    receivedAt: spot.time,
  }));
}

export default function SidebarOwnSpots({ request, ownCall, liveSpots, connected, rbnTransport }: {
  request: Request; ownCall: string; liveSpots: RawSpot[]; connected: boolean; rbnTransport?: OwnRBNTransport;
}) {
  const [history, setHistory] = useState<RawSpot[]>([]), [directRBN, setDirectRBN] = useState<RawSpot[]>([]), [now, setNow] = useState(Date.now());
  const ownSpotWindow = useOwnSpotWindowPreference();
  const windowMilliseconds = ownSpotWindow.minutes * 60 * 1000;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const current = Date.now(); setNow(current);
      if (!connected || !ownCall.trim()) { if (active) setHistory([]); return; }
      try {
        const rows = responseRows(await request("spot_history_query", {
          call: ownCall.trim().toUpperCase(), match: "exact", from: new Date(current - windowMilliseconds).toISOString(),
          to: new Date(current + 60_000).toISOString(), limit: 12,
        }));
        if (active) setHistory(rows);
      } catch { /* The filtered live snapshot remains a safe fallback. */ }
      finally { if (active) timer = setTimeout(read, 5000); }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [request, ownCall, connected, ownSpotWindow.minutes]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const current = Date.now(); setNow(current);
      if (!rbnTransport || !ownCall.trim()) { if (active) setDirectRBN([]); return; }
      try {
        const spots = await loadOwnRBNPickups(rbnTransport, ownCall, 15_000, ownSpotWindow.minutes * 60);
        if (active) setDirectRBN(directRBNRows(spots, ownCall));
      } catch { /* Human cluster spots remain available if the direct RBN feed is unavailable. */ }
      finally { if (active) timer = setTimeout(read, 120_000); }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [rbnTransport, ownCall, ownSpotWindow.minutes]);
  const items = useMemo(() => sidebarOwnSpotItems(history, [...directRBN, ...liveSpots], ownCall, now, ownSpotWindow.minutes), [history, directRBN, liveSpots, ownCall, now, ownSpotWindow.minutes]);
  if (!ownCall.trim()) return null;
  return <section className="sidebar-own-spots" aria-label="RBN and operator spots for this station">
    <header><span><RadioTower size={13} aria-hidden="true" />RBN / Spotted</span><small>{ownCall.trim().toUpperCase()}</small></header>
    {items.length ? <div className="sidebar-own-spot-list">{items.map(spot => <article key={spot.id} className={spot.source === "rbl" ? "is-rbn" : "is-human"}>
      <div><strong>{spot.spotter}</strong><span>{spot.source === "rbl" ? "RBN" : "SPOT"}</span><time dateTime={new Date(spot.receivedAt).toISOString()}>{age(spot.receivedAt, now)}</time></div>
      <p><b>{spot.band}</b><span>{(spot.frequencyKHz / 1000).toFixed(4)}</span><span>{spot.mode}</span>{spot.comment && <em title={spot.comment}>{spot.comment}</em>}</p>
    </article>)}</div> : <p className="sidebar-own-spots-empty">No pickups in the last {ownSpotWindow.minutes} min.</p>}
  </section>;
}
