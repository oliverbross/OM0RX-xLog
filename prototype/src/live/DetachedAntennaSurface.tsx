import { useEffect, useState } from "react";
import { connectAntenna, type AntennaSnapshot } from "./antennaSession";
import { DeskAntenna } from "./StationEquipment";
import "./DetachedReferenceSurface.css";
export function DetachedAntennaSurface() {
  const [projection, setProjection] = useState<AntennaSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dispose = connectAntenna(value => { setProjection(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return dispose;
  }, []);
  const profile = projection?.snapshot, current = verified && projection?.available === true;
  return <div className="app live detached-reference-app detached-antenna-app"><main aria-label="Detached Antenna"><section aria-label="Saved antenna profile">
    {!current && <p role="status">{profile ? "Saved profile unavailable or changing — retained reference only" : "No saved antenna profile. Configure an antenna in Settings → Display."}</p>}
    {profile?.display === "antenna" ? <DeskAntenna taskOnly profile={profile} /> : profile ? <p>No fixed antenna selected. Configure an antenna in Settings → Display.</p> : null}
    {profile && <dl className="detached-reference-metadata"><dt>Saved settings revision</dt><dd>{profile.settings_revision}</dd><dt>Workspace generation</dt><dd>{profile.workspace_generation}</dd></dl>}
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}
