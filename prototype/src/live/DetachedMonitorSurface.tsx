import { useEffect, useRef, useState, type ReactNode } from "react";
import Monitor from "./Monitor";
import WorldMap from "../Map";
import { connectMapContext, mapClusterFresh, mapSpots, type MapContext } from "./mapContext";
import { connectMonitorContext, freshMonitorProjection, monitorRadioAction, monitorRadioFresh, monitorRotorAction, monitorStation, type MonitorContext } from "./monitorContext";
import { connectMonitorTarget, type MonitorTarget } from "./monitorTarget";
import "./DetachedMonitorSurface.css";

type Connection = { refresh: () => void; dispose: () => void };
type Props = {
  connectCore?: (changed: (value: MonitorContext) => void, failed: (message: string) => void) => Connection;
  connectMap?: (changed: (value: MapContext) => void, failed: (message: string) => void) => Connection;
  connectTarget?: (changed: (value: MonitorTarget | null) => void, failed: (message: string) => void) => Connection;
  radioAction?: typeof monitorRadioAction; rotorAction?: typeof monitorRotorAction;
  renderMap?: (value: MapContext | null, stale: boolean) => ReactNode;
};
function OptionalMap({ context, stale, target, frequencyHz }: { context: MapContext | null; stale: boolean; target: MonitorTarget | null; frequencyHz?: number }) {
  const selected = context?.cluster.response?.snapshot?.spots?.find((spot: any) => spot.id === context.cluster.selected);
  return <div className="monitor-map-context">{stale && <p className="secondary" role="status">Map reports unavailable or stale. Station and rotor remain independent.</p>}
    <WorldMap data={mapSpots(context?.cluster.response?.snapshot?.spots ?? [])} selected={selected?.id ?? null}
      palette={context?.cluster.response?.configuration?.palette} home={context?.metadata.home} dxccStatuses={context?.metadata.dxccStatuses}
      target={target?.generation.toLowerCase() === context?.metadata.generation.toLowerCase() ? target : undefined} frequencyHz={frequencyHz} compact />
  </div>;
}
export function MonitorSurface({ connectCore = connectMonitorContext, connectMap = connectMapContext, radioAction = monitorRadioAction,
  rotorAction = monitorRotorAction, connectTarget = connectMonitorTarget, renderMap }: Props) {
  const [context, setContext] = useState<MonitorContext | null>(null), [map, setMap] = useState<MapContext | null>(null);
  const [error, setError] = useState(""), [mapError, setMapError] = useState(""), [clock, setClock] = useState(Date.now());
  const [target, setTarget] = useState<MonitorTarget | null>(null), [targetError, setTargetError] = useState("");
  const latest = useRef<MonitorContext | null>(null), core = useRef<Connection | null>(null), maps = useRef<Connection | null>(null), targets = useRef<Connection | null>(null);
  const active = useRef(true), authority = useRef(false);
  useEffect(() => {
    active.current = true;
    core.current = connectCore(value => { latest.current = value; authority.current = true; setContext(value); setError(""); }, message => {
      authority.current = false; setError(message);
    });
    maps.current = connectMap(value => { setMap(value); setMapError(""); }, setMapError);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active.current = false; authority.current = false; core.current?.dispose(); maps.current?.dispose(); clearInterval(timer); };
  }, [connectCore, connectMap]);
  useEffect(() => {
    const connection = connectTarget(value => { setTarget(value); setTargetError(""); }, setTargetError);
    targets.current = connection; return () => { connection.dispose(); targets.current = null; };
  }, [connectTarget]);
  const freshRadio = authority.current && monitorRadioFresh(context, clock), freshRotor = authority.current && freshMonitorProjection(context?.rotor, clock);
  const synthetic = !!context?.acceptance, mapStale = !!mapError || !mapClusterFresh(map, clock);
  const station = monitorStation(context, clock);
  if (!authority.current) { station.radio.observed = false; station.station.radio_stale = true; station.station.swr_is_live = false; station.rotor.connected = false; }
  const radioRequest = async (method: string, params: Record<string, any> = {}) => {
    if (method !== "station_action" || !authority.current && params.action !== "cancel") throw new Error("Refresh native station observations before sending this action.");
    try { return await radioAction(latest.current, params.action); }
    finally { if (active.current) core.current?.refresh(); }
  };
  const rotorRequest = async (method: string, params: Record<string, any> = {}) => {
    if (!authority.current && method !== "rotor_stop") throw new Error("Refresh native rotor observations before sending this action.");
    try { return await rotorAction(latest.current, method, params); }
    finally { if (active.current) core.current?.refresh(); }
  };
  return <div className="app live monitor-app detached-monitor-app"><main aria-label="Detached Station Monitor">
    <div className="live-actions detached-monitor-actions"><strong>Station Monitor</strong><span className="secondary" role="status">{synthetic ? "Synthetic isolated observation · read only" : "Shared native observations · independent of Desk"}</span>
      <button type="button" onClick={() => { core.current?.refresh(); maps.current?.refresh(); targets.current?.refresh(); }}>Refresh</button></div>
    {error && <p className="live-error" role="alert">{error}</p>}
    {!context && <p className="secondary" role="status">Loading retained native station observations…</p>}
    {context && !context.selection?.provider && <p className="secondary" role="status">No radio selected. Choose and connect a radio in the main station controls.</p>}
    {context?.selection?.provider && !freshRadio && <p className="live-error" role="status">Radio observation unavailable or stale. Only selection-fenced Cancel remains available.</p>}
    {context?.rotor?.snapshot?.owner && !freshRotor && <p className="live-error" role="status">Rotor observation unavailable or stale. Turn is disabled; Stop checks the current native owner.</p>}
    {targetError && <p className="secondary" role="status">Shared QSO map target unavailable. Station and rotor remain independent.</p>}
    <Monitor snapshot={station} map={renderMap ? renderMap(map, mapStale) : <OptionalMap context={map} stale={mapStale} target={target}
      frequencyHz={freshRadio ? station.radio.receive_frequency_hz ?? station.radio.frequency_hz : undefined} />}
      onRequest={context?.selection?.provider && !synthetic ? radioRequest : undefined}
      onRotorRequest={context?.rotor?.snapshot?.owner && !synthetic ? rotorRequest : undefined} />
  </main></div>;
}
export function DetachedMonitorSurface() { return <MonitorSurface />; }
