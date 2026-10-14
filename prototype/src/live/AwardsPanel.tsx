import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Award, BookOpen, CheckCircle2, Clock3, ExternalLink, Search, PanelsTopLeft } from "lucide-react";
import "./AwardsPanel.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Props = { request: Request; refresh: number; initialStats?: AwardsStats | null; onUndock?: () => void; onDock?: () => void; taskOnly?: boolean };
type Counts = Record<string, number>;
type AwardsStats = {
  qso_count: number; dxcc_worked: number; dxcc_confirmed: number;
  cq_zones_worked: number; cq_zones_confirmed: number;
  states_worked: number; states_confirmed: number;
  grids_worked: number; grids_confirmed: number;
  mode_counts: Counts; band_counts: Counts; continent_counts: Counts;
  achievements?: Achievement[];
};
type Achievement = { code: string; title: string; current: number; target: number; completed: boolean };
type Breakdown = { label: string; value: number; target?: number | null };
type RuleItem = { code: string; title: string; worked: number; current: number;
  sponsor_credited?: number | null; target: number; unit: string; detail: string; breakdowns: Breakdown[] };
type Source = { url?: string | null; ref?: string | null };
type Section = { title: string; text: string };
type RawProgramme = {
  id?: string; short_code?: string; name?: string; sponsor?: string;
  catalogue_group?: string; delivery_state: string; delivery_detail: string;
  progress_code?: string | null; scope_or_counting_focus?: string;
  research_sections?: Section[]; open_questions?: string[]; official_sources?: Source[];
  checked_on_utc?: string; record?: Record<string, any>;
};
type Programme = Required<Pick<RawProgramme, "id" | "name" | "sponsor" | "delivery_state" | "delivery_detail">> & {
  shortCode: string; group: string; progressCode: string | null; focus: string;
  sections: Section[]; questions: string[]; sources: Source[]; checkedOn: string;
};
type Catalogue = {
  reference_date: string; research_date: string; total_programmes: number; catalogue_total: number;
  offset: number; limit: number; programmes: RawProgramme[]; items: RuleItem[];
  delivery_counts?: Record<string, number>;
};

const deliveryLabels: Record<string, string> = {
  implemented: "Live calculation", trackingOnly: "Research tracking", blocked: "Blocked", historical: "Historical",
};
const deliveryIcons = { implemented: CheckCircle2, trackingOnly: BookOpen, blocked: AlertTriangle, historical: Clock3 };
const deliveryOptions = [["", "All states"], ["implemented", "Live calculations"], ["trackingOnly", "Research tracking"], ["blocked", "Blocked"], ["historical", "Historical"]] as const;
const groupOptions = [["", "All regions"], ["global", "Global"], ["europe", "Europe"], ["world", "World"], ["specialty", "Specialty"]] as const;
const modeOptions = [["", "All modes"], ["cw", "CW stated"], ["ssb", "SSB stated"], ["mixed", "Mixed stated"]] as const;
const roleOptions = [["", "All roles"], ["hunter", "Hunter stated"], ["activator", "Activator stated"]] as const;
const metricDefinitions = [
  { code: "DXCC", title: "Entities", worked: "dxcc_worked", confirmed: "dxcc_confirmed", target: 100 },
  { code: "WAZ", title: "CQ zones", worked: "cq_zones_worked", confirmed: "cq_zones_confirmed", target: 40 },
  { code: "WAS", title: "US states", worked: "states_worked", confirmed: "states_confirmed", target: 50 },
  { code: "GRID", title: "Four-character fields", worked: "grids_worked", confirmed: "grids_confirmed", target: null },
] as const;
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const words = (value: unknown): string => typeof value === "string" ? value : "";
const format = (value: unknown): string => number(value).toLocaleString();
const safeSourceURL = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
  catch { return null; }
};
function programmeFrom(raw: RawProgramme): Programme {
  const record = raw.record ?? {};
  const id = words(raw.id ?? record.id);
  return {
    id, name: words(raw.name ?? record.name), sponsor: words(raw.sponsor ?? record.sponsor),
    delivery_state: words(raw.delivery_state), delivery_detail: words(raw.delivery_detail),
    shortCode: words(raw.short_code) || words(raw.progress_code) || id.split(".").at(-1)?.toUpperCase() || "—",
    group: words(raw.catalogue_group ?? record.catalogue_group), progressCode: words(raw.progress_code) || null,
    focus: words(raw.scope_or_counting_focus ?? record.scope_or_counting_focus),
    sections: Array.isArray(raw.research_sections) ? raw.research_sections.filter((section) => typeof section?.title === "string" && typeof section?.text === "string") : [],
    questions: Array.isArray(raw.open_questions ?? record.open_questions) ? (raw.open_questions ?? record.open_questions).filter((item: unknown) => typeof item === "string") : [],
    sources: Array.isArray(raw.official_sources ?? record.official_sources) ? raw.official_sources ?? record.official_sources : [],
    checkedOn: words(raw.checked_on_utc ?? record.checked_on_utc),
  };
}

function ProgressBar({ value, target, label }: { value: number; target: number; label: string }) {
  const fraction = target > 0 ? Math.max(0, Math.min(100, value / target * 100)) : 0;
  return <div className="awards-progress-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={target}><span style={{ width: `${fraction}%` }} /></div>;
}

function ProgressOverview({ stats }: { stats: AwardsStats | null }) {
  return <section className="awards-section awards-progress-section" aria-label="Award progress"><h3>Award progress</h3>
    <div className="awards-metrics">{metricDefinitions.map(({ code, title, worked, confirmed, target }) => {
      const value = stats ? number(stats[worked]) : null;
      return <div className={`awards-metric awards-${code.toLowerCase()}`} key={code}><div className="awards-metric-heading"><strong>{code}</strong>{target && <small>/ {target}</small>}</div><b>{value === null ? "—" : format(value)}</b><span>{title} · {stats ? format(stats[confirmed]) : "—"} confirmed</span>{target && value !== null && <ProgressBar value={value} target={target} label={`${code} worked progress`} />}</div>;
    })}</div>
  </section>;
}

function RulePacks({ items }: { items: RuleItem[] }) {
  return <details className="awards-rules"><summary>Computed rule packs · {items.length}</summary>
    <div className="awards-rules-scroll"><table><thead><tr><th>Programme</th><th>Worked</th><th>Evidence-eligible</th><th>Target</th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><th scope="row">{item.title}</th><td>{format(item.worked)}</td><td>{format(item.current)}</td><td>{format(item.target)} {item.unit}</td></tr>)}</tbody></table></div>
    <p>These estimates use the native logbook award engine; sponsor credit requires separate evidence.</p>
  </details>;
}

function ProgrammeDetail({ programme, progress, researchDate, referenceDate }: {
  programme: Programme; progress: RuleItem | null; researchDate: string; referenceDate: string;
}) {
  const Icon = deliveryIcons[programme.delivery_state as keyof typeof deliveryIcons] ?? BookOpen;
  return <article className="awards-detail" aria-label={`${programme.name} detail`}>
    <div className="awards-detail-head"><div><h4>{programme.name}</h4><p>{programme.sponsor}</p></div><span className={`awards-delivery awards-delivery-${programme.delivery_state}`}><Icon size={14} />{deliveryLabels[programme.delivery_state] ?? programme.delivery_state}</span></div>
    {progress ? <div className="awards-detail-progress"><div className="awards-detail-value"><strong>{format(progress.current)}</strong><span>of {format(progress.target)} {progress.unit} evidence-eligible</span></div><ProgressBar value={number(progress.current)} target={number(progress.target)} label={`${programme.name} evidence-eligible progress`} /><div className="awards-evidence"><div><small>Worked</small><b>{format(progress.worked)}</b></div><div><small>Evidence-eligible</small><b>{format(progress.current)}</b></div><div><small>Sponsor-credited</small><b>{progress.sponsor_credited == null ? "Not imported" : format(progress.sponsor_credited)}</b></div></div><p>{progress.detail}</p>
      {progress.breakdowns?.length > 0 && <div className="awards-breakdown"><h5>Breakdown</h5><div>{progress.breakdowns.map((item) => <span key={item.label}><b>{item.label}</b><em>{format(item.value)}{item.target != null && ` / ${format(item.target)}`}</em></span>)}</div></div>}
    </div> : <p className="awards-no-result">No eligibility result is asserted for this programme.</p>}
    <p className="awards-delivery-detail">{programme.delivery_detail}</p>
    {programme.focus && <div className="awards-detail-block"><h5>Counting focus</h5><p>{programme.focus}</p></div>}
    {programme.sections.map((section) => <div className="awards-detail-block" key={section.title}><h5>{section.title}</h5><p>{section.text}</p></div>)}
    {programme.questions.length > 0 && <div className="awards-detail-block awards-questions"><h5>Open dependencies</h5><ul>{programme.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
    {programme.sources.length > 0 && <div className="awards-detail-block"><h5>Official sources</h5><ul>{programme.sources.map((source, index) => {
      const url = safeSourceURL(source.url);
      return <li key={`${source.url ?? source.ref}-${index}`}>{url ? <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{new URL(url).host}</a> : source.ref ? source.ref : "Source unavailable"}</li>;
    })}</ul></div>}
    <p className="awards-dates">Research reviewed {programme.checkedOn || researchDate || "date unavailable"}{progress && referenceDate ? ` · JARL data ${referenceDate}` : ""}</p>
  </article>;
}

function MixSection({ title, counts, limit }: { title: string; counts: Counts; limit?: number }) {
  const sorted = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const largest = Math.max(1, ...sorted.map(([, count]) => count));
  return <div className="awards-mix-section"><h4>{title}</h4>{sorted.length ? sorted.map(([name, count]) => <div className="awards-mix-row" key={name}><span>{name}</span><div aria-hidden="true"><i style={{ width: `${Math.max(2, count / largest * 100)}%` }} /></div><b>{format(count)}</b></div>) : <p>No contacts yet.</p>}</div>;
}

export function AwardsPanel({ request, refresh, initialStats, onUndock, onDock, taskOnly = false }: Props) {
  const [stats, setStats] = useState<AwardsStats | null>(initialStats ?? null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [delivery, setDelivery] = useState("");
  const [group, setGroup] = useState("");
  const [mode, setMode] = useState("");
  const [role, setRole] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedID, setSelectedID] = useState("");
  const [statsError, setStatsError] = useState("");
  const [catalogueError, setCatalogueError] = useState("");
  const [statsRetry, setStatsRetry] = useState(0);
  const [catalogueRetry, setCatalogueRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 5;

  useEffect(() => {
    const nextSearch = search.trim();
    if (nextSearch === debouncedSearch) return;
    const timer = window.setTimeout(() => { setOffset(0); setDebouncedSearch(nextSearch); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, debouncedSearch]);
  useEffect(() => {
    let active = true;
    setStatsError("");
    if (initialStats && statsRetry === 0) { setStats(initialStats); return; }
    void request("logbook_stats").then((value) => { if (active) setStats((value?.result ?? value)?.awards ?? null); })
      .catch(() => { if (active) setStatsError("Award totals are unavailable. Retry after opening the integrated logbook."); });
    return () => { active = false; };
  }, [request, refresh, statsRetry, initialStats]);
  useEffect(() => {
    let active = true;
    setLoading(true); setCatalogueError("");
    const params: Record<string, unknown> = { offset, limit: pageSize, search: debouncedSearch, delivery_state: delivery };
    if (group) params.catalogue_group = group;
    if (mode) params.mode_facet = mode;
    if (role) params.role_facet = role;
    void request("logbook_catalog", params).then((value) => { if (active) setCatalogue(value?.result ?? value); })
      .catch(() => { if (active) setCatalogueError("Awards library is unavailable. Check the worker and retry."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, refresh, offset, debouncedSearch, delivery, group, mode, role, catalogueRetry]);

  const programmes = useMemo(() => (catalogue?.programmes ?? []).map(programmeFrom), [catalogue]);
  const selected = programmes.find((programme) => programme.id === selectedID) ?? programmes[0];
  const itemsByCode = useMemo(() => new Map((catalogue?.items ?? []).map((item) => [item.code, item])), [catalogue]);
  const progress = selected?.progressCode ? itemsByCode.get(selected.progressCode) ?? null : null;
  const total = catalogue?.total_programmes ?? 0;
  const filtered = !!(search || delivery || group || mode || role);
  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setOffset(0); setSelectedID(""); };

  return <section className="awards-workspace" aria-label="Station intelligence">
    {!taskOnly && <header className="awards-page-head"><div><h2>Station intelligence</h2><p>Local award estimates and operating patterns.</p></div><div className="awards-window-actions"><span>LOCAL LOG · NOT AN AWARD APPLICATION</span>
      {onUndock && <button type="button" onClick={onUndock}><ExternalLink size={14} />Undock</button>}
      {onDock && <button type="button" onClick={onDock}><PanelsTopLeft size={14} />Dock back</button>}
    </div></header>}
    {statsError && <p className="awards-error" role="alert">{statsError} <button type="button" onClick={() => setStatsRetry((value) => value + 1)}>Retry totals</button></p>}
    <ProgressOverview stats={stats} />
    <section className="awards-section awards-library" aria-label="Awards library"><h3>Awards library</h3>
      {catalogue && <div className="awards-summary" aria-label="Awards library summary"><div><b>{format(catalogue.catalogue_total)}</b><span>Library</span></div>{deliveryOptions.slice(1).map(([key, label]) => <div key={key}><b className={`awards-summary-${key}`}>{catalogue.delivery_counts?.[key] == null ? "—" : format(catalogue.delivery_counts[key])}</b><span>{label.replace(" calculations", "").replace("Research ", "")}</span></div>)}</div>}
      <div className="awards-filters"><label className="awards-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search programmes</span><input value={search} maxLength={120} placeholder="Search programme, sponsor or rule focus" onChange={(event) => setSearch(event.target.value)} aria-label="Search programmes" /></label>
        <label><span className="sr-only">State</span><select aria-label="State" value={delivery} onChange={(event) => changeFilter(setDelivery, event.target.value)}>{deliveryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className="sr-only">Region</span><select aria-label="Region" value={group} onChange={(event) => changeFilter(setGroup, event.target.value)}>{groupOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className="sr-only">Mode</span><select aria-label="Mode" value={mode} onChange={(event) => changeFilter(setMode, event.target.value)}>{modeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className="sr-only">Role</span><select aria-label="Role" value={role} onChange={(event) => changeFilter(setRole, event.target.value)}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p className="awards-filter-note">Mode and role facets use only explicit wording in the reviewed source record.</p>
      {catalogueError && <p className="awards-error" role="alert">{catalogueError} <button type="button" onClick={() => setCatalogueRetry((value) => value + 1)}>Retry library</button></p>}
      {!catalogue && !catalogueError && <p className="awards-empty" role="status">Loading award programmes…</p>}
      {catalogue && <><div className="awards-browser"><div className="awards-list"><div className="awards-list-head"><strong>{format(total)} programmes</strong>{filtered && <button type="button" onClick={() => { setSearch(""); setDebouncedSearch(""); setDelivery(""); setGroup(""); setMode(""); setRole(""); setOffset(0); }}>Clear filters</button>}</div>
        {loading && <p className="awards-loading" role="status">Updating library…</p>}
        {!loading && programmes.length === 0 && <p className="awards-empty">{filtered ? "No award programmes match these filters." : "Award programmes are unavailable for this logbook."}</p>}
        <div className="awards-programmes">{programmes.map((programme) => {
          const Icon = deliveryIcons[programme.delivery_state as keyof typeof deliveryIcons] ?? BookOpen;
          const item = programme.progressCode ? itemsByCode.get(programme.progressCode) : null;
          return <button type="button" key={programme.id} aria-pressed={selected?.id === programme.id} aria-label={`${programme.name}, ${deliveryLabels[programme.delivery_state] ?? programme.delivery_state}`} onClick={() => setSelectedID(programme.id)}><Icon size={16} className={`awards-state-${programme.delivery_state}`} /><span className="awards-short-code">{programme.shortCode}</span><span className="awards-programme-name"><strong>{programme.name}</strong><small>{programme.sponsor}</small></span>{item && <span className="awards-programme-count">{format(item.current)} / {format(item.target)}</span>}</button>;
        })}</div>
        <div className="awards-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{total ? `${offset + 1}–${Math.min(offset + pageSize, total)} / ${format(total)}` : "0 programmes"}</span><button type="button" disabled={loading || offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Next</button></div>
      </div><div className="awards-detail-wrap" role="region" aria-label="Selected programme details" tabIndex={0}>{selected ? <ProgrammeDetail programme={selected} progress={progress} researchDate={catalogue.research_date} referenceDate={catalogue.reference_date} /> : <p className="awards-empty">Select a programme to inspect its evidence and research status.</p>}</div></div>
      <RulePacks items={catalogue.items ?? []} /></>}
    </section>
    <div className="awards-bottom"><section className="awards-section" aria-label="Operating mix"><h3>Operating mix</h3>{stats && stats.qso_count > 0 ? <div className="awards-mix"><MixSection title="Mode" counts={stats.mode_counts} /><MixSection title="Top bands" counts={stats.band_counts} limit={7} /><MixSection title="Continents" counts={stats.continent_counts} limit={7} /></div> : <p className="awards-empty">Mode and band summaries appear after the first contact.</p>}</section>
      <section className="awards-section" aria-label="Achievements"><h3>Achievements</h3>{stats?.achievements?.length ? <div className="awards-achievements">{stats.achievements.map((achievement) => <div className="awards-achievement" key={achievement.code}><Award size={17} className={achievement.completed ? "completed" : ""} /><div><div className="awards-achievement-head"><strong>{achievement.code}</strong><span>{achievement.title}</span><b>{format(achievement.current)} / {format(achievement.target)}</b></div><ProgressBar value={achievement.current} target={achievement.target} label={`${achievement.code} milestone`} /></div></div>)}</div> : <p className="awards-empty">Milestone details are unavailable.</p>}</section></div>
  </section>;
}

export default AwardsPanel;
