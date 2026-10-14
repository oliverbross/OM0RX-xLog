import { RadioTower } from "lucide-react";
import { antennaBands, antennaTypes, equipmentProfile, type StationEquipment } from "./equipmentPreferences";
import "./StationEquipment.css";

export function EquipmentSettings({ value, onChange }: { value: unknown; onChange: (value: StationEquipment) => void }) {
  const profile = equipmentProfile(value);
  return <section className="equipment-settings"><h2>Station equipment</h2>
    <label>Operator Desk equipment<select aria-label="Operator Desk equipment" value={profile.display} onChange={event => onChange({ ...profile, display: event.target.value as StationEquipment["display"] })}>
      <option value="automatic">Rotator when configured</option><option value="antenna">Fixed antenna</option><option value="hidden">No equipment panel</option>
    </select></label>
    <p>Unconfigured rotators take no dashboard space. An owned rotor session keeps its controls visible until you disconnect it in Rotator settings.</p>
    {profile.display === "antenna" && <><div className="service-fields"><label>Antenna type<select aria-label="Antenna type" value={profile.antenna} onChange={event => onChange({ ...profile, antenna: event.target.value as StationEquipment["antenna"] })}>{Object.entries(antennaTypes).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>Antenna name<input aria-label="Antenna name" value={profile.name} maxLength={64} placeholder="e.g. Garden vertical" onChange={event => onChange({ ...profile, name: event.target.value })} /></label></div>
      <fieldset className="equipment-bands"><legend>Configured bands</legend>{antennaBands.map(band => <label key={band}><input type="checkbox" checked={profile.bands.includes(band)} onChange={event => onChange({ ...profile, bands: event.target.checked ? [...profile.bands, band] : profile.bands.filter(item => item !== band) })} />{band}</label>)}</fieldset>
      <p>For reference only: this does not select an antenna, control a switch, or confirm that the antenna is matched.</p></>}
  </section>;
}

function AntennaDiagram({ type }: { type: StationEquipment["antenna"] }) {
  // A schematic, not a claimed drawing of the operator's physical installation.
  return <svg className="equipment-diagram" viewBox="0 0 120 80" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {type === "vertical" ? <><path d="M60 8V63M60 63L25 73M60 63L95 73M60 63V76" /><path className="equipment-secondary" d="M55 20h10m-10 13h10m-10 13h10" /></> :
      type === "wire" ? <><path d="M15 65V20M105 65V12M15 20Q60 45 105 12" /><path className="equipment-secondary" d="M62 30v38" /></> :
      type === "dipole" ? <><path d="M12 48L60 17l48 31M60 17v54" /><path className="equipment-secondary" d="M55 68h10" /></> :
      type === "yagi" ? <><path d="M60 12v60M27 22h66M33 35h54M39 48h42" /><path className="equipment-secondary" d="M52 74h16" /></> :
      type === "loop" ? <><circle cx="60" cy="33" r="25" /><path d="M60 58v15M45 74h30" /></> : <><path d="M60 18v54M36 8l24 24L84 8M45 74h30" /></>}
  </svg>;
}

export function DeskAntenna({ profile, taskOnly = false }: { profile: StationEquipment; taskOnly?: boolean }) {
  return <section className="desk-panel desk-antenna" aria-label="Configured antenna">{!taskOnly && <h2><RadioTower size={15} aria-hidden="true" />Antenna</h2>}
    <div className="desk-antenna-body"><AntennaDiagram type={profile.antenna} /><div><strong>{profile.name || antennaTypes[profile.antenna]}</strong>{profile.name && <span>{antennaTypes[profile.antenna]}</span>}<small>Configured · no telemetry</small></div></div>
    <div className="desk-antenna-bands" aria-label="Configured antenna bands">{profile.bands.length ? profile.bands.map(band => <span key={band}>{band}</span>) : <small>No bands specified</small>}</div>
  </section>;
}
