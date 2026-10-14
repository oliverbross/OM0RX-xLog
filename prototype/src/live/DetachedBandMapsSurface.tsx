import { useEffect, useRef, useState } from "react";
import BandMaps, { type BandMapViewPreferences } from "./BandMaps";
import { bandMapView } from "./workspacePreferences";
import { bandMapPatch, checkedPreferenceReply, type PreferenceSnapshot } from "./bandMapPreferenceTransport";
import { workerRequest } from "../worker";
import { mapRadioFrequency } from "./mapContext";
import { useMapContext } from "./useMapContext";
import { mergeBandMapPreferenceIntent } from "./detachedBandMapPreferences";
import { SpotActivationStatus } from "./SpotActivationStatus";

export function DetachedBandMapsSurface() {
  const view = useMapContext(), [optimistic, setOptimistic] = useState<BandMapViewPreferences | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  const pending = useRef(0), queued = useRef(Promise.resolve()), base = useRef<PreferenceSnapshot | null>(null);
  const latestView = useRef<BandMapViewPreferences | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!pending.current && view.context) {
      const incoming = view.context.metadata;
      if (!base.current || incoming.generation !== base.current.generation || incoming.revision >= base.current.revision) {
        base.current = incoming; latestView.current = bandMapView(incoming.preferences, false); setOptimistic(null);
      }
    }
  }, [view.context]);
  const authoritative = view.context ? bandMapView(view.context.metadata.preferences, false) : undefined;
  const preferences = optimistic ?? authoritative;
  const change = (requested: BandMapViewPreferences) => {
    const incoming = view.context?.metadata;
    const source = !base.current || !pending.current && incoming &&
      (incoming.generation !== base.current.generation || incoming.revision >= base.current.revision) ? incoming : base.current;
    if (!preferences || !source) { view.setError("Load shared preferences before changing the band maps."); return; }
    base.current = source;
    const latest = latestView.current ?? preferences;
    const mutation = bandMapPatch(source, false, preferences, requested, latest);
    if (!Object.keys(mutation.patch).length) return;
    const next = mergeBandMapPreferenceIntent(latest, preferences, requested);
    latestView.current = next;
    pending.current++; setOptimistic(next); setPreferenceError("");
    queued.current = queued.current.catch(() => {}).then(async () => {
      const reply = checkedPreferenceReply((await workerRequest("workspace_band_map_apply", mutation)).result);
      if (!active.current) return;
      base.current = reply;
      if (reply.status !== "applied") throw new Error(reply.status === "workspace_changed" ? "Workspace changed. Refresh before changing preferences." : "Another window changed these preferences. Refresh and try again.");
      if (pending.current === 1) { latestView.current = bandMapView(reply.preferences, false); setOptimistic(latestView.current); }
    }).catch(cause => { if (active.current) { setOptimistic(null); setPreferenceError(cause instanceof Error ? cause.message : "Band-map preferences could not be saved. Refresh before retrying."); } })
      .finally(() => { pending.current--; if (active.current && !pending.current) view.refresh(); });
  };
  return <div className="app live monitor-app detached-map-app"><main>
    {view.error && <p className="live-error" role="alert">{view.error}</p>}
    {preferenceError && <p className="live-error" role="alert">{preferenceError}</p>}
    <div className="live-actions"><strong>Band Maps</strong><button type="button" onClick={view.refresh}>Refresh</button>
      <SpotActivationStatus inline status={view.activation.status} reconcile={() => {}} />
      <button type="button" disabled={view.docking} onClick={() => void view.dock()}>{view.docking ? "Docking…" : "Dock back"}</button></div>
    <p className="secondary">Select a marker to load the shared QSO and tune the selected radio. Unsaved editor fields block activation.</p>
    <SpotActivationStatus status={view.activation.status} error={view.activation.error} checking={view.activation.requesting} reconcile={() => void view.activation.reconcile()} />
    {!view.context ? <p className="secondary">Loading shared native band maps…</p> : <>
      {view.stale && <p className="live-cluster-note" role="status">Shared service updates paused; retained reports may be stale. Refresh to retry.</p>}
      <BandMaps spots={view.spots} onSelect={view.activate} radioFrequencyHz={mapRadioFrequency(view.context)}
        preferences={preferences} onPreferencesChange={change} selectionHint="Select a marker to activate its current native report." />
    </>}
    {view.selected && <p className="secondary" role="status">Selected report: {view.selected.callsign}.</p>}
  </main></div>;
}
