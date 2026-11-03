import { RadioTower } from "lucide-react";
import { antennaBands, antennaTypes, equipmentProfile, antennaCollection, selectedAntenna, type AntennaProfile, type StationEquipment } from "./equipmentPreferences";
import "./StationEquipment.css";

export function EquipmentSettings({ value, onChange }: { value: unknown; onChange: (value: StationEquipment) => void }) {
  const profile = equipmentProfile(value);
  const collection = antennaCollection(value), selected = selectedAntenna(value);
  const changeProfile = (next: AntennaProfile) => onChange({ ...collection, profiles: collection.profiles.map(p => p.id === next.id ? { ...next, revision: next.revision + 1 } : p),
    ...(next.id === collection.selectedProfileID ? { antenna: next.antennaType, name: next.name, bands: next.bands } : {}) });
  return <section className="equipment-settings"><h2>Station equipment</h2>
    <label>Operator Desk equipment<select aria-label="Operator Desk equipment" value={profile.display} onChange={event => onChange({ ...profile, display: event.target.value as StationEquipment["display"] })}>
      <option value="automatic">Rotator when configured</option><option value="antenna">Fixed antenna</option><option value="hidden">No equipment panel</option>
    </select></label>
    <p>Unconfigured rotators take no dashboard space. An owned rotor session keeps its controls visible until you disconnect it in Rotator settings.</p>
    <label>Antenna profile<select aria-label="Antenna profile" value={collection.selectedProfileID ?? ""} onChange={event => {
      const p = collection.profiles.find(p => p.id === event.target.value)!;
      onChange({ ...collection, selectedProfileID: p.id, name: p.name, antenna: p.antennaType, bands: p.bands });
    }}><option value="">No selected profile</option>{collection.profiles.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="service-actions"><button type="button" onClick={() => onChange({ ...collection, profiles: [...collection.profiles, { id: crypto.randomUUID(), name: "New antenna", antennaType: "vertical", bands: [], azimuthOffsetDegrees: 0, archived: false, revision: 0 }] })}>Add profile</button>
      <button type="button" disabled={!selected || collection.profiles.length >= 64} onClick={() => selected && onChange({ ...collection, profiles: [...collection.profiles, { ...selected, id: crypto.randomUUID(), name: selected.name + " copy", revision: 0 }] })}>Duplicate profile</button>
      <button type="button" disabled={!selected} onClick={() => selected && onChange({ ...collection, selectedProfileID: null, profiles: collection.profiles.map(p => p.id === selected.id ? { ...p, archived: true, revision: p.revision + 1 } : p) })}>Archive profile</button></div>
    {selected && <fieldset><legend>Selected software profile</legend><label>Profile name<input aria-label="Profile name" value={selected.name} maxLength={64} onChange={e => changeProfile({ ...selected, name: e.target.value })} /></label>
      <label>Profile type<select aria-label="Profile type" value={selected.antennaType} onChange={e => changeProfile({ ...selected, antennaType: e.target.value as AntennaProfile["antennaType"] })}>{Object.entries(antennaTypes).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <fieldset className="equipment-bands"><legend>Profile bands</legend>{antennaBands.map(band => <label key={band}><input type="checkbox" checked={selected.bands.includes(band)} onChange={e => changeProfile({ ...selected, bands: e.target.checked ? [...selected.bands, band] : selected.bands.filter(b => b !== band) })} />{band}</label>)}</fieldset>
      <label>Rotor association<select aria-label="Profile rotor association" value={selected.rotorConfigurationID ?? ""} onChange={e => changeProfile({ ...selected, rotorConfigurationID: e.target.value || null })}><option value="">Fixed antenna / no rotor</option><option value="workspace-rotor">Existing workspace rotor configuration</option></select></label>
      <label>Azimuth offset °<input aria-label="Antenna azimuth offset" type="number" min={-360} max={360} value={selected.azimuthOffsetDegrees} onChange={e => changeProfile({ ...selected, azimuthOffsetDegrees: Number(e.target.value) })} /></label></fieldset>}
    <label><input type="checkbox" checked={collection.automaticSelection} onChange={e => onChange({ ...collection, automaticSelection: e.target.checked })} />Suggest by authoritative transmit band</label>
    {collection.automaticSelection && <fieldset><legend>Transmit-band preferences</legend>{antennaBands.map(band => <label key={band}>{band}<select aria-label={`${band} preferred antenna`} value={collection.bandPreferences[band] ?? ""} onChange={e => { const preferences = { ...collection.bandPreferences }; if (e.target.value) preferences[band] = e.target.value; else delete preferences[band]; onChange({ ...collection, bandPreferences: preferences }); }}><option value="">Ask when several match</option>{collection.profiles.filter(p => !p.archived && p.bands.includes(band)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</fieldset>}
    <p>Profile selection changes future-contact metadata only. It sends no switch, connect or movement command. Saved contacts retain their snapshots.</p>
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
  const selected = selectedAntenna(profile);
  if (selected) profile = { ...profile, antenna: selected.antennaType, name: selected.name, bands: selected.bands };
  return <section className="desk-panel desk-antenna" aria-label="Configured antenna">{!taskOnly && <h2><RadioTower size={15} aria-hidden="true" />Antenna</h2>}
    <div className="desk-antenna-body"><AntennaDiagram type={profile.antenna} /><div><strong>{profile.name || antennaTypes[profile.antenna]}</strong>{profile.name && <span>{antennaTypes[profile.antenna]}</span>}<small>Software profile · no switch telemetry</small></div></div>
    <div className="desk-antenna-bands" aria-label="Configured antenna bands">{profile.bands.length ? profile.bands.map(band => <span key={band}>{band}</span>) : <small>No bands specified</small>}</div>
  </section>;
}
