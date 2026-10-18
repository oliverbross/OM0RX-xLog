import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clusterRowTint, clusterSpotTags, type ClusterPalette, type LiveClusterSpot } from "./ClusterPanel";
import { clusterFilterChoices, defaultClusterFilter, type ClusterFilter } from "./clusterFilters";
import { BandMapsToolbarContext } from "./BandMaps";
import { clusterBandColors, clusterModeColors, clusterStatusCode, clusterStatusColors, paletteColor, specialTagColors } from "./clusterPalette";
import { boundColumnWidth, compactClusterColumns, compactClusterHeader, defaultWorkspacePreferences, operatorWorkspaceKey, readWorkspacePreferences, splitBounds,
  type CompactColumn, type WorkspacePreferences } from "./operatorWorkspacePreferences";
import { formatSpotAge, spotAgeColor, useSpotAgeClock } from "./spotAge";
import { countryDisplay } from "./countryDisplay";
import SpecialFilterOptions from "./SpecialFilterOptions";
import "./OperatorWorkspace.css";

export type OperatorWorkspaceProps = { map: ReactNode; bandMaps: ReactNode; cluster: unknown;
  onSelect: (spot: LiveClusterSpot) => void; onRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  selectedSpotId?: string | null; palette?: ClusterPalette };
type ClusterProjection = { snapshot?: { spots?: LiveClusterSpot[]; connectedClusters?: number; connections?: { serverName: string; phase: string; error?: string | null }[] };
  configuration?: { palette?: ClusterPalette; filter?: ClusterFilter; specialRules?: { name: string; enabled: boolean }[] } };
const filterSections: Array<[keyof Pick<ClusterFilter, "bands" | "modes" | "continents" | "spotterContinents" | "callStatuses" | "dxccStatuses" | "specials" | "sources" | "worked">, string]> = [
  ["bands", "Bands"], ["modes", "Modes"], ["continents", "DX continent"], ["spotterContinents", "Spotter continent"], ["callStatuses", "Call status"],
  ["dxccStatuses", "DXCC status"], ["specials", "Special"], ["sources", "Source"], ["worked", "Worked"],
];
const spotTags = (spot: LiveClusterSpot): string[] => clusterSpotTags(spot);
function spotText(column: CompactColumn, spot: LiveClusterSpot, now: number): string {
  switch (column) {
    case "time": return formatSpotAge(spot.receivedAt, now);
    case "frequency": return (spot.frequencyKHz / 1000).toFixed(6);
    case "cq": return String(spot.cqZone ?? "—");
    case "country": return countryDisplay(spot.country);
    case "spotter": return `${spot.spotter}${spot.aggregateCount > 1 ? ` +${spot.aggregateCount - 1}` : ""}`;
    case "special": return spotTags(spot).length ? spotTags(spot).join(" · ") : "—";
    case "workedBefore": return spot.workedBefore == null ? "—" : `✓ ${new Date((spot.workedBefore + 978307200) * 1000).toLocaleString()}`;
    default: return String(spot[column] || "—");
  }
}
function cell(column: CompactColumn, spot: LiveClusterSpot, now: number, palette?: ClusterPalette): ReactNode {
  if (column === "time") return <span className="live-cluster-age live-cluster-age-strip" style={{ backgroundColor: spotAgeColor(spot.receivedAt, now) }}>{spotText(column, spot, now)}</span>;
  if (column === "band" || column === "mode") return <span className="live-cluster-category" style={{ color: paletteColor(spot[column], palette?.[column], column === "band" ? clusterBandColors : clusterModeColors) }}>{spot[column]}</span>;
  if (column === "callStatus" || column === "dxccStatus") return <span className="live-cluster-status" style={{ color: paletteColor(spot[column], palette?.status, clusterStatusColors) }}>{clusterStatusCode(spot[column])}</span>;
  if (column === "score") return <span className={`live-cluster-score ${spot.score >= 80 ? "priority" : spot.score >= 55 ? "high" : spot.score >= 30 ? "medium" : "low"}`}>{spot.score}</span>;
  if (column === "special") return spotTags(spot).length ? spotTags(spot).slice(0, 2).map(tag => <span key={tag} className="live-cluster-special-tag" style={specialTagColors(tag)}>{tag}</span>) : "—";
  return spotText(column, spot, now);
}

export function OperatorWorkspace({ map, bandMaps, cluster, onSelect, onRequest, selectedSpotId, palette }: OperatorWorkspaceProps) {
  const ageClock = useSpotAgeClock();
  const [preferences, setPreferences] = useState<WorkspacePreferences>(() => {
    try { return readWorkspacePreferences(window.localStorage.getItem(operatorWorkspaceKey)); } catch { return defaultWorkspacePreferences(); }
  });
  const [width, setWidth] = useState(0), [clusterHeight, setClusterHeight] = useState(0);
  const [bandToolbarHost, setBandToolbarHost] = useState<HTMLDivElement | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false), [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState<ClusterFilter>(defaultClusterFilter), [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(0), [columnPage, setColumnPage] = useState(0);
  const root = useRef<HTMLDivElement>(null), clusterPane = useRef<HTMLDivElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null), filterSearch = useRef<HTMLInputElement>(null), filterVersion = useRef(0);
  const id = useId();
  const drag = useRef<{ kind: "split" | CompactColumn; startX: number; startWidth: number; total: number; pixels: number } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem(operatorWorkspaceKey, JSON.stringify(preferences)); } catch { /* Restricted storage: keep this session usable. */ }
  }, [preferences]);
  useEffect(() => {
    const measure = () => { setWidth(root.current?.getBoundingClientRect().width ?? 0); setClusterHeight(clusterPane.current?.getBoundingClientRect().height ?? 0); };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (clusterPane.current) observer.observe(clusterPane.current);
    return () => observer.disconnect();
  }, [preferences.activeTab]);
  const bounds = splitBounds(width);
  const percent = Math.max(bounds.min, Math.min(bounds.max, preferences.mapPercent));
  const projection = cluster as ClusterProjection | null;
  const remoteFilter = projection?.configuration?.filter;
  const spots = Array.isArray(projection?.snapshot?.spots) ? projection.snapshot.spots : [];
  const colors = palette ?? projection?.configuration?.palette;
  const rows = Math.max(1, Math.min(50, Math.floor((clusterHeight - 68) / 28) || 1));
  const columnRows = Math.max(1, Math.min(7, Math.floor((clusterHeight - 93) / 26) || 1)), columnPageSize = columnRows * 2;
  const columnPages = Math.ceil(compactClusterColumns.length / columnPageSize), currentColumnPage = Math.min(columnPage, columnPages - 1);
  const pages = Math.max(1, Math.ceil(spots.length / rows)), currentPage = Math.min(page, pages - 1), offset = currentPage * rows;
  const totalWidth = preferences.columns.reduce((sum, column) => sum + preferences.widths[column], 0);
  useEffect(() => { if (remoteFilter) setFilter(remoteFilter); }, [remoteFilter]);
  useEffect(() => {
    if (!filtersOpen) return;
    filterSearch.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setFiltersOpen(false); filtersButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [filtersOpen]);
  const changeFilter = (next: ClusterFilter) => {
    setFilter(next); setFilterError(""); setPage(0);
    if (!onRequest) return;
    const version = ++filterVersion.current;
    void onRequest("cluster_filter", { filter: next }).then(raw => {
      const accepted = (raw as ClusterProjection | null)?.configuration?.filter;
      if (version === filterVersion.current && accepted) setFilter(accepted);
    }).catch(() => { if (version === filterVersion.current) setFilterError("Could not apply cluster filters."); });
  };
  const closeFilters = () => { setFiltersOpen(false); window.requestAnimationFrame(() => filtersButton.current?.focus()); };
  const specialChoices = ["RBN", ...(projection?.configuration?.specialRules?.filter(rule => rule.enabled && rule.name.toUpperCase() !== "RBN").map(rule => rule.name) ?? [])];
  const choices = { ...clusterFilterChoices, specials: specialChoices };
  const setSplit = (value: number) => setPreferences(current => ({ ...current, mapPercent: Math.max(bounds.min, Math.min(bounds.max, value)) }));
  const setColumnWidth = (column: CompactColumn, value: number) => {
    if (!Number.isFinite(value)) return;
    setPreferences(current => ({ ...current, widths: { ...current.widths, [column]: boundColumnWidth(value) } }));
  };
  const move = (clientX: number) => {
    const current = drag.current; if (!current) return;
    if (current.kind === "split") { if (width > 740) setSplit((clientX - (root.current?.getBoundingClientRect().left ?? 0)) / (width - 10) * 100); }
    else {
      const fraction = Math.max(0.01, Math.min(0.99, (current.startWidth / current.total * current.pixels + clientX - current.startX) / current.pixels));
      if (current.total > current.startWidth) setColumnWidth(current.kind, fraction * (current.total - current.startWidth) / (1 - fraction));
    }
  };
  return <div className={`operator-workspace${width > 0 && width <= 740 ? " is-stacked" : ""}`} ref={root} style={{ "--operator-map-share": `${percent}%` } as CSSProperties}>
    <div className="operator-map-pane">{map}</div>
    <div className="operator-pane-divider" role="separator" aria-label="Map and tools width" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(percent)} aria-valuetext={`${Math.round(percent)}% map`}
      onKeyDown={event => { const value = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : event.key === "ArrowLeft" ? percent - 2 : event.key === "ArrowRight" ? percent + 2 : null;
        if (value != null) { event.preventDefault(); setSplit(value); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { kind: "split", startX: event.clientX, startWidth: 0, total: 0, pixels: 0 }; event.currentTarget.setPointerCapture?.(event.pointerId); move(event.clientX); }}
      onPointerMove={event => move(event.clientX)} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    <div className="operator-tools-pane">
      <div className="operator-tool-toolbar"><div className="operator-tool-tabs" role="tablist" aria-label="Operator tools">{(["band-maps", "cluster"] as const).map(tab => <button key={tab} type="button" role="tab"
        id={`${id}-${tab}-tab`} aria-selected={preferences.activeTab === tab} aria-controls={`${id}-${tab}`} tabIndex={preferences.activeTab === tab ? 0 : -1}
        onClick={() => setPreferences(current => ({ ...current, activeTab: tab }))}
        onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
          const next = event.key === "Home" ? "band-maps" : event.key === "End" ? "cluster" : tab === "cluster" ? "band-maps" : "cluster";
          setPreferences(current => ({ ...current, activeTab: next })); document.getElementById(`${id}-${next}-tab`)?.focus(); }}>{tab === "band-maps" ? "Band maps" : "Cluster"}</button>)}</div>
        <div ref={setBandToolbarHost} className="operator-band-map-toolbar" hidden={preferences.activeTab !== "band-maps"} />
        <div className="operator-cluster-toolbar" hidden={preferences.activeTab !== "cluster"}>
          <div className="operator-cluster-connections" role="status" aria-label="Compact cluster connections">{projection?.snapshot?.connections?.length ? projection.snapshot.connections.map((connection, index) => {
            const phase = connection.phase.toLowerCase(), label = phase.charAt(0).toUpperCase() + phase.slice(1);
            return <span key={`${connection.serverName}-${index}`} className={`operator-cluster-connection ${phase === "connected" ? "is-connected" : ["disconnected", "failed"].includes(phase) ? "is-disconnected" : "is-connecting"}`}>
              {connection.serverName} · {label}{connection.error && <small> · {connection.error}</small>}</span>;
          }) : <span className={`operator-cluster-connection ${projection?.snapshot ? projection.snapshot.connectedClusters ? "is-connected" : "is-disconnected" : "is-connecting"}`}>{projection?.snapshot ? projection.snapshot.connectedClusters ? `${projection.snapshot.connectedClusters} connected` : "Disconnected" : "Awaiting live cluster state"}</span>}</div>
          <button ref={filtersButton} type="button" aria-expanded={filtersOpen} aria-controls={`${id}-filters`}
            disabled={!onRequest || !remoteFilter} onClick={() => { setColumnsOpen(false); setFiltersOpen(true); }}>Filters</button>
          <button type="button" aria-expanded={columnsOpen} aria-controls={`${id}-columns`} onClick={() => { setFiltersOpen(false); setColumnsOpen(value => !value); }}>Columns</button>
        </div>
      </div>
      {filtersOpen && <div className="operator-filter-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeFilters(); }}>
        <section id={`${id}-filters`} className="operator-filter-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-filters-title`}>
          <header><h2 id={`${id}-filters-title`}>Cluster filters</h2><button type="button" onClick={closeFilters}>Done</button></header>
          {filterError && <p className="operator-filter-error" role="alert">{filterError}</p>}
          <div className="operator-filter-primary">
            <label>Search spots<input ref={filterSearch} placeholder="Callsign, country or note" value={filter.query} maxLength={128}
              onChange={event => changeFilter({ ...filter, query: event.target.value })} /></label>
            <label>Sort spots<select value={filter.sort} onChange={event => changeFilter({ ...filter, sort: event.target.value })}>
              <option value="newest">Newest</option><option value="score">Score</option><option value="frequency">Frequency</option><option value="callsign">Callsign</option>
            </select></label>
          </div>
          <div className="operator-filter-sections">{filterSections.map(([key, label]) => {
            const values = choices[key] as readonly string[], selected = filter[key];
            return <fieldset key={key} data-filter={key}><legend>{label}</legend>
              {key === "specials" && values.length ? <SpecialFilterOptions filter={filter} options={values} onChange={changeFilter} />
                : values.length ? <div>{values.map(option => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={event => {
                const next = event.target.checked ? [...selected, option] : selected.filter(value => value !== option);
                changeFilter({ ...filter, [key]: next });
              }} />{option === "rbl" ? "RBN / Skimmer" : option === "cluster" ? "DX Cluster" : option}</label>)}</div>
                : <p>No configured choices.</p>}
            </fieldset>;
          })}</div>
          <footer><button type="button" onClick={() => changeFilter(defaultClusterFilter())}>Clear filters</button></footer>
        </section>
      </div>}
      <div id={`${id}-band-maps`} role="tabpanel" aria-labelledby={`${id}-band-maps-tab`} className="operator-tool-content" hidden={preferences.activeTab !== "band-maps"}><BandMapsToolbarContext.Provider value={bandToolbarHost}>{bandMaps}</BandMapsToolbarContext.Provider></div>
      <div id={`${id}-cluster`} role="tabpanel" aria-labelledby={`${id}-cluster-tab`} className="operator-tool-content operator-compact-cluster" ref={clusterPane} hidden={preferences.activeTab !== "cluster"}>
        <div id={`${id}-columns`} className="operator-column-settings" hidden={!columnsOpen}>
          <p>Preferred widths scale to fit. Drag a header edge or use its arrow keys.</p>
          <div>{compactClusterColumns.slice(currentColumnPage * columnPageSize, (currentColumnPage + 1) * columnPageSize).map(([column, label]) => <label key={column}><input type="checkbox" aria-label={`Show ${label} column`} checked={preferences.columns.includes(column)} disabled={preferences.columns.length === 1 && preferences.columns.includes(column)}
            onChange={event => { const checked = event.target.checked; setPreferences(current => ({ ...current, columns: compactClusterColumns.map(([value]) => value).filter(value => value === column ? checked : current.columns.includes(value)) })); }} />
            <span title={label}>{label}</span><input key={`${column}-${preferences.widths[column]}`} type="number" aria-label={`${label} preferred width`} min={48} max={480} defaultValue={preferences.widths[column]}
              onBlur={event => { const value = event.target.value ? Number(event.target.value) : preferences.widths[column]; setColumnWidth(column, value); event.target.value = String(Number.isFinite(value) ? boundColumnWidth(value) : preferences.widths[column]); }}
              onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}</div>
          <nav aria-label="Column settings pages"><button type="button" disabled={currentColumnPage === 0} aria-label="Previous column settings page" onClick={() => setColumnPage(currentColumnPage - 1)}>‹</button>
            <span>{currentColumnPage + 1} / {columnPages}</span><button type="button" disabled={currentColumnPage + 1 >= columnPages} aria-label="Next column settings page" onClick={() => setColumnPage(currentColumnPage + 1)}>›</button>
            <button type="button" onClick={() => { const defaults = defaultWorkspacePreferences(); setPreferences(current => ({ ...current, columns: defaults.columns, widths: defaults.widths })); }}>Reset columns and widths</button></nav>
        </div>
        <div className="operator-compact-table" hidden={columnsOpen}><table aria-label="Compact live cluster"><colgroup>{preferences.columns.map(column => <col key={column} style={{ width: `${preferences.widths[column] / totalWidth * 100}%` }} />)}</colgroup>
          <thead><tr>{preferences.columns.map(column => { const label = compactClusterColumns.find(([value]) => value === column)![1]; return <th key={column} aria-label={column === "callStatus" || column === "dxccStatus" ? label : undefined}
            className={column === "callStatus" || column === "dxccStatus" ? "live-cluster-status-column" : undefined}><span title={label}>{compactClusterHeader(column)}</span>
            <span role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${compactClusterColumns.find(([value]) => value === column)![1]} column`} aria-valuemin={48} aria-valuemax={480} aria-valuenow={preferences.widths[column]}
              onKeyDown={event => { const value = event.key === "Home" ? 48 : event.key === "End" ? 480 : event.key === "ArrowLeft" ? preferences.widths[column] - 8 : event.key === "ArrowRight" ? preferences.widths[column] + 8 : null;
                if (value != null) { event.preventDefault(); setColumnWidth(column, value); } }}
              onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { kind: column, startX: event.clientX, startWidth: preferences.widths[column], total: totalWidth, pixels: event.currentTarget.closest("table")?.getBoundingClientRect().width || 1 }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
              onPointerMove={event => move(event.clientX)} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} /></th>; })}</tr></thead>
          <tbody>{spots.slice(offset, offset + rows).map(spot => <tr key={spot.id} tabIndex={0} aria-selected={selectedSpotId === spot.id} aria-label={`Select ${spot.callsign} at ${(spot.frequencyKHz / 1000).toFixed(6)} MHz`} style={{ backgroundColor: selectedSpotId === spot.id ? undefined : clusterRowTint(spot.dxccStatus, colors?.status) }}
            onClick={() => onSelect(spot)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(spot); } }}>
            {preferences.columns.map(column => <td key={column} title={spotText(column, spot, ageClock)} className={column === "frequency" ? "cyan mono" : column === "callsign" ? "live-cluster-call" : column === "callStatus" || column === "dxccStatus" ? "live-cluster-status-column" : ""}>{cell(column, spot, ageClock, colors)}</td>)}</tr>)}</tbody></table>
          {!spots.length && <p className="operator-cluster-empty">{projection?.snapshot ? "No spots in the current live cluster view." : "Awaiting live cluster state."}</p>}
        </div>
        <footer hidden={columnsOpen}><button type="button" aria-label="Previous spots page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button>
          <span>{spots.length ? `${offset + 1}–${Math.min(offset + rows, spots.length)} of ${spots.length}` : "0 spots"}</span>
          <button type="button" aria-label="Next spots page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>›</button></footer>
      </div>
    </div>
  </div>;
}
