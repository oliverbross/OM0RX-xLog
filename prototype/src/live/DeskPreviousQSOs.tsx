import { useMemo, useState } from "react";
import { normalizedCall } from "./draftEnrichment";
import { clusterBandColors, clusterModeColors, paletteColor } from "./clusterPalette";
import { countryDisplay } from "./countryDisplay";
import "./DeskPreviousQSOs.css";

type PreviousQSO = Record<string, unknown> & {
  id?: string;
  call?: string;
  start?: string;
  band?: string;
  mode?: string;
  submode?: string;
  country?: string;
  grid?: string;
  rstSent?: string;
  rstReceived?: string;
  qslSent?: string;
  qslReceived?: string;
  lotwSent?: string;
  lotwReceived?: string;
};

const columns = [
  ["utc", "Date"], ["band", "Band"], ["mode", "Mode"], ["country", "Country"],
  ["lotw", "LoTW"], ["qsl", "QSL"], ["rstSent", "Sent"], ["rstReceived", "Rcvd"], ["grid", "Grid"],
] as const;
type Column = typeof columns[number][0];
const defaultColumns: Column[] = ["utc", "band", "mode", "country", "lotw", "qsl"];
const storageKey = "xlog.integration.previous-qso-columns.desk.v1";

// Highest-frequency amateur bands first, through the LF allocations. Unknown
// labels follow known bands without being discarded.
const highToLowBands = [
  "1mm", "2mm", "4mm", "6mm", "1.25cm", "3cm", "6cm", "9cm", "13cm", "23cm", "33cm", "70cm",
  "1.25m", "2m", "4m", "6m", "8m", "10m", "12m", "15m", "17m", "20m", "30m", "40m", "60m", "80m", "160m",
  "630m", "2190m",
];
const bandRank = new Map(highToLowBands.map((band, index) => [band, index]));

export function compareBandsHighestFirst(left: string, right: string) {
  const leftRank = bandRank.get(left.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = bandRank.get(right.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.localeCompare(right, undefined, { numeric: true });
}

function loadColumns(): Column[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!Array.isArray(value)) return defaultColumns;
    const known = columns.map(([id]) => id);
    const selected = known.filter(id => id === "band" || value.includes(id));
    return selected.length ? selected : defaultColumns;
  } catch { return defaultColumns; }
}

function utc(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function confirmation(received?: string, sent?: string) {
  const receivedValue = String(received ?? "").trim().toUpperCase();
  const sentValue = String(sent ?? "").trim().toUpperCase();
  if (["Y", "V"].includes(receivedValue)) return { label: "Confirmed", tone: "confirmed" };
  if (["Y", "Q"].includes(sentValue)) return { label: "Sent", tone: "sent" };
  return { label: "—", tone: "none" };
}

function Confirmation({ service, received, sent }: { service: string; received?: string; sent?: string }) {
  const status = confirmation(received, sent);
  return <span className={`desk-previous-confirmation is-${status.tone}`} aria-label={`${service}: ${status.label}`}>{status.label}</span>;
}

export function DeskPreviousQSOs({ call, qsos }: { call: string; qsos: PreviousQSO[] }) {
  const activeCall = normalizedCall(call);
  const matching = useMemo(() => qsos.filter(qso => normalizedCall(qso.call) === activeCall), [activeCall, qsos]);
  const [visible, setVisible] = useState<Column[]>(loadColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [bandDirection, setBandDirection] = useState<"high" | "low" | null>(null);
  const rows = useMemo(() => matching.map((qso, index) => ({ qso, index })).sort((left, right) => {
    if (bandDirection) {
      const order = compareBandsHighestFirst(String(left.qso.band ?? ""), String(right.qso.band ?? ""));
      if (order) return bandDirection === "high" ? order : -order;
    }
    const date = String(right.qso.start ?? "").localeCompare(String(left.qso.start ?? ""));
    return date || left.index - right.index;
  }).map(({ qso }) => qso), [matching, bandDirection]);
  if (!activeCall || !rows.length) return null;

  function setColumn(column: Column, shown: boolean) {
    const next = columns.map(([id]) => id).filter(id => id === "band" || (id === column ? shown : visible.includes(id)));
    setVisible(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Retain session preferences when storage is unavailable. */ }
  }
  const shown = (column: Column) => visible.includes(column);
  const toggleBandSort = () => setBandDirection(current => current === "high" ? "low" : "high");

  return <section className="desk-previous" aria-label={`Worked before · ${activeCall}`}>
    <header className="desk-previous-head">
      <div><strong>Worked before</strong><span>{activeCall} · {rows.length} {rows.length === 1 ? "QSO" : "QSOs"}</span></div>
      <button type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(value => !value)}>Columns</button>
    </header>
    {columnsOpen && <fieldset className="desk-previous-columns"><legend>Previous QSO columns</legend>
      {columns.map(([column, label]) => <label key={column}><input type="checkbox" checked={shown(column)} disabled={column === "band"}
        onChange={event => setColumn(column, event.target.checked)} />{label}</label>)}
    </fieldset>}
    <div className="desk-previous-table-wrap" role="region" aria-label={`Previous QSOs for ${activeCall}`} tabIndex={0}>
      <table className="desk-previous-table">
        <thead><tr>
          {shown("utc") && <th scope="col">Date</th>}
          <th scope="col" aria-sort={bandDirection === "high" ? "descending" : bandDirection === "low" ? "ascending" : "none"}>
            <button type="button" onClick={toggleBandSort}>Band<span aria-hidden="true">{bandDirection === "high" ? " ↓" : bandDirection === "low" ? " ↑" : " ↕"}</span></button>
          </th>
          {shown("mode") && <th scope="col">Mode</th>}
          {shown("country") && <th scope="col">Country</th>}
          {shown("lotw") && <th scope="col">LoTW</th>}
          {shown("qsl") && <th scope="col">QSL</th>}
          {shown("rstSent") && <th scope="col">Sent</th>}
          {shown("rstReceived") && <th scope="col">Rcvd</th>}
          {shown("grid") && <th scope="col">Grid</th>}
        </tr></thead>
        <tbody>{rows.map((qso, index) => <tr key={qso.id ?? `${qso.start ?? "qso"}-${index}`}>
          {shown("utc") && <td className="mono" title={`${utc(qso.start)} UTC`}>{utc(qso.start)}</td>}
          <td><span className="desk-previous-category" style={{ color: paletteColor(String(qso.band ?? ""), undefined, clusterBandColors) }}>{String(qso.band ?? "—")}</span></td>
          {shown("mode") && <td><span className="desk-previous-category" style={{ color: paletteColor(String(qso.submode || qso.mode || ""), undefined, clusterModeColors) }}>{String(qso.submode || qso.mode || "—")}</span></td>}
          {shown("country") && <td title={countryDisplay(String(qso.country ?? "")) || undefined}>{countryDisplay(String(qso.country ?? "")) || "—"}</td>}
          {shown("lotw") && <td><Confirmation service="LoTW" received={qso.lotwReceived} sent={qso.lotwSent} /></td>}
          {shown("qsl") && <td><Confirmation service="QSL" received={qso.qslReceived} sent={qso.qslSent} /></td>}
          {shown("rstSent") && <td className="mono">{qso.rstSent || "—"}</td>}
          {shown("rstReceived") && <td className="mono">{qso.rstReceived || "—"}</td>}
          {shown("grid") && <td className="mono">{qso.grid || "—"}</td>}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
