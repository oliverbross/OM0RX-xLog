import { useEffect, useRef, useState } from "react";
import { ClusterPanel } from "./ClusterPanel";
import { initializeNativeClusterResume } from "./clusterResume";
import { useSpotActivation } from "./useSpotActivation";
import { SpotActivationStatus } from "./SpotActivationStatus";
import { announceDetachedClusterReady, onClusterProjection,
  newerClusterProjection, requestViaSession, type ClusterProjection } from "./DetachedClusterBridge";

export function DetachedClusterSurface() {
  const activation = useSpotActivation();
  const [projection, setProjection] = useState<ClusterProjection | null>(null);
  const latestProjection = useRef<ClusterProjection | null>(null);
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    void onClusterProjection(next => {
      if (active && newerClusterProjection(latestProjection.current, next) === next) {
        latestProjection.current = next;
        setProjection(next);
        setReceivedAt(next.received_at_ms ?? 0);
        if (next.available) setError(String(next.response?.resume_error || ""));
      }
    }).then(unlisten => {
      if (!active) { unlisten(); return; }
      stop = unlisten;
      void initializeNativeClusterResume().catch(cause => { if (active) setError(String(cause)); });
      void announceDetachedClusterReady().catch(() => { if (active) setError("Cluster service updates are unavailable. Refresh to retry; no action will be replayed."); });
    }).catch(() => { if (active) setError("Could not subscribe to cluster updates. Close and reopen this window."); });
    return () => { active = false; stop?.(); };
  }, []);
  return <div className="app live monitor-app detached-cluster-app">
    <main>
      {error && <p className="live-error" role="alert">{error}</p>}
      <SpotActivationStatus status={activation.status} error={activation.error} checking={activation.requesting} reconcile={() => void activation.reconcile()} />
      {projection && (!projection.available || receivedAt > 0 && clock - receivedAt > 5_000) && <p className="live-cluster-note" role="status">Cluster service updates paused; the last received spots remain visible. Refresh to check the service.</p>}
      {!projection?.response && <p className="secondary">Loading the shared cluster session…</p>}
      <ClusterPanel taskOnly passive snapshot={projection?.response ?? null} selectedSpotId={projection?.selected ?? null} onRequest={requestViaSession}
        onSelect={spot => {
          if (!projection?.available || !receivedAt || Date.now() - receivedAt > 5_000 || receivedAt - Date.now() > 1000) { setError("Refresh cluster state before selecting a spot."); return; }
          setError("");
          void activation.activate(spot).catch(cause => setError(cause instanceof Error ? cause.message : "Spot activation is unavailable. Check its status before selecting again."));
        }}
        passwordControlsEnabled={false} />
    </main>
  </div>;
}
