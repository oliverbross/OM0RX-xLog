import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { workerRequest } from "../worker";
import { DeskIntelligence, type IntelligenceRequest } from "./CallsignIntelligence";
import { CanonicalDraftFollower, CallsignLookupCache, intelligenceIdentity } from "./callsignIntelligenceContext";
import { normalizedCall } from "./draftEnrichment";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { connectOperatorDraftChanges, ownDraftUpdateWarnings } from "./operatorDraftWindows";
import { connectLogbookChanges } from "./logbookWindows";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";
import "./DetachedCallsignIntelligenceSurface.css";

export const detachedIntelligenceMethods = ["logbook_operator_draft", "lookup_call", "logbook_previous",
  "logbook_matrix", "cluster_history", "workspace_preferences_load"] as const;
export async function requestDetachedIntelligence(method: string, params: Record<string, unknown> = {}) {
  if (!detachedIntelligenceMethods.some(allowed => allowed === method)) throw new Error("Callsign Intelligence is read only.");
  const result = method === "logbook_operator_draft" ? await requestOperatorDraft(method, params) : (await workerRequest(method, params)).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The intelligence response could not be verified.");
  return result;
}
const validBands = new Set(["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"]);

// Injectable reads support synthetic component tests without a native session.
export function CallsignIntelligenceSurface({ request = requestDetachedIntelligence, dock = dockDetachedWorkspace }: {
  request?: IntelligenceRequest; dock?: () => Promise<void>;
}) {
  const [follower] = useState(() => new CanonicalDraftFollower(() => request("logbook_operator_draft", {})));
  const state = useSyncExternalStore(follower.subscribe, follower.getSnapshot);
  const [cache] = useState(() => new CallsignLookupCache(request));
  const [warning, setWarning] = useState(""), [historyWarning, setHistoryWarning] = useState(""), [dockError, setDockError] = useState("");
  const [health] = useState(() => ownDraftUpdateWarnings(setWarning));
  const [historyRefresh, setHistoryRefresh] = useState(0), [lookupRefresh, setLookupRefresh] = useState(0), [preferencesRefresh, setPreferencesRefresh] = useState(0);
  const [lookup, setLookup] = useState<{ key: string; profile: Record<string, any> } | null>(null);
  const [previous, setPrevious] = useState<{ key: string; rows: Record<string, any>[] } | null>(null);
  const [preferences, setPreferences] = useState<{ generation: string; bands?: string[]; error?: string } | null>(null);
  const [docking, setDocking] = useState(false), dockingRef = useRef(false), mounted = useRef(true);
  const snapshot = state.available ? state.snapshot : null, identity = intelligenceIdentity(snapshot);
  const generation = snapshot?.generation ?? "", call = normalizedCall(snapshot?.qso.call);
  const matched = /^[A-Z0-9/-]{3,32}$/.test(call);
  useEffect(() => {
    mounted.current = true; follower.activate();
    const stop = connectOperatorDraftChanges(follower.refresh, health.failed, health.recovered, health.subscribed);
    return () => { mounted.current = false; stop(); follower.dispose(); };
  }, [follower, health]);
  useEffect(() => connectLogbookChanges(() => setHistoryRefresh(value => value + 1), setHistoryWarning), []);
  useEffect(() => {
    const focus = () => { setLookupRefresh(value => value + 1); setPreferencesRefresh(value => value + 1); };
    window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    let active = true;
    if (!matched || !identity) return;
    void cache.lookup(identity, call).then(profile => { if (active) setLookup({ key: identity, profile }); })
      .catch(() => { if (active) setLookup({ key: identity, profile: { call, source: "Lookup unavailable", lookup_warning: "Callsign lookup is unavailable. Refresh to retry." } }); });
    return () => { active = false; };
  }, [identity, call, matched, cache, lookupRefresh]);
  useEffect(() => {
    let active = true;
    if (!matched || !identity) return;
    void request("logbook_previous", { call, limit: 10 }).then(value => {
      if (active) setPrevious({ key: identity, rows: Array.isArray(value?.qsos) ? value.qsos.filter((qso: any) => normalizedCall(qso?.call) === call) : [] });
    }).catch(() => { if (active) setPrevious({ key: identity, rows: [] }); });
    return () => { active = false; };
  }, [identity, call, matched, request, historyRefresh]);
  useEffect(() => {
    let active = true; if (!generation) return;
    void request("workspace_preferences_load", {}).then(value => {
      const bands = value?.preferences?.intelligenceBands;
      if (!Array.isArray(bands) || !bands.length || bands.some(band => !validBands.has(band)) || new Set(bands).size !== bands.length)
        throw new Error("Invalid band preferences");
      if (active) setPreferences({ generation, bands });
    }).catch(() => { if (active) setPreferences({ generation, error: "Band preferences are unavailable; showing the default bands." }); });
    return () => { active = false; };
  }, [generation, request, preferencesRefresh]);
  const refresh = useCallback(() => {
    cache.invalidate(identity); setLookupRefresh(value => value + 1); setPreferencesRefresh(value => value + 1); setHistoryRefresh(value => value + 1);
    void follower.refresh().then(verified => { if (mounted.current && verified) health.recovered(); })
      .catch(cause => { if (mounted.current) health.failed(cause instanceof Error ? cause.message : "Shared draft unavailable."); });
  }, [cache, identity, follower, health]);
  const dockBack = async () => {
    if (dockingRef.current) return;
    dockingRef.current = true; setDocking(true); setDockError("");
    try { await dock(); }
    catch { if (mounted.current) setDockError("Could not dock Callsign Intelligence. The reader remains open; try again."); }
    finally { dockingRef.current = false; if (mounted.current) setDocking(false); }
  };
  return <div className="app live monitor-app detached-intelligence-app"><main aria-label="Detached Callsign Intelligence">
    <div className="live-actions detached-intelligence-actions"><span role="status" className="secondary">Following the saved new-QSO draft · read only</span>
      <button type="button" onClick={refresh} disabled={state.reading || docking}>Refresh</button>
      <button type="button" onClick={() => void dockBack()} disabled={docking}>{docking ? "Docking…" : "Dock back"}</button></div>
    {(warning || state.error) && <p className="live-error" role="alert">{warning || state.error}</p>}
    {historyWarning && <p className="live-error" role="status">{historyWarning}</p>}
    {dockError && <p className="live-error" role="alert">{dockError}</p>}
    {preferences?.generation === generation && preferences.error && <p className="live-error" role="status">{preferences.error}</p>}
    {!state.available && !state.error && <p role="status" className="secondary">Loading the shared new-QSO draft…</p>}
    <div className="detached-intelligence-content"><DeskIntelligence draft={snapshot?.qso ?? null}
      lookup={lookup?.key === identity ? lookup.profile : null} previous={previous?.key === identity ? previous.rows : []}
      request={request} refresh={historyRefresh} contextKey={identity} intelligenceBands={preferences?.generation === generation ? preferences.bands : undefined}
      emptyMessage={state.error ? "Shared draft unavailable" : "Enter a callsign in Log QSO"} /></div>
  </main></div>;
}

export function DetachedCallsignIntelligenceSurface() { return <CallsignIntelligenceSurface />; }
