import { useState } from "react";
import BandMaps, { BAND_MAP_MODES, BAND_ORDER, type BandMapMode, type BandMapViewPreferences } from "./BandMaps";
import { mapRadioFrequency } from "./mapContext";
import { useMapContext } from "./useMapContext";
import { SpotActivationStatus } from "./SpotActivationStatus";

export function detachedBand(search: string): string {
  const band = new URLSearchParams(search).get("band");
  return band && BAND_ORDER.includes(band) ? band : "20m";
}
function readModes(band: string): BandMapMode[] {
  try {
    const modes: unknown = JSON.parse(localStorage.getItem(`xlog.detached.band-map.${band}.modes`) || "null");
    if (Array.isArray(modes) && modes.every(mode => BAND_MAP_MODES.includes(mode))) return [...new Set(modes)] as BandMapMode[];
  } catch { /* Unavailable storage must not interrupt the map. */ }
  return [...BAND_MAP_MODES];
}
export function DetachedBandMapsSurface() {
  const view = useMapContext();
  const [band] = useState(() => detachedBand(window.location.search));
  const [modes, setModes] = useState(() => readModes(band));
  const preferences: BandMapViewPreferences = { bands: [band], followRadio: false, layout: "row", fontScale: 1, modes };
  const change = (next: BandMapViewPreferences) => {
    const modes = next.modes ?? [...BAND_MAP_MODES];
    setModes(modes);
    try { localStorage.setItem(`xlog.detached.band-map.${band}.modes`, JSON.stringify(modes)); } catch { /* Keep session settings if persistence is unavailable. */ }
  };
  // Old shared activation receipts do not belong to a newly opened map. Keep
  // current request failures and unresolved reservations visible for recovery.
  const status = view.activation.status;
  const showActivation = view.activation.requesting || !!view.activation.error || !!(status && "reservationActive" in status && status.reservationActive);
  return <div className="app live monitor-app detached-map-app detached-band-map-app"><main>
    {view.error && <p className="live-error" role="alert">{view.error}</p>}
    {showActivation && <SpotActivationStatus status={view.activation.status} error={view.activation.error} checking={view.activation.requesting} reconcile={() => void view.activation.reconcile()} />}
    <BandMaps focusedBand={band} spots={view.spots} onSelect={view.activate} radioFrequencyHz={view.context ? mapRadioFrequency(view.context) : undefined}
      preferences={preferences} onPreferencesChange={change} />
  </main></div>;
}
