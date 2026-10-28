import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import WorldMap from "../Map";
import { workerRequest } from "../worker";
import { SpotActivationStatus } from "./SpotActivationStatus";
import { StableFeedbackLayer } from "./StableFeedbackLayer";
import { useMapContext } from "./useMapContext";
import { useSpotActivation } from "./useSpotActivation";
import { operatingModuleStatus } from "../operatingModule";
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
type DXpeditionSnapshot = { generated_at: string; items: DXpeditionCatalogueItem[]; total_available: number; sources: SourceHealth[]; observations?: DXpeditionClusterSpot[]; history_state?: string; surface?: string };
type Locale = "en" | "it";
export const dxpeditionMapMethods = ["opportunities_dxpedition_snapshot", "opportunities_dxpedition_refresh"] as const;
const text = {
  en: { title: "DXpedition Map", all: "All", live: "Live", active: "Active", recent: "Recent", upcoming: "Upcoming",
    search: "Search callsign, alias or entity", refresh: "Refresh sources", details: "Operation details", observations: "Recent frequencies",
    noResults: "No expeditions match these filters.", loading: "Loading expedition catalogue and configured-cluster observations…", unavailable: "The expedition catalogue is unavailable. Refresh to try again.",
    outside: "Outside current filters", tune: "Tune & load", load: "Load callsign", unknown: "Unavailable", close: "Close details",
    onAir: "On air", idle: "Idle", entityUnavailable: "Entity unavailable", aliases: "Aliases", utcDates: "UTC dates", qsl: "QSL",
    radioTarget: "Radio target", position: "Position", clubLogTotal: "Club Log QSO total", qsoRate: "QSO/h", watchers: "Watchers",
    observedBands: "Observed band / mode", source: "Source", cluster: "Cluster", stale: "stale/unavailable", retained: "retained observations",
    shown: "shown", currentUpcoming: "current / upcoming", unmapped: "unmapped", noRadio: "No selected radio", selectedReceiver: "selected receiver",
    list: "DXpedition list", map: "Expedition map", statusFilter: "Status filter", bandFilter: "Observed band filter", inspect: "Inspect expedition", locations: "Catalogue and configured-cluster positions",
    history: "Your log", worked: "worked", confirmed: "confirmed", lastQSO: "Last QSO in Club Log", archive: "Spot history", archived: "History only — tuning unavailable",
    moduleBlocked: "Tune & load is available in Normal Logging. Use the contest Cluster or Band Map while Contesting.", checkingModule: "Checking operating mode…", catalogueOnly: "Announcement only — complete operating callsign not yet published", ended: "Operation ended — historical information only",
    currentSource: "current", staleSource: "stale", unavailableSource: "unavailable", publishedPosition: "Published catalogue position", clusterPosition: "Approximate cluster entity position", noPosition: "No published coordinates" },
  it: { title: "Mappa DXpedition", all: "Tutte", live: "Live", active: "Attive", recent: "Recenti", upcoming: "Future",
    search: "Cerca nominativo, alias o entità", refresh: "Aggiorna fonti", details: "Dettagli operazione", observations: "Frequenze recenti",
    noResults: "Nessuna spedizione corrisponde ai filtri.", loading: "Caricamento catalogo e osservazioni cluster configurate…", unavailable: "Il catalogo delle spedizioni non è disponibile. Aggiorna per riprovare.",
    outside: "Fuori dai filtri correnti", tune: "Sintonizza e carica", load: "Carica nominativo", unknown: "Non disponibile", close: "Chiudi dettagli",
    onAir: "In aria", idle: "Inattiva", entityUnavailable: "Entità non disponibile", aliases: "Alias", utcDates: "Date UTC", qsl: "QSL",
    radioTarget: "Radio selezionata", position: "Posizione", clubLogTotal: "QSO totali Club Log", qsoRate: "QSO/ora", watchers: "Osservatori",
    observedBands: "Banda / modo osservati", source: "Fonte", cluster: "Cluster", stale: "obsoleto/non disponibile", retained: "osservazioni conservate",
    shown: "mostrate", currentUpcoming: "correnti / future", unmapped: "senza mappa", noRadio: "Nessuna radio selezionata", selectedReceiver: "ricevitore selezionato",
    list: "Elenco DXpedition", map: "Mappa spedizioni", statusFilter: "Filtro stato", bandFilter: "Filtro banda osservata", inspect: "Esamina spedizione", locations: "Posizioni da catalogo e cluster configurato",
    history: "Il tuo log", worked: "collegati", confirmed: "confermati", lastQSO: "Ultimo QSO in Club Log", archive: "Storico spot", archived: "Solo storico — sintonia non disponibile",
    moduleBlocked: "Sintonia e caricamento disponibili in Normal Logging. In contest usa Cluster o Band Map del contest.", checkingModule: "Verifica modalità operativa…", catalogueOnly: "Solo annuncio — nominativo operativo completo non ancora pubblicato", ended: "Operazione terminata — solo informazioni storiche",
    currentSource: "corrente", staleSource: "obsoleta", unavailableSource: "non disponibile", publishedPosition: "Posizione pubblicata nel catalogo", clusterPosition: "Posizione approssimativa dell’entità dal cluster", noPosition: "Coordinate non pubblicate" },
} as const;
const statusFilters: DXpeditionStatusFilter[] = ["all", "live", "active", "recent", "upcoming"];

function verifiedSnapshot(value: unknown): DXpeditionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The expedition catalogue response could not be verified.");
  const snapshot = value as DXpeditionSnapshot;
  if (!Array.isArray(snapshot.items) || snapshot.items.length > 500 || !Array.isArray(snapshot.sources) || snapshot.observations !== undefined && (!Array.isArray(snapshot.observations) || snapshot.observations.length > 3840))
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

function statusLabel(status: DXpeditionOperation["status"], locale: Locale) {
  const t = text[locale];
  return status === "on_air" ? t.onAir : status === "idle" ? t.idle : t[status];
}

function sourceLabel(state: string, locale: Locale) {
  const t = text[locale];
  return state === "current" ? t.currentSource : state === "stale" ? t.staleSource : t.unavailableSource;
}

function positionLabel(source: string, locale: Locale) {
  const t = text[locale];
  return source === "Published catalogue position" ? t.publishedPosition
    : source === "Configured-cluster approximate entity position" ? t.clusterPosition : source || t.noPosition;
}

function radioTarget(context: ReturnType<typeof useMapContext>["context"], locale: Locale) {
  const t = text[locale];
  const selection = context?.selection;
  if (!selection || typeof selection !== "object") return t.noRadio;
  const provider = typeof selection.provider === "string" ? selection.provider.replaceAll("_", " ") : t.unknown;
  const id = typeof selection.radio_id === "string" ? selection.radio_id : typeof selection.selection_id === "string" ? selection.selection_id : t.selectedReceiver;
  return `${id} · ${provider}`;
}

function OperationCard({ operation, selected, now, locale, onSelect }: { operation: DXpeditionOperation; selected: boolean; now: Date; locale: Locale; onSelect: () => void }) {
  const latest = operation.observations[0];
  const t = text[locale];
  return <button type="button" className={`dxp-card status-${operation.status}${selected ? " is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
    <span className="dxp-card-head"><strong>{operation.primaryCall}</strong><span>{statusLabel(operation.status, locale)}</span></span>
    <span className="dxp-entity">{operation.entity || t.entityUnavailable}</span>
    {operation.aliases.length > 1 && <span className="dxp-aliases">{operation.aliases.slice(1).join(" · ")}</span>}
    <span className="dxp-card-foot">{latest ? `${(latest.frequencyHz / 1_000_000).toFixed(4)} MHz · ${latest.mode || "?"} · ${fmtAge(latest.reportedAt, now, locale)}` : `${fmtDate(operation.startsAt, locale)} – ${fmtDate(operation.endsAt, locale)}`}</span>
    {operation.qsoTotal !== null && <span className="dxp-card-foot">{operation.qsoTotal.toLocaleString()} QSO · Club Log{operation.enrichmentStale ? ` · ${t.staleSource}` : ""}</span>}
    {operation.history && <span className="dxp-card-foot">{t.history}: {operation.history.worked_count} {t.worked} · {operation.history.confirmed_count} {t.confirmed}</span>}
  </button>;
}

function Detail({ operation, shown, now, locale, radio, closeButtonRef, onClose, onTune, onLoad, tuning, loading, actionReason }: { operation: DXpeditionOperation; shown: boolean; now: Date; locale: Locale; radio: string; closeButtonRef: RefObject<HTMLButtonElement | null>; onClose: () => void; onTune: (spot: DXpeditionOperation["observations"][number]) => void; onLoad: () => void; tuning: boolean; loading: boolean; actionReason: string }) {
  const t = text[locale];
  const encoded = encodeURIComponent(operation.primaryCall);
  const links = [
    ["Club Log", `https://clublog.org/logsearch/${encoded}`],
    ["QRZ", `https://www.qrz.com/db/${encoded}`],
    ["DXWatch", `https://www.dxwatch.com/dxsd1/dxsd1.php?f=0&c=${encoded}`],
  ];
  const sourceURL = safeExternalURL(operation.sourceURL);
  return <aside className="dxp-detail" role="dialog" aria-label={`${t.details}: ${operation.primaryCall}`}>
    <button ref={closeButtonRef} type="button" className="dxp-close" onClick={onClose} aria-label={t.close}>×</button>
    {!shown && <p className="dxp-outside">{t.outside}</p>}
    <p className={`dxp-status status-${operation.status}`}>{statusLabel(operation.status, locale)}</p>
    <h2>{operation.primaryCall}</h2>
    <p className="dxp-detail-entity">{operation.entity || t.unknown}</p>
    {operation.aliases.length > 1 && <p><b>{t.aliases}</b><span>{operation.aliases.slice(1).join(", ")}</span></p>}
    <div className="dxp-facts"><p><b>{t.utcDates}</b><span>{fmtDate(operation.startsAt, locale)} – {fmtDate(operation.endsAt, locale)}</span></p>
      <p><b>{t.qsl}</b><span>{operation.qslRoute || t.unknown}</span></p><p><b>{t.radioTarget}</b><span>{radio}</span></p>
      <p><b>{t.position}</b><span>{positionLabel(operation.locationSource, locale)}</span></p><p><b>{t.clubLogTotal}</b><span>{operation.qsoTotal?.toLocaleString() ?? t.unknown}{operation.enrichmentStale && operation.qsoTotal !== null ? ` · ${t.staleSource}` : ""}</span></p>
      <p><b>{t.lastQSO}</b><span>{operation.lastQSO ? `${operation.lastQSO.toISOString().replace("T", " ").slice(0, 19)} UTC · ${fmtAge(operation.lastQSO, now, locale)}` : t.unknown}</span></p>
      <p><b>{t.qsoRate}</b><span>{t.unknown}</span></p><p><b>{t.watchers}</b><span>{t.unknown}</span></p></div>
    {operation.notes && <p className="dxp-notes">{operation.notes}</p>}
    <p className="dxp-notes">{operation.sources.join(" · ")}{operation.enrichmentAt ? ` · Club Log ${fmtAge(operation.enrichmentAt, now, locale)}` : ""}</p>
    <h3>{t.history}</h3><p>{operation.history ? `${operation.history.worked_count} ${t.worked} · ${operation.history.confirmed_count} ${t.confirmed}` : t.unknown}</p>
    {operation.history && <p className="dxp-notes">{t.worked}: {operation.history.worked_modes.join(" · ") || "—"}<br />{t.confirmed}: {operation.history.confirmed_modes.join(" · ") || "—"}</p>}
    {operation.dxccHistory && <p className="dxp-notes">DXCC {operation.dxccHistory.entity}<br />{t.worked}: {operation.dxccHistory.worked_modes.join(" · ") || "—"}<br />{t.confirmed}: {operation.dxccHistory.confirmed_modes.join(" · ") || "—"}</p>}
    {actionReason && <p className="dxp-action-reason" role="status">{actionReason}</p>}
    <h3>{t.observations}</h3>
    <div className="dxp-observations">{operation.observations.slice(0, 8).map((spot, index) => <div key={spot.id} className={index === 0 ? "is-latest" : ""}>
      <div><strong>{(spot.frequencyHz / 1_000_000).toFixed(6)} MHz</strong><span>{spot.band || "?"} · {spot.mode || "?"} · {fmtAge(spot.reportedAt, now, locale)}</span>
        <small>{spot.callsign}{spot.spotter ? ` · ${spot.spotter}` : ""}{spot.comment ? ` · ${spot.comment}` : ""}</small></div>
      <button type="button" title={!spot.activation ? t.archived : actionReason} disabled={tuning || !!actionReason || !spot.activation} onClick={() => onTune(spot)}>{spot.activation ? t.tune : t.archived}</button>
    </div>)}</div>
    {!operation.draftLoadAllowed && <p className="dxp-notes">{operation.endsAt && operation.endsAt < now ? t.ended : t.catalogueOnly}</p>}
    {!operation.observations.length && <button type="button" className="dxp-load-call" disabled={loading || !!actionReason || !operation.activation || !operation.draftLoadAllowed} onClick={onLoad}>{t.load}</button>}
    <h3>{t.observedBands}</h3><div className="dxp-band-grid">{["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"].map(band => <span key={band}><b>{band}</b>{[...(operation.bands.get(band) ?? [])].join(" · ") || "—"}</span>)}</div>
    <div className="dxp-links">{links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">{label}</a>)}{sourceURL && <a href={sourceURL} target="_blank" rel="noreferrer">{t.source}</a>}</div>
  </aside>;
}

export function DetachedDXpeditionMapSurface() {
  const [snapshot, setSnapshot] = useState<DXpeditionSnapshot | null>(null), [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [clock, setClock] = useState(() => new Date());
  const [moduleAllowed, setModuleAllowed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DXpeditionStatusFilter>(() => { const value = localStorage.getItem("xlog.dxpedition-map.status"); return statusFilters.includes(value as DXpeditionStatusFilter) ? value as DXpeditionStatusFilter : "all"; });
  const [band, setBand] = useState(() => { const value = localStorage.getItem("xlog.dxpedition-map.band"); return value === "all" || baselineDXpeditionBands.includes(value as typeof baselineDXpeditionBands[number]) ? value! : "all"; });
  const [query, setQuery] = useState(""), [selectedID, setSelectedID] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem("xlog.dxpedition-map.locale") === "it" ? "it" : "en");
  const readSequence = useRef(0), refreshSequence = useRef(0), completedRefresh = useRef(0);
  const active = useRef(true), refreshingRef = useRef(false), map = useMapContext();
  const searchRef = useRef<HTMLInputElement>(null), detailCloseRef = useRef<HTMLButtonElement>(null), selectionTriggerRef = useRef<HTMLElement | null>(null);
  const tune = useSpotActivation(), loadCall = useSpotActivation("activate_opportunity");
  const closeDetail = () => {
    setSelectedID(null);
    window.setTimeout(() => (selectionTriggerRef.current?.isConnected ? selectionTriggerRef.current : searchRef.current)?.focus(), 0);
  };
  const read = async () => {
    const order = ++readSequence.current, refreshAtStart = completedRefresh.current;
    const current = () => active.current && order === readSequence.current && refreshAtStart === completedRefresh.current;
    try { const value = await requestDXpeditionMap("opportunities_dxpedition_snapshot"); if (current()) { setSnapshot(value); setError(""); } }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "DXpedition Map is unavailable."); }
  };
  const refresh = async (automatic = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true; setRefreshing(true);
    const order = ++refreshSequence.current;
    // Cached reads may display immediately while a provider refresh is pending.
    // Focus reads cannot cancel that refresh, and late pre-refresh reads cannot
    // replace its completed result.
    try { const value = await requestDXpeditionMap("opportunities_dxpedition_refresh", { source: "all", automatic }); if (active.current && order === refreshSequence.current) { completedRefresh.current++; setSnapshot(value); setError(""); } }
    catch (cause) { if (active.current && order === refreshSequence.current) setError(cause instanceof Error ? cause.message : "Sources could not be refreshed; retained data remains visible."); }
    finally { if (order === refreshSequence.current) { refreshingRef.current = false; if (active.current) setRefreshing(false); } }
  };
  useEffect(() => {
    active.current = true; void read(); void refresh(true);
    const module = () => void operatingModuleStatus(true).then(value => { if (active.current) setModuleAllowed(value.selected === "normal_logging" && !value.transitioning); }).catch(() => { if (active.current) setModuleAllowed(null); });
    module();
    const moduleTimer = window.setInterval(module, 1500);
    const ages = window.setInterval(() => setClock(new Date()), 20_000);
    const sources = window.setInterval(() => void refresh(true), 90_000);
    const focus = () => { setClock(new Date()); void read(); map.refresh(); };
    window.addEventListener("focus", focus);
    return () => { active.current = false; readSequence.current++; refreshSequence.current++; refreshingRef.current = false; clearInterval(ages); clearInterval(sources); clearInterval(moduleTimer); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => { localStorage.setItem("xlog.dxpedition-map.status", status); localStorage.setItem("xlog.dxpedition-map.band", band); localStorage.setItem("xlog.dxpedition-map.locale", locale); }, [status, band, locale]);
  useEffect(() => {
    if (!selectedID) return;
    detailCloseRef.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeDetail(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selectedID]);
  const rawSpots = (map.context?.cluster.response?.contest_spots ?? []) as DXpeditionClusterSpot[];
  const operations = useMemo(() => buildDXpeditionOperations(snapshot?.items ?? [], [...(snapshot?.observations ?? []), ...rawSpots], clock), [snapshot, rawSpots, clock]);
  const filtered = useMemo(() => filterDXpeditionOperations(operations, status, band, query), [operations, status, band, query]);
  const selected = operations.find(item => item.id === selectedID) ?? null;
  const shown = !!selected && filtered.some(item => item.id === selected.id), t = text[locale];
  const counts = { live: operations.filter(item => item.status === "live").length, active: operations.filter(item => ["live", "active"].includes(item.status)).length,
    dx: operations.filter(item => item.status !== "upcoming").length };
  const sourceState = snapshot?.sources.filter(source => ["adxo", "425dxn", "clublog"].includes(source.source)) ?? [];
  const actionReason = moduleAllowed === null ? t.checkingModule : moduleAllowed ? "" : t.moduleBlocked;
  const selectOperation = (id: string) => {
    selectionTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedID(id);
  };
  return <div className="app live dxp-app"><main aria-label="DXpedition Map">
    <header className="dxp-header"><h1>{t.title}</h1>
      <div className="dxp-counts"><span><b>{counts.live}</b> {t.live}</span><span><b>{counts.active}</b> {t.active}</span><span><b>{counts.dx}</b> DX</span></div>
      <label className="dxp-search"><span className="sr-only">{t.search}</span><input ref={searchRef} type="search" placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" onClick={() => setLocale(value => value === "en" ? "it" : "en")}>{locale === "en" ? "IT" : "EN"}</button>
      <button type="button" onClick={() => void refresh(false)} disabled={refreshing}>{refreshing ? "…" : "↻"}<span className="sr-only">{t.refresh}</span></button></header>
    <div className="dxp-source-strip">{sourceState.map(source => <span key={source.source} className={`state-${source.state}`} title={source.safe_error || ""}>{source.source.toUpperCase()} · {sourceLabel(source.state, locale)} · {source.count}</span>)}
      <span>{t.cluster} · {map.stale ? t.stale : `${rawSpots.length} ${t.retained}`}</span><span>{t.archive} · {snapshot?.history_state === "ready" ? t.currentSource : t.unavailableSource}</span></div>
    <div className="dxp-toolbar"><div role="group" aria-label={t.statusFilter}>{statusFilters.map(value => <button type="button" aria-pressed={status === value} key={value} onClick={() => setStatus(value)}>{t[value]}</button>)}</div>
      <div className="dxp-bands" role="group" aria-label={t.bandFilter}><button type="button" aria-pressed={band === "all"} className={band === "all" ? "is-active" : ""} onClick={() => setBand("all")}>{t.all}</button>{baselineDXpeditionBands.map(value => <button type="button" aria-pressed={band === value} key={value} className={band === value ? "is-active" : ""} onClick={() => setBand(value)}>{value.replace("m", "")}</button>)}</div></div>
    <div className="dxp-body"><section className="dxp-list" aria-label={t.list}><p className="dxp-results">{filtered.length} {t.shown} · {operations.length} {t.currentUpcoming}{operations.filter(item => item.latitude === null).length ? ` · ${operations.filter(item => item.latitude === null).length} ${t.unmapped}` : ""}</p>
      {!snapshot && !error && <p className="dxp-empty">{t.loading}</p>}{!snapshot && error && <p className="dxp-empty">{t.unavailable}</p>}{snapshot && !filtered.length && <p className="dxp-empty">{t.noResults}</p>}
      {filtered.map(operation => <OperationCard key={operation.id} operation={operation} selected={operation.id === selectedID} now={clock} locale={locale} onSelect={() => selectOperation(operation.id)} />)}</section>
      <section className="dxp-map" aria-label={t.map}><WorldMap data={dxpeditionMapSpots(filtered)} selected={selectedID} onSpot={spot => selectOperation(spot.id)}
        compact persistenceKey="dxpedition-map" spotColorMode="status" expeditionLabels fitToDataKey={`${status}:${band}:${query}`}
        spotActionLabel={t.inspect} locationLabel={t.locations} /></section>
      {selected && <Detail operation={selected} shown={shown} now={clock} locale={locale} radio={radioTarget(map.context, locale)} closeButtonRef={detailCloseRef} onClose={closeDetail}
        tuning={tune.requesting} loading={loadCall.requesting} actionReason={actionReason}
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
