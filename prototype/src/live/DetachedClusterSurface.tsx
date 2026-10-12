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
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">DX Cluster</span><span className="rail-end">Live data and actions owned by the main workspace</span><button type="button" onClick={dock}>Dock back</button></header>
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {receivedAt > 0 && clock - receivedAt > 5_000 && <p className="live-cluster-note" role="status">Main workspace updates paused; cluster data below may be stale.</p>}
      {projection ? <ClusterPanel passive snapshot={projection.response} selectedSpotId={projection.selected} onRequest={requestViaMain}
        onSelect={spot => void requestDetachedSpot("dx-cluster", spot.id).catch(() => setError("Spot selection could not reach the main workspace."))}
        passwordControlsEnabled={false} /> : <p className="secondary">Waiting for the main cluster workspace…</p>}
    </main>
  </div>;
}
