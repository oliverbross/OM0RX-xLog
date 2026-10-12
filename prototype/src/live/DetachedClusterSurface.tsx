import { useEffect, useRef, useState } from "react";
import { ClusterPanel } from "./ClusterPanel";
import { requestDetachedSpot } from "../worker";
import { announceDetachedClusterReady, dockDetachedWorkspace, onClusterProjection,
  newerClusterProjection, requestViaMain, type ClusterProjection } from "./DetachedClusterBridge";

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
      }
    }).then(unlisten => {
      if (!active) { unlisten(); return; }
      stop = unlisten;
      void announceDetachedClusterReady().catch(() => setError("Main cluster state is unavailable. Dock back and retry."));
    }).catch(() => { if (active) setError("Main cluster state is unavailable. Dock back and retry."); });
    return () => { active = false; stop?.(); };
  }, []);
  const dock = () => void dockDetachedWorkspace().catch(() => setError("Could not dock this window. Close it and reopen DX Cluster in the main workspace."));
  return <div className="app live monitor-app" style={{ display: "flex", flexDirection: "column" }}>
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {receivedAt > 0 && clock - receivedAt > 5_000 && <p className="live-cluster-note" role="status">Main workspace updates paused; cluster data below may be stale.</p>}
      {!projection && <p className="secondary">Waiting for the main cluster workspace…</p>}
      <ClusterPanel passive snapshot={projection?.response ?? null} selectedSpotId={projection?.selected ?? null} onRequest={requestViaMain} onDock={dock}
        onSelect={spot => void requestDetachedSpot("dx-cluster", spot.id).catch(() => setError("Spot selection could not reach the main workspace."))}
        passwordControlsEnabled={false} />
    </main>
  </div>;
}
