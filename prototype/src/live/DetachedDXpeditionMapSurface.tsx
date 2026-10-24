import { useEffect, useMemo, useRef, useState } from "react";
import WorldMap from "../Map";
import { workerRequest } from "../worker";
import { SpotActivationStatus } from "./SpotActivationStatus";
import { StableFeedbackLayer } from "./StableFeedbackLayer";
import { useMapContext } from "./useMapContext";
import { useSpotActivation } from "./useSpotActivation";
import {
  baselineDXpeditionBands,
  buildDXpeditionOperations,
  dxpeditionMapSpots,
  filterDXpeditionOperations,
  type DXpeditionCatalogueItem,
  type DXpeditionClusterSpot,
  type DXpeditionOperation,
  type DXpeditionStatusFilter,
} from "./dxpeditionMapModel";
import "./DXpeditionMap.css";

type SourceHealth = { source: string; state: string; count: number; last_success: string | null; safe_error: string | null; source_url: string };
type DXpeditionSnapshot = { generated_at: string; items: DXpeditionCatalogueItem[]; total_available: number; sources: SourceHealth[]; surface?: string };
type Locale = "en" | "it";
export const dxpeditionMapMethods = ["opportunities_dxpedition_snapshot", "opportunities_dxpedition_refresh"] as const;
const text = {
  en: { title: "DXpedition Map", all: "All", live: "Live", active: "Active", recent: "Recent", upcoming: "Upcoming",
    search: "Search callsign, alias or entity", refresh: "Refresh sources", details: "Operation details", observations: "Recent frequencies",
    noResults: "No expeditions match these filters.", loading: "Loading expedition catalogue and configured-cluster observations…",
    outside: "Outside current filters", tune: "Tune & load", load: "Load callsign", unknown: "Unavailable", close: "Close details" },
  it: { title: "Mappa DXpedition", all: "Tutte", live: "Live", active: "Attive", recent: "Recenti", upcoming: "Future",
    search: "Cerca nominativo, alias o entità", refresh: "Aggiorna fonti", details: "Dettagli operazione", observations: "Frequenze recenti",
    noResults: "Nessuna spedizione corrisponde ai filtri.", loading: "Caricamento catalogo e osservazioni cluster configurate…",
    outside: "Fuori dai filtri correnti", tune: "Sintonizza e carica", load: "Carica nominativo", unknown: "Non disponibile", close: "Chiudi dettagli" },
} as const;
const statusFilters: DXpeditionStatusFilter[] = ["all", "live", "active", "recent", "upcoming"];

function verifiedSnapshot(value: unknown): DXpeditionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The expedition catalogue response could not be verified.");
  const snapshot = value as DXpeditionSnapshot;
  if (!Array.isArray(snapshot.items) || snapshot.items.length > 500 || !Array.isArray(snapshot.sources))
    throw new Error("The expedition catalogue response exceeded its bounded contract.");
  return snapshot;
}

export async function requestDXpeditionMap(method: string, params: Record<string, unknown> = {}) {
  if (!dxpeditionMapMethods.includes(method as typeof dxpeditionMapMethods[number]))
    throw new Error("This operation is unavailable in the DXpedition Map window.");
  const response = await workerRequest(method, params);
  return verifiedSnapshot(response.result);
}

function safeExternalURL(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; }
}

function fmtDate(value: Date | null, locale: Locale) {
  return value ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(value) : "—";
}

function fmtAge(value: Date, now: Date, locale: Locale) {
  const seconds = Math.max(0, Math.round((now.getTime() - value.getTime()) / 1000));
  if (seconds < 60) return locale === "it" ? `${seconds}s fa` : `${seconds}s ago`;
  if (seconds < 3600) return locale === "it" ? `${Math.floor(seconds / 60)} min fa` : `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return locale === "it" ? `${Math.floor(seconds / 3600)} h fa` : `${Math.floor(seconds / 3600)}h ago`;
  return locale === "it" ? `${Math.floor(seconds / 86400)} g fa` : `${Math.floor(seconds / 86400)}d ago`;
}

function radioTarget(context: ReturnType<typeof useMapContext>["context"]) {
  const selection = context?.selection;
  if (!selection || typeof selection !== "object") return "No selected radio";
  const provider = typeof selection.provider === "string" ? selection.provider.replaceAll("_", " ") : "radio unavailable";
  const id = typeof selection.radio_id === "string" ? selection.radio_id : typeof selection.selection_id === "string" ? selection.selection_id : "selected receiver";
  return `${id} · ${provider}`;
}

function OperationCard({ operation, selected, now, locale, onSelect }: { operation: DXpeditionOperation; selected: boolean; now: Date; locale: Locale; onSelect: () => void }) {
  const latest = operation.observations[0];
  return <button type="button" className={`dxp-card status-${operation.status}${selected ? " is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
    <span className="dxp-card-head"><strong>{operation.primaryCall}</strong><span>{operation.status.replace("_", " ")}</span></span>
    <span className="dxp-entity">{operation.entity || "Entity unavailable"}</span>
    {operation.aliases.length > 1 && <span className="dxp-aliases">{operation.aliases.slice(1).join(" · ")}</span>}
    <span className="dxp-card-foot">{latest ? `${(latest.frequencyHz / 1_000_000).toFixed(4)} MHz · ${latest.mode || "?"} · ${fmtAge(latest.reportedAt, now, locale)}` : `${fmtDate(operation.startsAt, locale)} – ${fmtDate(operation.endsAt, locale)}`}</span>
  </button>;
}

function Detail({ operation, shown, now, locale, radio, onClose, onTune, onLoad, tuning, loading }: { operation: DXpeditionOperation; shown: boolean; now: Date; locale: Locale; radio: string; onClose: () => void; onTune: (spot: DXpeditionOperation["observations"][number]) => void; onLoad: () => void; tuning: boolean; loading: boolean }) {
  const t = text[locale];
  const encoded = encodeURIComponent(operation.primaryCall);
  const links = [
    ["Club Log", `https://clublog.org/logsearch/${encoded}`],
    ["QRZ", `https://www.qrz.com/db/${encoded}`],
    ["DXWatch", `https://www.dxwatch.com/dxsd1/dxsd1.php?f=0&c=${encoded}`],
  ];
  const sourceURL = safeExternalURL(operation.sourceURL);
  return <aside className="dxp-detail" aria-label={t.details}>
    <button type="button" className="dxp-close" onClick={onClose} aria-label={t.close}>×</button>
    {!shown && <p className="dxp-outside">{t.outside}</p>}
    <p className={`dxp-status status-${operation.status}`}>{operation.status.replace("_", " ")}</p>
    <h2>{operation.primaryCall}</h2>
    <p className="dxp-detail-entity">{operation.entity || t.unknown}</p>
    {operation.aliases.length > 1 && <p><b>Aliases</b><span>{operation.aliases.slice(1).join(", ")}</span></p>}
    <div className="dxp-facts"><p><b>UTC dates</b><span>{fmtDate(operation.startsAt, locale)} – {fmtDate(operation.endsAt, locale)}</span></p>
      <p><b>QSL</b><span>{operation.qslRoute || t.unknown}</span></p><p><b>Radio target</b><span>{radio}</span></p>
      <p><b>Position</b><span>{operation.locationSource}</span></p><p><b>Club Log QSO total</b><span>{t.unknown}</span></p>
      <p><b>QSO/h</b><span>{t.unknown}</span></p><p><b>Watchers</b><span>{t.unknown}</span></p></div>
    {operation.notes && <p className="dxp-notes">{operation.notes}</p>}
    <h3>{t.observations}</h3>
    <div className="dxp-observations">{operation.observations.slice(0, 8).map((spot, index) => <div key={spot.id} className={index === 0 ? "is-latest" : ""}>
      <div><strong>{(spot.frequencyHz / 1_000_000).toFixed(6)} MHz</strong><span>{spot.band || "?"} · {spot.mode || "?"} · {fmtAge(spot.reportedAt, now, locale)}</span>
        <small>{spot.callsign}{spot.spotter ? ` · ${spot.spotter}` : ""}{spot.comment ? ` · ${spot.comment}` : ""}</small></div>
      <button type="button" disabled={tuning || !spot.activation} onClick={() => onTune(spot)}>{t.tune}</button>
    </div>)}</div>
    {!operation.observations.length && <button type="button" className="dxp-load-call" disabled={loading || !operation.activation} onClick={onLoad}>{t.load}</button>}
    <h3>Observed band / mode</h3><div className="dxp-band-grid">{["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"].map(band => <span key={band}><b>{band}</b>{[...(operation.bands.get(band) ?? [])].join(" · ") || "—"}</span>)}</div>
    <div className="dxp-links">{links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">{label}</a>)}{sourceURL && <a href={sourceURL} target="_blank" rel="noreferrer">Source</a>}</div>
  </aside>;
}

export function DetachedDXpeditionMapSurface() {
  const [snapshot, setSnapshot] = useState<DXpeditionSnapshot | null>(null), [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [clock, setClock] = useState(() => new Date());
  const [status, setStatus] = useState<DXpeditionStatusFilter>(() => (localStorage.getItem("xlog.dxpedition-map.status") as DXpeditionStatusFilter) || "all");
  const [band, setBand] = useState(() => localStorage.getItem("xlog.dxpedition-map.band") || "all");
  const [query, setQuery] = useState(""), [selectedID, setSelectedID] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem("xlog.dxpedition-map.locale") === "it" ? "it" : "en");
  const sequence = useRef(0), active = useRef(true), map = useMapContext();
  const tune = useSpotActivation(), loadCall = useSpotActivation("activate_opportunity");
  const read = async () => {
    const order = ++sequence.current;
    try { const value = await requestDXpeditionMap("opportunities_dxpedition_snapshot"); if (active.current && order === sequence.current) { setSnapshot(value); setError(""); } }
    catch (cause) { if (active.current && order === sequence.current) setError(cause instanceof Error ? cause.message : "DXpedition Map is unavailable."); }
  };
  const refresh = async (automatic = false) => {
    if (refreshing && !automatic) return;
    if (!automatic) setRefreshing(true);
    const order = ++sequence.current;
    try { const value = await requestDXpeditionMap("opportunities_dxpedition_refresh", { source: "all", automatic }); if (active.current && order === sequence.current) { setSnapshot(value); setError(""); } }
    catch (cause) { if (active.current && order === sequence.current) setError(cause instanceof Error ? cause.message : "Sources could not be refreshed; retained data remains visible."); }
    finally { if (active.current && !automatic) setRefreshing(false); }
  };
  useEffect(() => {
    active.current = true; void read(); void refresh(true);
    const ages = window.setInterval(() => setClock(new Date()), 20_000);
    const sources = window.setInterval(() => void refresh(true), 90_000);
    const focus = () => { setClock(new Date()); void read(); map.refresh(); };
    window.addEventListener("focus", focus);
    return () => { active.current = false; sequence.current++; clearInterval(ages); clearInterval(sources); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => { localStorage.setItem("xlog.dxpedition-map.status", status); localStorage.setItem("xlog.dxpedition-map.band", band); localStorage.setItem("xlog.dxpedition-map.locale", locale); }, [status, band, locale]);
  const rawSpots = (map.context?.cluster.response?.contest_spots ?? []) as DXpeditionClusterSpot[];
  const operations = useMemo(() => buildDXpeditionOperations(snapshot?.items ?? [], rawSpots, clock), [snapshot, rawSpots, clock]);
  const filtered = useMemo(() => filterDXpeditionOperations(operations, status, band, query), [operations, status, band, query]);
  const selected = operations.find(item => item.id === selectedID) ?? null;
  const shown = !!selected && filtered.some(item => item.id === selected.id), t = text[locale];
  const counts = { live: operations.filter(item => item.status === "live").length, active: operations.filter(item => ["live", "active"].includes(item.status)).length,
    dx: operations.filter(item => item.status !== "upcoming").length };
  const sourceState = snapshot?.sources.filter(source => ["adxo", "425dxn"].includes(source.source)) ?? [];
  return <div className="app live dxp-app"><main aria-label="DXpedition Map">
    <header className="dxp-header"><div><span className="dxp-kicker">OM0RX-xLog</span><h1>{t.title}</h1></div>
      <div className="dxp-counts"><span><b>{counts.live}</b> Live</span><span><b>{counts.active}</b> Active</span><span><b>{counts.dx}</b> DX</span></div>
      <label className="dxp-search"><span className="sr-only">{t.search}</span><input type="search" placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" onClick={() => setLocale(value => value === "en" ? "it" : "en")}>{locale === "en" ? "IT" : "EN"}</button>
      <button type="button" onClick={() => void refresh(false)} disabled={refreshing}>{refreshing ? "…" : "↻"}<span className="sr-only">{t.refresh}</span></button></header>
    <div className="dxp-source-strip">{sourceState.map(source => <span key={source.source} className={`state-${source.state}`} title={source.safe_error || ""}>{source.source.toUpperCase()} · {source.state} · {source.count}</span>)}
      <span>Cluster · {map.stale ? "stale/unavailable" : `${rawSpots.length} retained observations`}</span></div>
    <div className="dxp-toolbar"><div role="tablist" aria-label="Status filter">{statusFilters.map(value => <button type="button" role="tab" aria-selected={status === value} key={value} onClick={() => setStatus(value)}>{t[value]}</button>)}</div>
      <div className="dxp-bands" aria-label="Observed band filter"><button className={band === "all" ? "is-active" : ""} onClick={() => setBand("all")}>{t.all}</button>{baselineDXpeditionBands.map(value => <button key={value} className={band === value ? "is-active" : ""} onClick={() => setBand(value)}>{value.replace("m", "")}</button>)}</div></div>
    <div className="dxp-body"><section className="dxp-list" aria-label="DXpedition list"><p className="dxp-results">{filtered.length} shown · {operations.length} current / upcoming{operations.filter(item => item.latitude === null).length ? ` · ${operations.filter(item => item.latitude === null).length} unmapped` : ""}</p>
      {!snapshot && !error && <p className="dxp-empty">{t.loading}</p>}{snapshot && !filtered.length && <p className="dxp-empty">{t.noResults}</p>}
      {filtered.map(operation => <OperationCard key={operation.id} operation={operation} selected={operation.id === selectedID} now={clock} locale={locale} onSelect={() => setSelectedID(operation.id)} />)}</section>
      <section className="dxp-map" aria-label="Expedition map"><WorldMap data={dxpeditionMapSpots(filtered)} selected={selectedID} onSpot={spot => setSelectedID(spot.id)}
        compact persistenceKey="dxpedition-map" spotColorMode="status" fitToDataKey={selectedID ?? `${status}:${band}:${query}`}
        spotActionLabel="Inspect expedition" locationLabel="Catalogue and configured-cluster positions" /></section>
      {selected && <Detail operation={selected} shown={shown} now={clock} locale={locale} radio={radioTarget(map.context)} onClose={() => setSelectedID(null)}
        tuning={tune.requesting} loading={loadCall.requesting}
        onTune={spot => { setError(""); if (map.stale || !spot.activation) { setError("This retained observation is stale or no longer has native activation authority."); return; }
          void tune.activate({ id: spot.id, activation: spot.activation }).catch(cause => setError(cause instanceof Error ? cause.message : "Tune & load could not be verified.")); }}
        onLoad={() => { setError(""); if (!selected.activation) { setError("Refresh the catalogue before loading this callsign."); return; }
          void loadCall.activate({ id: selected.id, activation: selected.activation }).catch(cause => setError(cause instanceof Error ? cause.message : "Callsign load could not be verified.")); }} />}
    </div>
    <StableFeedbackLayer>{(error || map.error) && <p className="live-error" role="alert">{error || map.error}</p>}
      <SpotActivationStatus status={tune.status ?? loadCall.status} error={tune.error || loadCall.error} checking={tune.requesting || loadCall.requesting}
        reconcile={() => void (tune.status?.operationId ? tune.reconcile() : loadCall.reconcile())} /></StableFeedbackLayer>
  </main></div>;
}
