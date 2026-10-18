import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { workerRequest } from "../worker";
import { CanonicalDraftFollower, intelligenceIdentity } from "./callsignIntelligenceContext";
import { normalizedCall, sameNormalLogCall } from "./draftEnrichment";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { connectOperatorDraftChanges, ownDraftUpdateWarnings } from "./operatorDraftWindows";
import { connectLogbookChanges } from "./logbookWindows";
import type { IntelligenceRequest } from "./CallsignIntelligence";
import { clusterBandColors, clusterModeColors, paletteColor } from "./clusterPalette";
import "./DetachedPreviousQSOsSurface.css";

export async function requestDetachedPreviousQSOs(method: string, params: Record<string, unknown> = {}) {
  if (method !== "logbook_operator_draft" && method !== "cluster_history") throw new Error("Previous QSOs can only read the shared draft and local contact history.");
  const result = method === "logbook_operator_draft" ? await requestOperatorDraft(method, params) : (await workerRequest(method, params)).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The local history response could not be verified.");
  return result;
}

type Contact = { id: string; call: string; date: string; band: string; mode: string; rstSent: string; rstReceived: string; grid: string; confirmed: boolean };
type History = { key: string; count: number; confirmed: number; rows: Contact[]; error?: string };
const utc = (date: string) => new Date(date).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" });
const columns = [["utc", "UTC", 154, 120], ["band", "Band", 84, 64], ["mode", "Mode", 90, 64],
  ["sent", "Sent", 76, 56], ["received", "Rcvd", 76, 56], ["grid", "Grid", 104, 74], ["qsl", "QSL", 112, 90]] as const;
type Column = typeof columns[number][0];
type Widths = Record<Column, number>;
const widthsKey = "xlog.integration.previous-qsos-columns.v1";
const boundWidth = (id: Column, width: number) => Math.max(columns.find(([key]) => key === id)![3], Math.min(480, Math.round(width)));
function initialWidths(): Widths {
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

function ColumnHeader({ id, label, width, onWidth }: { id: Column; label: string; width: number; onWidth: (id: Column, width: number) => void }) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return <th scope="col"><span>{label}</span><span className="previous-column-resizer" role="separator" tabIndex={0}
    aria-label={`Resize ${label} column`} aria-orientation="vertical" aria-valuemin={columns.find(([key]) => key === id)![3]}
    aria-valuemax={480} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      const actual = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      drag.current = { x: event.clientX, width, scale: actual > 0 ? width / actual : 1 };
    }}
    onPointerMove={event => { if (drag.current) onWidth(id, boundWidth(id, drag.current.width + (event.clientX - drag.current.x) * drag.current.scale)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? width - 10 : event.key === "ArrowRight" ? width + 10
        : event.key === "Home" ? 0 : event.key === "End" ? 480 : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation(); onWidth(id, boundWidth(id, next));
    }} /></th>;
}

/** A reader of the existing worker projection; the draft and contact store keep
 * their existing owners even when the main renderer is closed. */
export function PreviousQSOsSurface({ request = requestDetachedPreviousQSOs }: { request?: IntelligenceRequest }) {
  const [follower] = useState(() => new CanonicalDraftFollower(() => request("logbook_operator_draft", {})));
  const state = useSyncExternalStore(follower.subscribe, follower.getSnapshot);
  const [warning, setWarning] = useState(""), [historyWarning, setHistoryWarning] = useState("");
  const [health] = useState(() => ownDraftUpdateWarnings(setWarning));
  const [refresh, setRefresh] = useState(0), [history, setHistory] = useState<History | null>(null);
  const [widths, setWidths] = useState(initialWidths);
  const totalWidth = columns.reduce((sum, [id]) => sum + widths[id], 0);
  const resizeColumn = (id: Column, width: number) => setWidths(current => ({ ...current, [id]: boundWidth(id, width) }));
  useEffect(() => { try { localStorage.setItem(widthsKey, JSON.stringify({ version: 1, widths })); }
    catch { /* Keep usable in memory if storage is unavailable. */ } }, [widths]);
  const snapshot = state.available ? state.snapshot : null, key = intelligenceIdentity(snapshot);
  const call = normalizedCall(snapshot?.qso.call), matched = /^[A-Z0-9/-]{3,32}$/.test(call);
  useEffect(() => {
    follower.activate();
    const stop = connectOperatorDraftChanges(follower.refresh, health.failed, health.recovered, health.subscribed);
    return () => { stop(); follower.dispose(); };
  }, [follower, health]);
  useEffect(() => connectLogbookChanges(() => { setHistoryWarning(""); setRefresh(value => value + 1); }, setHistoryWarning), []);
  useEffect(() => {
    let active = true;
    if (!matched || !key) return;
    void request("cluster_history", { call }).then(value => {
      const item = value?.history;
      if (normalizedCall(item?.call) !== call || !Number.isSafeInteger(item?.previous_count) || item.previous_count < 0
        || !Number.isSafeInteger(item?.previous_confirmed_count) || item.previous_confirmed_count < 0
        || item.previous_confirmed_count > item.previous_count || !Array.isArray(item?.previous) || item.previous.length > 20
        || item.previous.length > item.previous_count
        || item.previous.some((row: Contact) => !row || !sameNormalLogCall(row.call, call) || typeof row.id !== "string"
          || typeof row.date !== "string" || !Number.isFinite(Date.parse(row.date))
          || [row.band, row.mode, row.rstSent, row.rstReceived, row.grid].some(value => typeof value !== "string") || typeof row.confirmed !== "boolean"))
        throw new Error("The local contact history does not match the shared callsign.");
      if (active) setHistory({ key, rows: item.previous, count: item.previous_count, confirmed: item.previous_confirmed_count });
    }).catch(cause => { if (active) setHistory({ key, rows: [], count: 0, confirmed: 0, error: cause instanceof Error ? cause.message : "Local contact history is unavailable." }); });
    return () => { active = false; };
  }, [key, call, matched, request, refresh]);
  const current = history?.key === key ? history : null;
  return <div className="app live monitor-app detached-previous-qsos-app"><main aria-label="Previous QSOs">
    {(warning || state.error) && <p className="live-error" role="alert">{warning || state.error}</p>}
    {historyWarning && <p className="live-error" role="status">{historyWarning}</p>}
    <div className="previous-qsos-context"><strong>{call || "—"}</strong><span>{matched && current && !current.error ? `${current.count.toLocaleString()} worked · ${current.confirmed.toLocaleString()} confirmed` : "Enter a callsign in Log QSO"}</span></div>
    {current?.error ? <p className="live-error" role="alert">{current.error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry history</button></p>
      : !matched ? <p className="secondary" role="status">{state.error ? "Shared draft unavailable" : "Previous contacts follow the callsign in Log QSO."}</p>
      : !current ? <p className="secondary" role="status">Loading local contacts…</p>
      : !current.rows.length ? <p className="secondary" role="status">No previous QSOs with {call}.</p>
      : <><div className="previous-qsos-table" tabIndex={0} role="region" aria-label={`Previous contacts with ${call}, scroll for more columns`}><table style={{ minWidth: totalWidth }}>
        <colgroup>{columns.map(([id]) => <col key={id} style={{ width: `${widths[id] / totalWidth * 100}%` }} />)}</colgroup><thead><tr>
        {columns.map(([id, label]) => <ColumnHeader key={id} id={id} label={label} width={widths[id]} onWidth={resizeColumn} />)}
      </tr></thead><tbody>{current.rows.map(row => <tr key={row.id}>
        <td className="previous-utc">{utc(row.date)}</td><td><span className="previous-category previous-band" style={{ color: paletteColor(row.band, undefined, clusterBandColors) }}>{row.band}</span></td>
        <td><span className="previous-category previous-mode" style={{ color: paletteColor(row.mode, undefined, clusterModeColors) }}>{row.mode}</span></td>
        <td className="previous-report">{row.rstSent || "—"}</td><td className="previous-report">{row.rstReceived || "—"}</td>
        <td className="previous-grid previous-grid-value">{row.grid || "—"}</td>
        <td className={`previous-qsl ${row.confirmed ? "previous-confirmed" : "previous-worked"}`}>{row.confirmed ? "Confirmed" : "Worked"}</td>
      </tr>)}</tbody></table></div>
        {current.count > current.rows.length && <p className="secondary previous-qsos-limit">Showing the latest {current.rows.length} of {current.count.toLocaleString()} contacts.</p>}</>}
  </main></div>;
}

export function DetachedPreviousQSOsSurface() { return <PreviousQSOsSurface />; }
