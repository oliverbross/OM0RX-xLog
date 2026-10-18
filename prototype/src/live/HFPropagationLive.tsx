import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, ExternalLink, RefreshCw, Settings2, Sun, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { bandFromFrequency, callsignContinent, cleanCall, cleanLocator, contestBands, continents, defaultPropagationSettings,
  hfOutlook, matrixCounts, mergeSpots, modeCounts, normalizedMode, ownGrid, parseDXHeat, parseForecastText, parseOwnWSPR,
  parsePSKReporter, parseWSPR, perMinuteSeries, propagationBands, propagationModes, propagationSources, readPropagationSettings,
  xrayClass, type Continent, type OwnWSPRSpot, type PropagationMode, type PropagationSettings, type PropagationSource,
  type PropagationSpot, type SolarConditions } from "./hfPropagationModel";
import "./HFPropagationLive.css";

type SourceState = { state: "idle" | "loading" | "ok" | "error" | "disabled"; count: number; detail: string };
type Transport = (source: string, parameters?: Record<string, unknown>) => Promise<string>;
type Props = { initialOwnCall?: string; initialLocator?: string; transport?: Transport; detached?: boolean };
const settingsKey = "xlog.hf-propagation.settings.v1", spotsKey = "xlog.hf-propagation.spots.v1", ownKey = "xlog.hf-propagation.own-wspr.v1";
const sourceNames: Record<PropagationSource | "swpc", string> = { wspr: "wspr.live", pskr: "PSK Reporter", rbn: "Reverse Beacon Network", cluster: "DX Cluster", swpc: "NOAA SWPC" };
const emptySources = (): Record<PropagationSource | "swpc", SourceState> => Object.fromEntries([...propagationSources, "swpc"].map(source => [source, { state: "idle", count: 0, detail: "Waiting" }])) as Record<PropagationSource | "swpc", SourceState>;
const emptySolar = (): SolarConditions => ({ sfi: null, ssn: null, aIndex: null, kp: null, xray: "—", solarWind: null, kpSeries: [], forecast: { geomagnetic: "Forecast unavailable.", radiation: "Forecast unavailable.", blackout: "Forecast unavailable." } });
const bandColors: Record<string, string> = { "2200m":"#64748b", "630m":"#5078c8", "160m":"#6d8ee8", "80m":"#44b9d2", "60m":"#45c4a6", "40m":"#39c979", "30m":"#9fc94d", "20m":"#e4bd46", "17m":"#e69d3f", "15m":"#ed7f45", "12m":"#ef6557", "10m":"#e95b66", "6m":"#cd68b8", "4m":"#a879dc", "2m":"#8a88e8", "70cm":"#92a7bf", "23cm":"#748ba4" };
const modeColors: Record<PropagationMode, string> = { CW:"#12d6a0", SSB:"#35c8f5", RTTY:"#f3b23c", FT4:"#a98ae8", FT8:"#ef77bd", WSPR:"#e1ca58", OTHER:"#6f8298" };

export async function nativeHFPropagationTransport(source: string, parameters: Record<string, unknown> = {}) {
  if (!isTauri()) throw new Error("Live propagation sources require the desktop app.");
  return invoke<string>("hf_propagation_fetch", { request: { source, ...parameters } });
}
function storedArray<T>(key: string): T[] { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function saveArray(key: string, value: unknown[]) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Live display remains usable if browser storage is full. */ } }
function number(value: unknown, field?: string): number | null {
  const raw = field && value && typeof value === "object" ? (value as Record<string, unknown>)[field] : value;
  const result = Number(raw); return Number.isFinite(result) ? result : null;
}
function latest<T>(value: unknown): T | null { return Array.isArray(value) && value.length ? value[value.length - 1] as T : null; }
function humanError(cause: unknown) { return cause instanceof Error ? cause.message : String(cause || "Source unavailable"); }
function formatUTC(time = Date.now()) { return new Date(time).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }); }
function bandLabel(key: string) { return propagationBands.find(band => band.key === key)?.label || key; }

export default function HFPropagationLive({ initialOwnCall = "", initialLocator = "", transport = nativeHFPropagationTransport, detached = false }: Props) {
  const [settings, setSettings] = useState<PropagationSettings>(() => {
    try { return readPropagationSettings(localStorage.getItem(settingsKey), initialOwnCall, initialLocator); }
    catch { return defaultPropagationSettings(initialOwnCall, initialLocator); }
  });
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [draft, setDraft] = useState(settings), [settingsOpen, setSettingsOpen] = useState(false);
  const [spots, setSpots] = useState<PropagationSpot[]>(() => storedArray<PropagationSpot>(spotsKey));
  const [ownSpots, setOwnSpots] = useState<OwnWSPRSpot[]>(() => storedArray<OwnWSPRSpot>(ownKey));
  const [solar, setSolar] = useState<SolarConditions>(emptySolar), [sources, setSources] = useState(emptySources);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [nextFetch, setNextFetch] = useState(0), [now, setNow] = useState(Date.now());
  const mounted = useRef(true), fetching = useRef(false), initial = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Keep current session settings. */ } }, [settings]);

  const updateSource = useCallback((source: PropagationSource | "swpc", value: Partial<SourceState>) => {
    if (mounted.current) setSources(current => ({ ...current, [source]: { ...current[source], ...value } }));
  }, []);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true; setLoading(true); setError("");
    const active = settingsRef.current, enabled = new Set(active.enabledSources), sinceSeconds = initial.current ? 3600 : 180;
    for (const source of propagationSources) updateSource(source, enabled.has(source) ? { state: "loading", detail: "Fetching…" } : { state: "disabled", count: 0, detail: "Disabled" });
    updateSource("swpc", { state: "loading", detail: "Fetching…" });
    const wsprBands = active.bands.flatMap(key => { const value = propagationBands.find(band => band.key === key)?.wspr; return value === null || value === undefined ? [] : [value]; });
    const jobs: Promise<void>[] = [];
    if (enabled.has("wspr") && wsprBands.length) jobs.push((async () => {
      try {
        const payload = JSON.parse(await transport("wspr", { sinceSeconds, bands: wsprBands })), incoming = parseWSPR(payload);
        if (!mounted.current) return; setSpots(current => { const next = mergeSpots(current, incoming); saveArray(spotsKey, next); return next; });
        const reportCount = incoming.reduce((sum, spot) => sum + (spot.count || 1), 0);
        updateSource("wspr", { state: "ok", count: reportCount, detail: `${reportCount.toLocaleString()} reports` });
      } catch (cause) { updateSource("wspr", { state: "error", detail: humanError(cause) }); }
      if (active.ownCall) try {
        const payload = JSON.parse(await transport("own_wspr", { sinceSeconds: initial.current ? 3600 : 180, bands: wsprBands, ownCall: active.ownCall }));
        const incoming = parseOwnWSPR(payload, active.ownCall);
        if (mounted.current) setOwnSpots(current => { const cutoff = Date.now() - 3_600_000, next = [...incoming, ...current].filter(item => item.time >= cutoff).filter((item, index, all) => all.findIndex(other => other.time === item.time && other.band === item.band && other.kind === item.kind && other.other === item.other) === index).slice(0, 12_000); saveArray(ownKey, next); return next; });
      } catch { /* Main WSPR source reports its own status; own-call is optional. */ }
    })());
    if (enabled.has("pskr")) jobs.push((async () => {
      try { const incoming = parsePSKReporter(await transport("pskr")); if (mounted.current) setSpots(current => { const next = mergeSpots(current, incoming); saveArray(spotsKey, next); return next; }); updateSource("pskr", { state: "ok", count: incoming.length, detail: `${incoming.length.toLocaleString()} reports` }); }
      catch (cause) { updateSource("pskr", { state: "error", detail: humanError(cause) }); }
    })());
    if (enabled.has("rbn") || enabled.has("cluster")) jobs.push((async () => {
      try {
        const parsed = parseDXHeat(JSON.parse(await transport("dxheat")));
        const incoming = [...(enabled.has("cluster") ? parsed.cluster : []), ...(enabled.has("rbn") ? parsed.rbn : [])];
        if (mounted.current) setSpots(current => { const next = mergeSpots(current, incoming); saveArray(spotsKey, next); return next; });
        if (enabled.has("cluster")) updateSource("cluster", { state: "ok", count: parsed.cluster.length, detail: `${parsed.cluster.length.toLocaleString()} spots` });
        if (enabled.has("rbn")) updateSource("rbn", { state: "ok", count: parsed.rbn.length, detail: `${parsed.rbn.length.toLocaleString()} CW/RTTY spots` });
      } catch (cause) { if (enabled.has("cluster")) updateSource("cluster", { state: "error", detail: humanError(cause) }); if (enabled.has("rbn")) updateSource("rbn", { state: "error", detail: humanError(cause) }); }
    })());
    jobs.push((async () => {
      const names = ["swpc_sfi", "swpc_kp", "swpc_wind", "swpc_xray", "swpc_ssn", "swpc_kp_forecast", "swpc_forecast"];
      const results = await Promise.allSettled(names.map(name => transport(name)));
      if (!mounted.current) return;
      setSolar(current => {
        const next = { ...current, forecast: { ...current.forecast } };
        const parsed = results.map(result => result.status === "fulfilled" ? (() => { try { return nameIsText(result.value) ? result.value : JSON.parse(result.value); } catch { return null; } })() : null);
        const flux = latest<Record<string, unknown>>(parsed[0]); next.sfi = number(flux, "flux") ?? next.sfi;
        const kp = latest<Record<string, unknown>>(parsed[1]); next.kp = number(kp, "Kp") ?? next.kp; next.aIndex = number(kp, "a_running") ?? next.aIndex;
        const wind = latest<Record<string, unknown>>(parsed[2]); next.solarWind = number(wind, "proton_speed") ?? next.solarWind;
        if (Array.isArray(parsed[3])) { const long = parsed[3].filter(item => item?.energy === "0.1-0.8nm").at(-1); const fluxValue = number(long, "flux"); if (fluxValue !== null) next.xray = xrayClass(fluxValue); }
        const sunspot = latest<Record<string, unknown>>(parsed[4]); next.ssn = number(sunspot, "ssn") ?? number(sunspot, "smoothed_ssn") ?? next.ssn;
        if (Array.isArray(parsed[5])) next.kpSeries = parsed[5].flatMap(item => { const time = Date.parse(`${item.time_tag}Z`), value = Number(item.kp); return Number.isFinite(time) && Number.isFinite(value) ? [{ time, kp: value, predicted: item.observed === "predicted" }] : []; });
        if (typeof parsed[6] === "string") next.forecast = parseForecastText(parsed[6]);
        return next;
      });
      const good = results.filter(result => result.status === "fulfilled").length;
      updateSource("swpc", good ? { state: "ok", count: good, detail: `${good}/7 products live` } : { state: "error", detail: "NOAA SWPC unavailable" });
    })());
    await Promise.allSettled(jobs);
    if (mounted.current) { setLoading(false); setNextFetch(Date.now() + 120_000); }
    initial.current = false; fetching.current = false;
  }, [transport, updateSource]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => { setNow(Date.now()); if (nextFetch && Date.now() >= nextFetch) void refresh(); }, 1000); return () => clearInterval(timer); }, [nextFetch, refresh]);

  const matrix = useMemo(() => matrixCounts(spots, settings, now), [spots, settings, now]);
  const activity = useMemo(() => perMinuteSeries(spots, settings, now), [spots, settings, now]);
  const ownActivity = useMemo(() => {
    const converted: PropagationSpot[] = ownSpots.map(item => ({ time: item.time, tx: item.kind === "tx" ? settings.ownCall : item.other, rx: item.kind === "rx" ? settings.ownCall : item.other,
      band: item.band, mode: "WSPR", source: "wspr", txContinent: item.kind === "tx" ? callsignContinent(settings.ownCall) : item.continent,
      rxContinent: item.kind === "rx" ? callsignContinent(settings.ownCall) : item.continent, distance: 0 }));
    return perMinuteSeries(converted, { ...settings, chartModes: ["WSPR"] }, now);
  }, [ownSpots, settings, now]);
  const modes = useMemo(() => modeCounts(spots, settings.bands, now), [spots, settings.bands, now]);
  const txGrid = useMemo(() => ownGrid(ownSpots, "tx", settings.bands, now), [ownSpots, settings.bands, now]);
  const rxGrid = useMemo(() => ownGrid(ownSpots, "rx", settings.bands, now), [ownSpots, settings.bands, now]);
  const outlook = hfOutlook(solar), hourCutoff = now - 3_600_000;
  const sourceCounts = Object.fromEntries(propagationSources.map(source => [source, spots.filter(spot => spot.source === source && spot.time >= hourCutoff).reduce((sum, spot) => sum + (spot.count || 1), 0)]));
  const recentSpotCount = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0);
  const countdown = nextFetch ? Math.max(0, Math.ceil((nextFetch - now) / 1000)) : 0;

  function applySettings() {
    const next = { ...draft, ownCall: cleanCall(draft.ownCall), locator: cleanLocator(draft.locator), bands: draft.mode === "CONTEST" ? [...contestBands] : draft.bands };
    try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { setError("Propagation settings could not be saved; this session will continue with them."); }
    setSettings(next); settingsRef.current = next; setSettingsOpen(false); initial.current = true; setNextFetch(0); void refresh();
  }
  return <section className={`hf-propagation-live${detached ? " is-detached" : ""}`} aria-label="HF Propagation live">
    <header className="hf-prop-header">
      <div><h1><Activity aria-hidden="true" />HF Propagation live</h1><p>Live worldwide activity and NOAA space-weather outlook · adapted from ConDX Now by OK1M</p></div>
      <div className="hf-prop-header-status"><span className="hf-prop-clock">{formatUTC(now)} UTC</span><span>{settings.mode}</span><span>{settings.ownCall || "Set own call"}{settings.locator ? ` · ${settings.locator}` : ""}</span><span>{recentSpotCount.toLocaleString()} spots / 1h</span><span>Next {countdown}s</span>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh propagation data"><RefreshCw size={15} className={loading ? "is-spinning" : ""} />Refresh</button>
        <button type="button" aria-expanded={settingsOpen} aria-controls="hf-prop-settings" onClick={() => { setDraft(settings); setSettingsOpen(value => !value); }}><Settings2 size={15} />Settings</button>
      </div>
    </header>
    {error && <div className="hf-prop-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {settingsOpen && <PropagationSettingsPanel value={draft} onChange={setDraft} onApply={applySettings} onClose={() => setSettingsOpen(false)} />}
    <div className="hf-prop-solar-strip" aria-label="Current solar conditions">
      <SolarMetric label="SFI" value={solar.sfi} hint="Solar flux" /><SolarMetric label="SN" value={solar.ssn} hint="Sunspot number" />
      <SolarMetric label="A" value={solar.aIndex} hint="Daily geomagnetic activity" /><SolarMetric label="Kp" value={solar.kp} hint="Current geomagnetic activity" />
      <SolarMetric label="X-ray" value={solar.xray} hint="Solar flare level" /><SolarMetric label="Wind" value={solar.solarWind === null ? null : `${Math.round(solar.solarWind)} km/s`} hint="Solar-wind speed" />
      <div className={`hf-prop-outlook is-${outlook.tone}`}><strong>{outlook.title}</strong><span>{outlook.detail}</span></div>
    </div>
    <div className="hf-prop-layout">
      <div className="hf-prop-column">
        <Panel title="Band × continent activity" meta="Last completed 10 minutes" controls={<ModeFilter values={settings.matrixModes} onChange={matrixModes => setSettings(current => ({ ...current, matrixModes }))} />}>
          <ActivityMatrix matrix={matrix} bands={settings.bands} home={callsignContinent(settings.ownCall)} />
        </Panel>
        <Panel title={`${settings.ownCall || "Own call"} WSPR activity`} meta="TX + RX · last 60 minutes · 5 minute reporting lag"><BandLineChart data={ownActivity} bands={settings.bands} /></Panel>
        <Panel title="Band activity" meta="All enabled sources · last 60 minutes · rolling 2 minute count" controls={<ModeFilter values={settings.chartModes} onChange={chartModes => setSettings(current => ({ ...current, chartModes }))} />}>
          <BandLineChart data={activity} bands={settings.bands} />
        </Panel>
      </div>
      <div className="hf-prop-column">
        <Panel title="NOAA SWPC outlook" meta="Observed + 3-day forecast" icon={<Sun size={16} />}>
          <KpChart points={solar.kpSeries} now={now} />
          <div className="hf-prop-forecast"><p><strong>Geomagnetic</strong>{solar.forecast.geomagnetic}</p><p><strong>Radiation</strong>{solar.forecast.radiation}</p><p><strong>Blackout</strong>{solar.forecast.blackout}</p></div>
          <details className="hf-prop-guide"><summary>How to read the solar numbers</summary><p><b>SFI/SN</b> indicate ionization support; higher values generally help upper HF bands. <b>Kp/A</b> describe geomagnetic disturbance; lower is quieter. <b>X-ray</b> levels M and X can produce daylight-side absorption. Solar wind above roughly 500 km/s can precede unsettled conditions.</p></details>
        </Panel>
        <Panel title={`${settings.ownCall || "Own call"} WSPR paths`} meta="Last 10 minutes · count and average SNR">
          <div className="hf-prop-own-grids"><OwnGrid title="TX · who hears me" grid={txGrid} bands={settings.bands} /><OwnGrid title="RX · stations heard" grid={rxGrid} bands={settings.bands} /></div>
        </Panel>
        <Panel title="Modes per band" meta="Last 60 minutes"><ModeBars values={modes} bands={settings.bands} /></Panel>
      </div>
    </div>
    <footer className="hf-prop-sources" aria-label="Propagation data sources">
      {[...propagationSources, "swpc" as const].map(source => <div key={source} className={`is-${sources[source].state}`} title={sources[source].detail}><i /><span>{sourceNames[source]}</span><strong>{source === "swpc" ? sources[source].detail : `${sourceCounts[source as PropagationSource]?.toLocaleString() || 0} / 1h`}</strong></div>)}
      <a href="https://git.ok1kvk.cz/RybkaLabs/condxnow" target="_blank" rel="noreferrer">ConDX Now project <ExternalLink size={13} /></a>
    </footer>
  </section>;
}

function nameIsText(value: string) { return !value.trimStart().startsWith("[") && !value.trimStart().startsWith("{"); }
function Panel({ title, meta, controls, icon, children }: { title: string; meta: string; controls?: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="hf-prop-panel"><header><div><h2>{icon}{title}</h2><p>{meta}</p></div>{controls}</header><div className="hf-prop-panel-body">{children}</div></section>;
}
function SolarMetric({ label, value, hint }: { label: string; value: string | number | null; hint: string }) { return <div className="hf-prop-solar-metric" title={hint}><span>{label}</span><strong>{value ?? "—"}</strong></div>; }
function ModeFilter({ values, onChange }: { values: PropagationMode[]; onChange: (value: PropagationMode[]) => void }) {
  const selected = new Set(values); return <div className="hf-prop-mode-filter" aria-label="Mode filter">{propagationModes.map(mode => <label key={mode}><input type="checkbox" checked={selected.has(mode)} onChange={event => onChange(event.target.checked ? [...values, mode] : values.filter(value => value !== mode))} />{mode}</label>)}</div>;
}
function ActivityMatrix({ matrix, bands, home }: { matrix: Record<string, Record<Continent, number>>; bands: string[]; home: Continent | null }) {
  const shown = [...bands].reverse(), peak = Math.max(1, ...shown.flatMap(band => continents.map(continent => matrix[band]?.[continent] || 0)));
  return <div className="hf-prop-table-wrap"><table className="hf-prop-matrix"><thead><tr><th>Band</th>{continents.map(continent => <th key={continent} className={continent === home ? "is-home" : ""}>{continent}{continent === home && <small>home</small>}</th>)}</tr></thead><tbody>{shown.map(band => <tr key={band}><th>{bandLabel(band)}</th>{continents.map(continent => { const count = matrix[band]?.[continent] || 0, intensity = count / peak; return <td key={continent} style={{ "--activity": intensity } as React.CSSProperties} className={count ? "has-activity" : ""}><span>{count || "—"}</span></td>; })}</tr>)}</tbody></table></div>;
}
function BandLineChart({ data, bands }: { data: { end: number; values: Record<string, number[]> }; bands: string[] }) {
  const visible = bands.filter(band => data.values[band]?.some(Boolean)), peak = Math.max(1, ...visible.flatMap(band => data.values[band] || []));
  const x = (index: number) => 42 + index / 59 * 586, y = (value: number) => 8 + 112 - value / peak * 112;
  return <div className="hf-prop-chart">{visible.length ? <><svg viewBox="0 0 640 148" role="img" aria-label="Activity by band over the last hour">
    {[0, .25, .5, .75, 1].map(step => <g key={step}><line x1="42" x2="628" y1={8 + step * 112} y2={8 + step * 112} /><text x="36" y={12 + step * 112} textAnchor="end">{Math.round(peak * (1 - step))}</text></g>)}
    {[0, 15, 30, 45, 59].map(index => <text key={index} x={x(index)} y="142" textAnchor={index === 0 ? "start" : index === 59 ? "end" : "middle"}>{new Date(data.end - (59 - index) * 60_000).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}</text>)}
    {visible.map(band => <polyline key={band} fill="none" stroke={bandColors[band] || "#92a7bf"} strokeWidth="2" points={data.values[band].map((value, index) => `${x(index)},${y(value)}`).join(" ")} />)}
  </svg><div className="hf-prop-legend">{visible.map(band => <span key={band}><i style={{ background: bandColors[band] }} />{bandLabel(band)}</span>)}</div></> : <Empty text="No matching reports in this time window." />}</div>;
}
function OwnGrid({ title, grid, bands }: { title: string; grid: ReturnType<typeof ownGrid>; bands: string[] }) {
  const shown = [...bands].reverse().filter(band => continents.some(continent => grid[band]?.[continent].count));
  return <div><h3>{title}</h3>{shown.length ? <div className="hf-prop-table-wrap"><table className="hf-prop-own-grid"><thead><tr><th>Band</th>{continents.map(continent => <th key={continent}>{continent}</th>)}</tr></thead><tbody>{shown.map(band => <tr key={band}><th>{bandLabel(band)}</th>{continents.map(continent => { const cell = grid[band][continent]; return <td key={continent}>{cell.count ? <><b>{cell.count}</b><span>{cell.average > 0 ? "+" : ""}{cell.average} dB</span></> : "—"}</td>; })}</tr>)}</tbody></table></div> : <Empty text="No own-call WSPR paths in the last 10 minutes." />}</div>;
}
function ModeBars({ values, bands }: { values: ReturnType<typeof modeCounts>; bands: string[] }) {
  return <div className="hf-prop-mode-bars"><div className="hf-prop-legend">{propagationModes.map(mode => <span key={mode}><i style={{ background: modeColors[mode] }} />{mode}</span>)}</div>{[...bands].reverse().map(band => { const total = propagationModes.reduce((sum, mode) => sum + (values[band]?.[mode] || 0), 0); return <div className="hf-prop-mode-row" key={band}><b>{bandLabel(band)}</b><div>{total ? propagationModes.map(mode => values[band][mode] ? <i key={mode} title={`${mode}: ${values[band][mode]}`} style={{ width: `${values[band][mode] / total * 100}%`, background: modeColors[mode] }} /> : null) : null}</div><span>{total.toLocaleString()}</span></div>; })}</div>;
}
function KpChart({ points, now }: { points: SolarConditions["kpSeries"]; now: number }) {
  const start = now - 3 * 86_400_000, end = now + 3 * 86_400_000, shown = points.filter(point => point.time >= start && point.time <= end), x = (time: number) => 28 + (time - start) / (end - start) * 592, y = (kp: number) => 8 + (9 - Math.min(9, Math.max(0, kp))) / 9 * 112;
  const groups = [shown.filter(point => !point.predicted), shown.filter(point => point.predicted)];
  return <div className="hf-prop-kp-chart">{shown.length ? <svg viewBox="0 0 640 142" role="img" aria-label="NOAA Kp observed and forecast chart">
    <rect x="28" y={y(4)} width="592" height={y(0)-y(4)} className="quiet" /><rect x="28" y={y(6)} width="592" height={y(4)-y(6)} className="unsettled" /><rect x="28" y={y(9)} width="592" height={y(6)-y(9)} className="storm" />
    {[0,3,5,7,9].map(value => <g key={value}><line x1="28" x2="620" y1={y(value)} y2={y(value)} /><text x="22" y={y(value)+4} textAnchor="end">{value}</text></g>)}
    <line className="now" x1={x(now)} x2={x(now)} y1="8" y2="120" />
    {groups.map((group, index) => <polyline key={index} className={index ? "forecast" : "observed"} fill="none" points={group.map(point => `${x(point.time)},${y(point.kp)}`).join(" ")} />)}
    <text x="28" y="138">−3 days</text><text x={x(now)} y="138" textAnchor="middle">Now</text><text x="620" y="138" textAnchor="end">+3 days</text>
  </svg> : <Empty text="NOAA Kp history and forecast have not loaded yet." />}</div>;
}
function Empty({ text }: { text: string }) { return <div className="hf-prop-empty" role="status">{text}</div>; }

function PropagationSettingsPanel({ value, onChange, onApply, onClose }: { value: PropagationSettings; onChange: (value: PropagationSettings) => void; onApply: () => void; onClose: () => void }) {
  const bands = new Set(value.bands), sources = new Set(value.enabledSources);
  return <section id="hf-prop-settings" className="hf-prop-settings" aria-label="HF propagation settings"><header><div><h2>HF propagation settings</h2><p>These settings affect only this dashboard and never radio or rotor control.</p></div><button type="button" onClick={onClose} aria-label="Close settings"><X size={16} /></button></header>
    <div className="hf-prop-settings-grid"><label>Operating view<select value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as "DX" | "CONTEST", bands: event.target.value === "CONTEST" ? [...contestBands] : value.bands })}><option value="DX">DX</option><option value="CONTEST">Contest</option></select></label>
      <label>Own callsign<input value={value.ownCall} placeholder="OM0RX" onChange={event => onChange({ ...value, ownCall: event.target.value })} /></label>
      <label>Home locator<input value={value.locator} placeholder="JN88TQ" onChange={event => onChange({ ...value, locator: event.target.value })} /></label></div>
    <fieldset><legend>Live sources</legend><div className="hf-prop-chip-grid">{propagationSources.map(source => <label key={source}><input type="checkbox" checked={sources.has(source)} onChange={event => onChange({ ...value, enabledSources: event.target.checked ? [...value.enabledSources, source] : value.enabledSources.filter(item => item !== source) })} />{sourceNames[source]}</label>)}</div></fieldset>
    <fieldset disabled={value.mode === "CONTEST"}><legend>Bands {value.mode === "CONTEST" && <small>Contest view uses 160, 80, 40, 20, 15 and 10 metres.</small>}</legend><div className="hf-prop-chip-grid is-bands">{propagationBands.map(band => <label key={band.key}><input type="checkbox" checked={bands.has(band.key)} onChange={event => onChange({ ...value, bands: event.target.checked ? [...value.bands, band.key] : value.bands.filter(item => item !== band.key) })} />{band.label}</label>)}</div></fieldset>
    <div className="hf-prop-settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={onApply} disabled={!value.bands.length || !value.enabledSources.length}>Apply and refresh</button></div>
  </section>;
}
