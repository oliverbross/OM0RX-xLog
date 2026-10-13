import { useEffect, useRef, useState } from "react";
import { ClusterPanel } from "./ClusterPanel";
import { initializeNativeClusterResume } from "./clusterResume";
import { requestDetachedSpot } from "../worker";
import { announceDetachedClusterReady, dockDetachedWorkspace, onClusterProjection,
  newerClusterProjection, requestViaSession, type ClusterProjection } from "./DetachedClusterBridge";

export function DetachedClusterSurface() {
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
        setReceivedAt(Date.now());
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
  const dock = () => void dockDetachedWorkspace().catch(() => setError("Could not dock this window. Close it and reopen DX Cluster in the main workspace."));
  return <div className="app live monitor-app" style={{ display: "flex", flexDirection: "column" }}>
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {projection && (!projection.available || receivedAt > 0 && clock - receivedAt > 5_000) && <p className="live-cluster-note" role="status">Cluster service updates paused; the last received spots remain visible. Refresh to check the service.</p>}
      {!projection?.response && <p className="secondary">Loading the shared cluster session…</p>}
      <ClusterPanel passive snapshot={projection?.response ?? null} selectedSpotId={projection?.selected ?? null} onRequest={requestViaSession} onDock={dock}
        onSelect={spot => {
          if (!projection?.available || Date.now() - receivedAt > 5_000) { setError("Refresh cluster state before selecting a spot."); return; }
          void requestDetachedSpot("dx-cluster", spot.id).catch(() => setError("Spot selection could not reach the QSO workspace."));
        }}
        passwordControlsEnabled={false} />
    </main>
  </div>;
}
