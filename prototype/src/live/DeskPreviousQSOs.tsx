import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  ["utc", "Date", 145, 105], ["band", "Band", 85, 64], ["mode", "Mode", 95, 64], ["country", "Country", 170, 110],
  ["lotw", "LoTW", 105, 78], ["qsl", "QSL", 105, 78], ["rstSent", "Sent", 75, 58],
  ["rstReceived", "Rcvd", 75, 58], ["grid", "Grid", 100, 72],
] as const;
type Column = typeof columns[number][0];
type Widths = Record<Column, number>;
const defaultColumns: Column[] = ["utc", "band", "mode", "country", "lotw", "qsl"];
const storageKey = "xlog.integration.previous-qso-columns.desk.v1";
const widthsKey = "xlog.integration.previous-qso-column-widths.desk.v1";

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

function boundWidth(column: Column, width: number) {
  const minimum = columns.find(([id]) => id === column)![3];
  return Math.max(minimum, Math.min(480, Math.round(width)));
}

function loadWidths(): Widths {
  const defaults = Object.fromEntries(columns.map(([id, , width]) => [id, width])) as Widths;
  try {
    const raw = localStorage.getItem(widthsKey);
    if (!raw || raw.length > 1024) return defaults;
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || !saved.widths || typeof saved.widths !== "object") return defaults;
    for (const [id] of columns) if (typeof saved.widths[id] === "number" && Number.isFinite(saved.widths[id]))
      defaults[id] = boundWidth(id, saved.widths[id]);
  } catch { /* Presentation preferences cannot block local history. */ }
  return defaults;
}

function ColumnHeader({ column, label, width, onWidth, sort, children }: {
  column: Column; label: string; width: number; onWidth: (column: Column, width: number) => void;
  sort?: "none" | "ascending" | "descending"; children?: ReactNode;
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return <th scope="col" aria-sort={sort}>{children ?? <span>{label}</span>}<span className="desk-previous-column-resizer"
    role="separator" tabIndex={0} aria-label={`Resize ${label} column`} aria-orientation="vertical"
    aria-valuemin={columns.find(([id]) => id === column)![3]} aria-valuemax={480} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
      const actual = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      drag.current = { x: event.clientX, width, scale: actual > 0 ? width / actual : 1 };
    }}
    onPointerMove={event => { if (drag.current) onWidth(column, drag.current.width + (event.clientX - drag.current.x) * drag.current.scale); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? width - 10 : event.key === "ArrowRight" ? width + 10
        : event.key === "Home" ? 0 : event.key === "End" ? 480 : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation(); onWidth(column, next);
    }} /></th>;
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
  const [widths, setWidths] = useState<Widths>(loadWidths);
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
  const resizeColumn = (column: Column, width: number) => setWidths(current => ({ ...current, [column]: boundWidth(column, width) }));
  const totalWidth = columns.filter(([column]) => visible.includes(column)).reduce((sum, [column]) => sum + widths[column], 0);
  useEffect(() => {
    try { localStorage.setItem(widthsKey, JSON.stringify({ version: 1, widths })); }
    catch { /* Keep usable in memory if storage is unavailable. */ }
  }, [widths]);
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
      <table className="desk-previous-table" style={{ minWidth: totalWidth }}>
        <colgroup>{columns.filter(([column]) => shown(column)).map(([column]) =>
          <col key={column} style={{ width: `${widths[column] / totalWidth * 100}%` }} />)}</colgroup>
        <thead><tr>
          {shown("utc") && <ColumnHeader column="utc" label="Date" width={widths.utc} onWidth={resizeColumn} />}
          <ColumnHeader column="band" label="Band" width={widths.band} onWidth={resizeColumn}
            sort={bandDirection === "high" ? "descending" : bandDirection === "low" ? "ascending" : "none"}>
            <button type="button" onClick={toggleBandSort}>Band<span aria-hidden="true">{bandDirection === "high" ? " ↓" : bandDirection === "low" ? " ↑" : " ↕"}</span></button>
          </ColumnHeader>
          {shown("mode") && <ColumnHeader column="mode" label="Mode" width={widths.mode} onWidth={resizeColumn} />}
          {shown("country") && <ColumnHeader column="country" label="Country" width={widths.country} onWidth={resizeColumn} />}
          {shown("lotw") && <ColumnHeader column="lotw" label="LoTW" width={widths.lotw} onWidth={resizeColumn} />}
          {shown("qsl") && <ColumnHeader column="qsl" label="QSL" width={widths.qsl} onWidth={resizeColumn} />}
          {shown("rstSent") && <ColumnHeader column="rstSent" label="Sent" width={widths.rstSent} onWidth={resizeColumn} />}
          {shown("rstReceived") && <ColumnHeader column="rstReceived" label="Rcvd" width={widths.rstReceived} onWidth={resizeColumn} />}
          {shown("grid") && <ColumnHeader column="grid" label="Grid" width={widths.grid} onWidth={resizeColumn} />}
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
