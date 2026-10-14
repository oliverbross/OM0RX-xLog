import WorldMap from "../Map";
import { mapRadioFrequency, mapSpots } from "./mapContext";
import { useMapContext } from "./useMapContext";
import { SpotActivationStatus } from "./SpotActivationStatus";

export function DetachedWorldMapSurface() {
  const view = useMapContext(), selected = view.selected;
  const target = selected && Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude)
    ? { call: selected.callsign, lat: selected.latitude, lon: selected.longitude, country: selected.country, locationSource: "Selected cluster report" } : undefined;
  return <div className="app live monitor-app detached-map-app"><header className="station-rail">
    <strong className="brand teal">OM0RX-xLog</strong><span className="cyan">World Map</span>
    <span className="rail-end">{view.spots.length} retained live reports</span>
    <SpotActivationStatus inline status={view.activation.status} reconcile={() => {}} />
    <button type="button" onClick={view.refresh}>Refresh</button>
    <button type="button" disabled={view.docking} onClick={() => void view.dock()}>{view.docking ? "Docking…" : "Dock back"}</button>
  </header><main>
    {view.error && <p className="live-error" role="alert">{view.error}</p>}
    {!view.context ? <p className="secondary">Loading shared native map context…</p> : view.stale && <p className="live-cluster-note" role="status">Shared service updates paused; retained reports may be stale. Refresh to retry.</p>}
    <p className="secondary">Select a report to load the shared QSO and tune the selected radio. Unsaved editor fields block activation.</p>
    <SpotActivationStatus status={view.activation.status} error={view.activation.error} checking={view.activation.requesting} reconcile={() => void view.activation.reconcile()} />
    <div className="live-map full"><WorldMap data={mapSpots(view.spots)} selected={selected?.id ?? null}
      palette={view.context?.cluster.response?.configuration?.palette} home={view.context?.metadata.home}
      dxccStatuses={view.context?.metadata.dxccStatuses} target={target}
      frequencyHz={mapRadioFrequency(view.context)} onSpot={view.activate}
      spotActionLabel="Activate report" locationLabel="Retained reports · shared native context" /></div>
    {selected && <p className="secondary" role="status">Selected report: {selected.callsign} · {selected.frequencyKHz} kHz · {selected.mode || "Mode unavailable"}.</p>}
  </main></div>;
}
