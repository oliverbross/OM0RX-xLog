import { useEffect, useState, useSyncExternalStore } from "react";
import { workerRequest } from "../worker";
import { CanonicalDraftFollower, intelligenceIdentity } from "./callsignIntelligenceContext";
import { normalizedCall } from "./draftEnrichment";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { connectOperatorDraftChanges, ownDraftUpdateWarnings } from "./operatorDraftWindows";
import { connectLogbookChanges } from "./logbookWindows";
import type { IntelligenceRequest } from "./CallsignIntelligence";
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

/** A reader of the existing worker projection; the draft and contact store keep
 * their existing owners even when the main renderer is closed. */
export function PreviousQSOsSurface({ request = requestDetachedPreviousQSOs }: { request?: IntelligenceRequest }) {
  const [follower] = useState(() => new CanonicalDraftFollower(() => request("logbook_operator_draft", {})));
  const state = useSyncExternalStore(follower.subscribe, follower.getSnapshot);
  const [warning, setWarning] = useState(""), [historyWarning, setHistoryWarning] = useState("");
  const [health] = useState(() => ownDraftUpdateWarnings(setWarning));
  const [refresh, setRefresh] = useState(0), [history, setHistory] = useState<History | null>(null);
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
        || item.previous.some((row: Contact) => !row || normalizedCall(row.call) !== call || typeof row.id !== "string"
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
      : <><div className="previous-qsos-table" tabIndex={0} role="region" aria-label={`Previous contacts with ${call}`}><table><thead><tr>
        <th>UTC</th><th>Band</th><th>Mode</th><th>Sent</th><th>Rcvd</th><th className="previous-grid">Grid</th><th className="previous-qsl">QSL</th>
      </tr></thead><tbody>{current.rows.map(row => <tr key={row.id}><td>{utc(row.date)}</td><td>{row.band}</td><td>{row.mode}</td><td>{row.rstSent || "—"}</td><td>{row.rstReceived || "—"}</td><td className="previous-grid">{row.grid || "—"}</td><td className="previous-qsl">{row.confirmed ? "Confirmed" : "Worked"}</td></tr>)}</tbody></table></div>
        {current.count > current.rows.length && <p className="secondary previous-qsos-limit">Showing the latest {current.rows.length} of {current.count.toLocaleString()} contacts.</p>}</>}
  </main></div>;
}

export function DetachedPreviousQSOsSurface() { return <PreviousQSOsSurface />; }
