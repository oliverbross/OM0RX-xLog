import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogbookFilterBuilder } from "./LogbookFilterBuilder";
import { LogbookSavedFilters } from "./LogbookSavedFilters";
import { emptyLogbookQuery, type LogbookQuery } from "./logbookQuery";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Evidence = { id: string; call: string; start: number; band: string; mode: string; paper: string; lotw: string; reason: string; recordedContext?:string; recordedGrid?:string; recordedLocation?:string };
type ActivationCandidate = { day:string;physicalRows:number;countableContacts:number;programmeLogRecords:number;duplicateProgrammeRecords:number;unknownEligibilityRows:number;excludedRows:number;threshold:number;candidateStatus:string;reasons:string[];eligibility:string };
type Unit = { unit: string; role: string; worked: number; confirmationRecorded: number; directoryMatched: boolean; points: number | null;
  bands: Record<string, Record<string, { worked: number; confirmationRecorded: number }>>; utcDays: Record<string, number>; utcDayCount?: number; activationCandidates?:ActivationCandidate[] };
type Page = { programme: string; stationScope: string; scopes: string[]; roles: string[]; bands: string[];
  units: Unit[]; totalUnits: number; workedUnits: number; supportingQSOs: number; confirmationUnits: number; unknownContacts: number;
  evidence: Evidence[]; evidenceTotal: number; workspace_generation: string; logbook_revision: number; eligibility: string; analytics: string; rulesVersion: string;
  target?: number | null; directoryMatchedUnits?: number; scopeTotal?: number; activationDays?: {day:string;qsos:number}[]; activationDayTotal?:number; activationCandidates?:ActivationCandidate[]; unclassifiedContacts?:number };
const programmes = [["dxcc", "DXCC"], ["waz", "WAZ"], ["was", "WAS"], ["grid", "Grid squares"], ["wac", "WAC"], ["wpx", "WPX"], ["iota", "IOTA"], ["pota", "POTA"], ["sota", "SOTA"], ["wwff", "WWFF"]];
const sources: Record<string, string> = { wac: "https://www.arrl.org/wac", wpx: "https://sites.google.com/site/cqwpxawards/cq-awards-program",
  iota: "https://www.iota-world.org/info/directory/rules-en.pdf", pota: "https://docs.pota.app/docs/rules.html",
  sota: "https://www.sota.org.uk/Joining-In/General-Rules", wwff: "https://wwff.co/awards/global-awards/" };
const utc = (date: number) => Number.isFinite(date) ? new Date((date + 978307200) * 1000).toISOString().replace(".000Z", "Z") : "Unknown";
function Candidate({value:d}:{value:ActivationCandidate}) {
  return <div><strong>{d.day}: {d.candidateStatus}</strong><p>{d.countableContacts} / {d.threshold} distinct countable contact events (conservative minimum) · {d.physicalRows} physical rows · {d.programmeLogRecords} unique programme log records · {d.duplicateProgrammeRecords} duplicate programme records · {d.unknownEligibilityRows} rows with unresolved counting evidence · {d.excludedRows} excluded rows.</p>{d.reasons.map(reason=><p key={reason}>{reason}</p>)}<p>{d.eligibility}</p></div>;
}

export function LocalAwardProgressPanel({ request, refresh, readScope, readOnlySavedFilters = false }: { request: Request; refresh: number; readScope?: string; readOnlySavedFilters?: boolean }) {
  const [programme, setProgramme] = useState("dxcc"), [scope, setScope] = useState(""), [band, setBand] = useState(""), [mode, setMode] = useState("Mixed"), [role, setRole] = useState("");
  const [page, setPage] = useState<Page | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [unit, setUnit] = useState(""), [offset, setOffset] = useState(0), [evidenceOffset, setEvidenceOffset] = useState(0), [retry, setRetry] = useState(0);
  const [evidenceCell,setEvidenceCell]=useState<{band:string;mode:string}|null>(null);
  const [unitRole,setUnitRole]=useState(""),[dayOffset,setDayOffset]=useState(0),[scopeSearch,setScopeSearch]=useState("");
  const [filters, setFilters] = useState(false), [filter, setFilter] = useState<LogbookQuery>(emptyLogbookQuery), [draftFilter, setDraftFilter] = useState<LogbookQuery>(emptyLogbookQuery);
  const [search, setSearch] = useState(""), [referenceTime, setReferenceTime] = useState(() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null), [detailError, setDetailError] = useState("");
  const sequence = useRef(0), detailSequence = useRef(0), matrix = useRef<HTMLDivElement>(null), scroll = useRef(0);
  const identity = JSON.stringify([programme, scope, band, mode, role, filter, search, referenceTime, readScope]);
  useLayoutEffect(() => { setPage(null); setUnit(""); setEvidenceCell(null); setOffset(0); setEvidenceOffset(0); setDetail(null); detailSequence.current++; }, [identity]);
  useEffect(() => {
    const ticket = ++sequence.current; setLoading(true); setError(""); setDetail(null); detailSequence.current++;
    const params = { programme, station_scope: scope, band:unit&&evidenceCell ? evidenceCell.band : band, mode:unit&&evidenceCell ? evidenceCell.mode : mode, role, unit, unit_role:unitRole, day_offset:dayOffset, scope_search:scopeSearch, offset: unit ? evidenceOffset : offset, limit: 20,
      search, query: filter, reference_time: referenceTime, ...(readScope ? { expected_generation: readScope } : {}) };
    void request("logbook_award_progress", params).then(raw => {
      if (ticket !== sequence.current) return;
      const value = (raw?.result ?? raw) as Page;
      if (!Array.isArray(value.units) || !Array.isArray(value.evidence) || !Array.isArray(value.scopes) || typeof value.workspace_generation !== "string") throw new Error("Local award evidence is unavailable. Refresh this view.");
      setPage(value);
    }).catch(cause => { if (ticket === sequence.current) { setPage(null); setError(cause instanceof Error ? cause.message : "Award evidence unavailable."); } })
      .finally(() => { if (ticket === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [request, refresh, identity, unit, evidenceCell, unitRole, dayOffset, scopeSearch, offset, evidenceOffset, retry]);
  useEffect(() => { if (!unit && matrix.current) matrix.current.scrollTop = scroll.current; }, [unit, loading, page]);
  function openEvidence(nextUnit:string,nextRole:string,cell:{band:string;mode:string}|null=null) {
    if(!unit)scroll.current=matrix.current?.scrollTop ?? scroll.current;
    setEvidenceCell(cell);setEvidenceOffset(0);setDayOffset(0);setUnitRole(nextRole);setUnit(nextUnit);
    setDetail(null);setDetailError("");detailSequence.current++;
  }
  function backToMatrix() {
    setUnit("");setEvidenceCell(null);setUnitRole("");setEvidenceOffset(0);setDayOffset(0);
    setDetail(null);setDetailError("");detailSequence.current++;
  }
  function apply(text: string, definition: LogbookQuery) { setSearch(text); setFilter(definition); setReferenceTime(new Date().toISOString().replace(/\.\d{3}Z$/, "Z")); }
  function clearFilters() { const next=emptyLogbookQuery();setDraftFilter(next);apply("",next); }
  async function inspect(evidence: Evidence) {
    const ticket = ++detailSequence.current; setDetail(null); setDetailError("");
    try {
      const raw = await request("logbook_contact", { contactID: evidence.id });
      if (ticket !== detailSequence.current) return;
      const value=raw?.result ?? raw;
      if (!value?.contact?.qso || value.contact.qso.id.toLowerCase() !== evidence.id.toLowerCase() || value.generation !== page?.workspace_generation)
        throw new Error("The contact or workspace changed. Refresh supporting contacts.");
      setDetail(value.contact.qso);
    } catch (cause) { if (ticket === detailSequence.current) setDetailError(cause instanceof Error ? cause.message : "Contact unavailable."); }
  }
  return <section className="awards-section local-award-progress" aria-label="Local award progress and supporting contacts">
    <h3>Local progress and supporting contacts</h3>
    <div className="awards-filters">
      <label>Progress programme <select value={programme} onChange={e => { setProgramme(e.target.value); setScope(""); setRole(""); setMode("Mixed"); setBand(""); }}>{programmes.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Recorded station context <select value={scope || page?.stationScope || ""} onChange={e => setScope(e.target.value)}>{page?.scopes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Find station context <input value={scopeSearch} maxLength={128} onChange={e=>setScopeSearch(e.target.value)} placeholder="Call, country or locator" /></label>
      <label>Progress role/category <select value={role} onChange={e => setRole(e.target.value)}><option value="">All local roles</option>{page?.roles.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Progress band <select value={band} onChange={e => setBand(e.target.value)}><option value="">All bands</option>{page?.bands.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Progress mode <select value={mode} onChange={e => setMode(e.target.value)}>{["Mixed","CW",programme === "wpx" ? "SSB" : "Phone","Data"].map(value => <option key={value}>{value}</option>)}</select></label>
      <button type="button" aria-expanded={filters} onClick={() => setFilters(value => !value)}>Filter contacts</button>
      <button type="button" onClick={() => setRetry(value => value + 1)} disabled={loading}>Refresh progress</button>
    </div>
    <p>Active contact search: {search ? <strong>{search}</strong> : "None"}. {filter.clauses.length} active structured conditions.</p>
    <button type="button" onClick={clearFilters}>Clear all contact filters</button>
    {filters && <><LogbookFilterBuilder value={draftFilter} onChange={setDraftFilter} onApply={() => apply(search,draftFilter)} />
      <LogbookSavedFilters readOnly={readOnlySavedFilters} onRequest={request} currentQuery={search} currentDefinition={draftFilter} onApply={(text,definition) => { const next=definition ?? emptyLogbookQuery(); setDraftFilter(next); apply(text,next); }} /></>}
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Updating complete-log evidence…</p>}
    {page && <>
      <p>{page.workedUnits} distinct worked units · {page.supportingQSOs} supporting physical contacts · {page.confirmationUnits} units with recorded confirmation evidence.</p>
      {page.target != null && <p>Published reference target: {page.target} confirmed units. Local worked progress is not sponsor approval.</p>}
      {["iota","pota","sota","wwff"].includes(programme) && <p>{page.directoryMatchedUnits ?? "Unknown"} local units match the available directory. Worked totals include clearly marked unverified recorded references.</p>}
      <p>{page.eligibility} {page.analytics} {sources[programme] && <a href={sources[programme]} target="_blank" rel="noreferrer">Official rules</a>}</p>
      <p>Station country/location comes from each recorded contact. Unknown historical context is kept separate. Across the complete filtered log, {page.unknownContacts} contacts have no usable membership for this programme.</p>
      {programme === "iota" && <p>IOTA local progress combines locations with the same recorded callsign and known country; this does not establish land, licensing or remote-operation eligibility. Original locations remain in supporting contacts. To select one location, use Filter contacts → Own grid or Own location; Clear all contact filters removes those conditions. Own-island credit is not inferred.</p>}
      {programme === "pota" && <p>The local ten-contact UTC-day candidate uses distinct countable contact events, with SUBMODE taking precedence. Programme records additionally distinguish each contacted park and exclude QSO time from their duplicate key. Expanded park records alone do not establish the activation minimum. Account identity and operation eligibility are unverified; this is not portal credit.</p>}
      {!!page.unclassifiedContacts && <button type="button" disabled={loading} onClick={()=>openEvidence("__unknown__","unknown")}>Inspect {page.unclassifiedContacts} unclassified contacts in this context</button>}
      <div ref={matrix} hidden={!!unit} className="local-award-matrix" onScroll={() => { if (!unit&&!loading&&matrix.current) scroll.current=matrix.current.scrollTop; }}>
        <table><thead><tr><th>Unit</th><th>Role/category</th><th>Worked / confirmation evidence</th><th>Band × mode (QSOs)</th><th>Reference / points</th></tr></thead>
          <tbody>{page.units.map(item => <tr key={`${item.role}:${item.unit}`}><td><button type="button" disabled={loading} onClick={() => openEvidence(item.unit,item.role)}>{item.unit} · Supporting contacts</button></td>
            <td>{item.role}</td><td>{item.worked} / {item.confirmationRecorded}</td><td>{Object.entries(item.bands).map(([b,modes]) => <span key={b}>{b}: {Object.entries(modes).map(([m,c]) => <button type="button" key={m} disabled={loading} aria-label={`${item.unit} · ${item.role} · ${b} · ${m} supporting contacts`} onClick={()=>openEvidence(item.unit,item.role,{band:b,mode:m})}>{m} {c.worked} ({c.confirmationRecorded} recorded)</button>)}<br /></span>)}</td>
            <td>{["iota","pota","sota","wwff"].includes(programme) && (item.directoryMatched ? "Directory match; eligibility incomplete" : "Directory unverified")} {programme === "sota" && (item.points == null ? "Points unavailable: dated summit/association evidence incomplete" : `${item.points} local point estimate`)}
              {["pota","sota","wwff"].includes(programme) && <><span>Latest {Object.keys(item.utcDays).length} / {item.utcDayCount ?? Object.keys(item.utcDays).length} UTC days; open Supporting contacts for all days.</span>{programme === "pota" && item.role === "activator" ? item.activationCandidates?.map(value=><Candidate key={value.day} value={value}/>) : Object.entries(item.utcDays).map(([day,count]) => <div key={day}>{day}: {count} QSOs</div>)}</>}</td></tr>)}</tbody></table>
        {!page.units.length && <p>No local units in this station/filter scope. Try a different recorded context or reset conditions.</p>}
        <div className="awards-pagination"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0,offset-20))}>Previous units</button><span>{offset+1}–{Math.min(offset+20,page.totalUnits)} / {page.totalUnits}</span><button type="button" disabled={loading || offset+20 >= page.totalUnits} onClick={() => setOffset(offset+20)}>Next units</button></div>
      </div>
      {unit && <section aria-label="Supporting contacts"><h4>{unit === "__unknown__" ? "Unclassified contacts and missing evidence" : `${unit} · ${evidenceCell ? evidenceCell.band+" / "+evidenceCell.mode+" · " : ""}Supporting contacts`}</h4><button type="button" onClick={backToMatrix}>Back to matrix</button>
        {!!page.activationDayTotal && <section aria-label="UTC activity days"><h4>{unitRole} · UTC days</h4>{programme === "pota" && unitRole === "activator" ? page.activationCandidates?.map(value=><Candidate key={value.day} value={value}/>) : page.activationDays?.map(day=><p key={day.day}>{day.day}: {day.qsos} physical QSOs</p>)}<button type="button" disabled={dayOffset===0||loading} onClick={()=>setDayOffset(Math.max(0,dayOffset-20))}>Previous days</button><span>{page.activationDayTotal} UTC days</span><button type="button" disabled={loading||dayOffset+20>=page.activationDayTotal} onClick={()=>setDayOffset(dayOffset+20)}>Next days</button></section>}
        <p>{page.evidenceTotal} supporting contacts. Several contacts for one unit count once in the distinct-unit total.</p>
        {!page.evidence.length && !loading && <p>No supporting contacts for this needed cell in the selected band/mode/filter.</p>}
        <table><thead><tr><th>Call</th><th>UTC</th><th>Band/mode</th><th>Recorded own location</th><th>Paper / LoTW</th><th>Why counted</th></tr></thead><tbody>{page.evidence.map(e => <tr key={e.id}><td><button type="button" onClick={() => void inspect(e)}>{e.call}</button></td><td>{utc(e.start)}</td><td>{e.band} {e.mode}</td><td>{e.recordedGrid || "Unknown grid"} · {e.recordedLocation || "Unknown location"}<small>{e.recordedContext}</small></td><td>{e.paper || "Unknown"} / {e.lotw || "Unknown"}</td><td>{e.reason}</td></tr>)}</tbody></table>
        <div className="awards-pagination"><button type="button" disabled={loading || evidenceOffset === 0} onClick={() => setEvidenceOffset(Math.max(0,evidenceOffset-20))}>Previous contacts</button><span>{page.evidenceTotal} total supporting contacts</span><button type="button" disabled={loading || evidenceOffset+20 >= page.evidenceTotal} onClick={() => setEvidenceOffset(evidenceOffset+20)}>Next contacts</button></div>
        {detailError && <p role="alert">{detailError}</p>}{detail && <section aria-label="Supporting contact detail"><h4>{String(detail.call)} · Current stored contact</h4><button type="button" onClick={() => setDetail(null)}>Close contact detail</button><dl>{Object.entries(detail).filter(([,v]) => v != null && v !== "").map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></section>}
      </section>}
      <small>{page.rulesVersion} · log revision {page.logbook_revision}</small>
    </>}
  </section>;
}
