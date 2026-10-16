import { useEffect, useState, type CSSProperties } from "react";
import { ContactRound } from "lucide-react";
import "./OperatorDesk.css";

type Data = Record<string, any>;
export type IntelligenceRequest = (method: string, params?: Data) => Promise<any>;
export type DeskIntelligenceProps = { draft: Data | null; lookup: Data | null; previous: Data[];
  request: IntelligenceRequest; refresh: number; intelligenceBands?: string[]; contextKey?: string; emptyMessage?: string; taskOnly?: boolean };
const normalizedCall = (value: unknown) => String(value ?? "").trim().toUpperCase();
const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
const displayedBands = bands.slice(0, 10);
const utcSummary = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) : "—";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

type Evidence = { contextKey: string; call: string; adif: number | null; callCells?: Data[]; history?: Data; error?: string };
export function DeskIntelligence({ draft, lookup, previous, request, refresh, intelligenceBands, contextKey = "", emptyMessage = "Enter a callsign", taskOnly = false }: DeskIntelligenceProps) {
  const call = normalizedCall(draft?.call), sameLookup = call && normalizedCall(lookup?.call) === call;
  const info = sameLookup ? lookup : null;
  const adif = info && Number.isInteger(info.dxcc) && info.dxcc > 0 ? info.dxcc as number : null;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => {
    if (!/^[A-Z0-9/-]{3,32}$/.test(call)) { setEvidence(null); return; }
    let active = true; setEvidence({ contextKey, call, adif });
    void Promise.allSettled([request("logbook_matrix", { call }), request("cluster_history", { call, ...(adif ? { adif } : {}) })]).then(([matrix, history]) => {
      if (!active) return;
      const cells = matrix.status === "fulfilled" && Array.isArray(matrix.value?.cells) ? matrix.value.cells : undefined;
      const value = history.status === "fulfilled" ? history.value?.history : null;
      const matches = normalizedCall(value?.call) === call && value?.adif === adif && Array.isArray(value?.matrix);
      setEvidence({ contextKey, call, adif, callCells: cells, history: matches ? value : undefined, ...(!cells || !matches ? { error: "Local history evidence is unavailable or incomplete." } : {}) });
    });
    return () => { active = false; };
  }, [call, adif, request, refresh, contextKey]);
  const current = evidence?.contextKey === contextKey && evidence.call === call && evidence.adif === adif ? evidence : null;
  // The intelligence card describes the current matched lookup, not carried-over
  // editable draft fields. Never label a new call with the previous country.
  const name = info?.name, country = info?.country;
  const grid = info?.gridSquare, continent = info?.continent;
  const cq = info?.cqZone, itu = info?.ituZone;
  const lastCall = current?.history ? current.history.previous?.[0] : previous.find(item => normalizedCall(item.call) === call);
  const visibleBands = intelligenceBands?.length ? Array.from(new Set(intelligenceBands.filter(band => bands.includes(band)))) : displayedBands;
  const matrixColumns = Math.max(1, Math.ceil(visibleBands.length / 2));
  const matrixStyle = { "--desk-matrix-columns": Math.min(5, matrixColumns), "--desk-matrix-wide-columns": matrixColumns } as CSSProperties;
  const matrix = (scope: string, cells: Data[] | undefined) => <div className="desk-band-matrix" style={matrixStyle} aria-label={`${scope} band status`}>{visibleBands.map(band => {
    const matches = cells?.filter(cell => cell.band === band), confirmed = matches?.some(cell => cell.confirmed === true), worked = confirmed || matches?.some(cell => cell.worked === true);
    const state = cells ? confirmed ? "Confirmed" : worked ? "Worked" : "Unworked" : "Unknown";
    return <span key={band} className={`is-${state.toLowerCase()}`} aria-label={`${scope} ${band}: ${state}`} title={`${band}: ${state} across logged modes`}>{confirmed ? "●" : worked ? "○" : "—"} {band.replace(/^(\d+)m$/, "$1")}</span>;
  })}</div>;
  const counts = (worked: unknown, confirmed: unknown) => {
    const workedText = finite(worked) ? worked.toLocaleString() : "—", confirmedText = finite(confirmed) ? confirmed.toLocaleString() : "—";
    const full = `${workedText} worked · ${confirmedText} confirmed`;
    return <small title={full}><span aria-hidden="true">{workedText} wkd · {confirmedText} cnf</span><span className="desk-count-full">{full}</span></small>;
  };
  return <section className="desk-panel desk-intelligence" aria-label="Callsign and DXCC intelligence">{!taskOnly && <h2><ContactRound size={15} aria-hidden="true" /> Callsign &amp; DXCC intelligence</h2>}
    <div className="desk-identity"><div><strong>{call || "—"}</strong><b>{name || "Name unavailable"}</b><span>{country || "Country unresolved"}</span></div><div className="desk-provenance"><b>{info?.source || (call ? "Lookup pending" : emptyMessage)}</b><small>{finite(info?.latitude) && finite(info?.longitude) ? info?.location_source || info?.source || "POSITION RESOLVED" : "NO POSITION"}</small></div></div>
    <dl className="desk-identity-facts">{[["DXCC", adif ? `#${adif}` : "—"], ["GRID", grid || "—"], ["CONT", continent || "—"], ["ZONES", `CQ ${cq || "—"} · ITU ${itu || "—"}`], ["DISTANCE", finite(info?.distance_km) ? `${Math.round(info.distance_km).toLocaleString()} km` : "—"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
    <div className="desk-matrices"><div><h3>CALLSIGN {counts(current?.history?.previous_count, current?.history?.previous_confirmed_count)}</h3>{matrix("Callsign", current?.callCells)}</div><div><h3>DXCC {adif ? `#${adif}` : "—"} {counts(adif ? current?.history?.dxcc_contact_count : undefined, adif ? current?.history?.dxcc_confirmed_count : undefined)}</h3>{matrix("DXCC", adif ? current?.history?.matrix : undefined)}</div></div>
    <footer><span>{lastCall ? `CALL LAST · ${utcSummary(lastCall.date ?? lastCall.start)}` : current?.history?.previous_count === 0 ? "CALL · NEW" : "CALL LAST · —"}</span><span>DXCC LAST · {current?.history?.last_dxcc_qso ? utcSummary(current.history.last_dxcc_qso.date ?? current.history.last_dxcc_qso.start) : "Unavailable"}</span></footer>
    {current?.error && <p className="desk-error" role="status">{current.error}</p>}
    {info?.lookup_warning && <p className="desk-error" role="status">{info.lookup_warning}</p>}
  </section>;
}
