import { useCallback, useEffect, useRef, useState } from "react";
import { connectMapContext, mapClusterFresh, type MapContext } from "./mapContext";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";

export function useMapContext() {
  const [context, setContext] = useState<MapContext | null>(null), [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0), [clock, setClock] = useState(Date.now());
  const [docking, setDocking] = useState(false), [inspected, setInspected] = useState<string | null>(null);
  const dockingRef = useRef(false), active = useRef(true), connection = useRef<ReturnType<typeof connectMapContext> | null>(null);
  useEffect(() => {
    active.current = true;
    connection.current = connectMapContext(value => { setContext(value); setReceivedAt(Date.now()); setReadError(""); }, setReadError);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { active.current = false; connection.current?.dispose(); connection.current = null; clearInterval(timer); };
  }, []);
  const stale = !mapClusterFresh(context, clock) || !receivedAt || clock - receivedAt > 5000 || !!readError;
  const spots: Record<string, any>[] = context?.cluster.response?.snapshot?.spots ?? [];
  const selected = spots.find(spot => spot.id === inspected) ?? spots.find(spot => spot.id === context?.cluster.selected);
  const inspect = (spot: { id?: unknown }) => {
    if (stale || typeof spot.id !== "string" || !spots.some(current => current.id === spot.id)) {
      setError("Refresh shared cluster state before inspecting this report."); return;
    }
    setError(""); setInspected(spot.id);
  };
  const dock = useCallback(async () => {
    if (dockingRef.current) return;
    dockingRef.current = true; setDocking(true); setError("");
    try { await dockDetachedWorkspace(); }
    catch { if (active.current) setError("Could not dock this window. It remains open; try Dock back again."); }
    finally { dockingRef.current = false; if (active.current) setDocking(false); }
  }, []);
  return { context, spots, selected, inspect, stale, error: error || readError, setError, docking, dock, refresh: () => connection.current?.refresh() };
}
