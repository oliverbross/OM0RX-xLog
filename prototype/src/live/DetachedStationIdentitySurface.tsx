import { useEffect, useState } from "react";
import { connectStationIdentity, type IdentityProjection } from "./stationIdentity";
import "./DetachedReferenceSurface.css";
const shown = (value: string | undefined) => value?.trim() || "Not configured";

export function DetachedStationIdentitySurface() {
  const [projection, setProjection] = useState<IdentityProjection | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dispose = connectStationIdentity(value => { setProjection(value); setVerified(true); setError(""); },
      message => { setVerified(false); setError(message); }, () => setVerified(false));
    return dispose;
  }, []);
  const identity = projection?.snapshot, current = verified && projection?.available === true;
  return <div className="app live detached-reference-app detached-identity-app"><main aria-label="Detached Station Identity"><section aria-label="Saved station identity">
    {!current && <p role="status">{identity ? "Saved identity unavailable or changing · retained values only" : "No saved identity has been observed. Configure your station in Settings."}</p>}
    <div className="live-station-readback"><div><span>{current ? "Saved station callsign" : "Retained station callsign"}</span><strong>{shown(identity?.station_call)}</strong></div></div>
    <dl><dt>Operator callsign</dt><dd>{shown(identity?.operator_call)}</dd><dt>Grid</dt><dd>{shown(identity?.grid)}</dd>
      <dt>Location</dt><dd>{shown(identity?.location)}</dd><dt>Logbook mode</dt><dd>{identity?.logbook_mode === "local" ? "Integrated logbook only" : identity?.logbook_mode === "wavelog" ? "Integrated logbook + Wavelog synchronization" : "Unavailable"}</dd>
      <dt>Saved settings revision</dt><dd>{identity?.settings_revision ?? "Unavailable"}</dd>
      <dt>Workspace generation</dt><dd>{identity?.workspace_generation ?? "Unavailable"}</dd>
      <dt>Workspace service generation</dt><dd>{identity?.worker_generation ?? "Unavailable"}</dd>
    </dl>
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
