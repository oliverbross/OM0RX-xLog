import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { bandForRadio } from "./band";
import { antennaCollection, antennaChoice, antennaHeading, rotorTarget, type AntennaProfile } from "./equipmentPreferences";
import { rotorProjection, type RotorSnapshot } from "./rotorControl";

type Data = Record<string, any>;
export type PortablePreset = { id: string; name: string; stationCall: string; operatorCall: string; locator: string; location: string; state: string; ownReferences: Record<string, string[]>; power: string; antennaProfileID?: string | null };
export type PortableOperating = { version: 1; presets: PortablePreset[]; activeContext?: { sessionID: string; revision: number; startedAt: string; preset: PortablePreset } | null };
export const portableOperating = (v: any): PortableOperating => v ?? { version: 1, presets: [], activeContext: null };
// Retain an unfinished trailing token while typing a comma-separated list.
const tokens = (s: string) => s.toUpperCase().split(/[,;]/).map(value => value.trim());
export function antennaSnapshot(qso: Data, p: AntennaProfile): Data {
  return { ...qso, extraFields: { ...qso.extraFields, ...Object.fromEntries(Object.entries({ ID: p.id, NAME: p.name, TYPE: p.antennaType, BANDS: p.bands.join(","), OFFSET: String(p.azimuthOffsetDegrees), REVISION: String(p.revision), ROTOR: p.rotorConfigurationID ?? "" }).map(([k, v]) => ["APP_OM0RXXLOG_ANTENNA_" + k, v])) } };
}
export function applyPortableDefaults(qso: Data, settings: Data): Data {
  const active = portableOperating(settings.portableOperating).activeContext;
  let next: Data = { ...qso, myCall: settings.stationCall, operatorCall: settings.operatorCall, myGrid: settings.gridSquare,
    stationLocation: settings.stationLocation, txPower: settings.defaultPower, extraFields: { ...qso.extraFields } };
  for (const key of Object.keys(next.extraFields)) if (key.startsWith("APP_OM0RXXLOG_PORTABLE_") || ["MY_POTA_REF", "MY_SIG", "MY_SIG_INFO", "MY_SOTA_REF", "MY_WWFF_REF", "MY_IOTA", "MY_STATE"].includes(key)) delete next.extraFields[key];
  for (const key of Object.keys(next.extraFields)) if (key.startsWith("APP_OM0RXXLOG_ANTENNA_")) delete next.extraFields[key];
  const equipment = antennaCollection(settings.stationEquipment), homeAntenna = equipment.profiles.find(a => a.id === equipment.selectedProfileID && !a.archived);
  if (homeAntenna) next = antennaSnapshot(next, homeAntenna);
  if (!active) return next;
  const p = active.preset;
  next = { ...next, myCall: p.stationCall, operatorCall: p.operatorCall, myGrid: p.locator, stationLocation: p.location, txPower: p.power };
  Object.assign(next.extraFields, { MY_STATE: p.state, APP_OM0RXXLOG_PORTABLE_SESSION: active.sessionID, APP_OM0RXXLOG_PORTABLE_NAME: p.name,
    APP_OM0RXXLOG_PORTABLE_REVISION: String(active.revision), APP_OM0RXXLOG_PORTABLE_STARTED: active.startedAt });
  for (const [programme, refs] of Object.entries(p.ownReferences)) {
    const field = ({ POTA: "MY_POTA_REF", SOTA: "MY_SOTA_REF", WWFF: "MY_WWFF_REF", IOTA: "MY_IOTA" } as Record<string, string>)[programme];
    if (field) next.extraFields[field] = refs.join(",");
    if (programme === "POTA" && refs.length) Object.assign(next.extraFields, { MY_SIG: "POTA", MY_SIG_INFO: refs.join(",") });
  }
  const antenna = antennaCollection(settings.stationEquipment).profiles.find(a => a.id === p.antennaProfileID && !a.archived);
  return antenna ? antennaSnapshot(next, antenna) : next;
}
export function PortableSettings({ settings, onChange }: { settings: Data; onChange: (value: PortableOperating) => void }) {
  const value = portableOperating(settings.portableOperating), [selected, setSelected] = useState("");
  const preset = value.presets.find(p => p.id === selected) ?? value.presets[0];
  const update = (patch: Partial<PortablePreset>) => preset && onChange({ ...value, presets: value.presets.map(p => p.id === preset.id ? { ...p, ...patch } : p) });
  return <section className="equipment-settings"><h2>Portable operating defaults</h2><p>These defaults describe the transmitting station. Save settings to start or end the context. Existing drafts retain their values until explicitly applied.</p>
    <label>Portable preset<select aria-label="Portable preset" value={preset?.id ?? ""} onChange={e => setSelected(e.target.value)}><option value="">Choose preset</option>{value.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <button type="button" disabled={value.presets.length >= 32} onClick={() => { const id = crypto.randomUUID(); onChange({ ...value, presets: [...value.presets, { id, name: "Portable station", stationCall: settings.stationCall ?? "", operatorCall: settings.operatorCall ?? "", locator: "", location: "", state: "", ownReferences: {}, power: settings.defaultPower ?? "", antennaProfileID: null }] }); setSelected(id); }}>Add portable preset</button>
    {preset && <><div className="service-fields">{([["name", "Preset name"], ["stationCall", "On-air station callsign"], ["operatorCall", "Portable operator callsign"], ["locator", "Transmitting station locator"], ["location", "Transmitting station location"], ["state", "Own subdivision (MY_STATE)"], ["power", "Portable default power W"]] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} maxLength={key === "location" ? 512 : 64} value={preset[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}</div>
      {(["POTA", "SOTA", "WWFF", "IOTA"] as const).map(programme => <label key={programme}>Own {programme} references<input aria-label={`Own ${programme} references`} value={(preset.ownReferences[programme] ?? []).join(", ")} onChange={e => update({ ownReferences: { ...preset.ownReferences, [programme]: tokens(e.target.value) } })} /></label>)}
      {(preset.ownReferences.POTA ?? []).some(ref => !/^[A-Z0-9]{1,8}-[0-9]{1,8}$/.test(ref)) && <p role="alert">Check own POTA reference syntax. Ordinary contact saving remains available; POTA export validates it separately.</p>}
      <label>Default antenna profile<select value={preset.antennaProfileID ?? ""} onChange={e => update({ antennaProfileID: e.target.value || null })}><option value="">Use station profile</option>{antennaCollection(settings.stationEquipment).profiles.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button type="button" onClick={() => onChange({ ...value, activeContext: { sessionID: crypto.randomUUID(), revision: 0, startedAt: new Date().toISOString(), preset: structuredClone(preset) } })}>Start context after saving</button>
      <button type="button" onClick={() => onChange({ ...value, presets: value.presets.filter(p => p.id !== preset.id) })}>Remove preset</button></>}
    {value.activeContext && <p>Active: {value.activeContext.preset.name} · {value.activeContext.preset.stationCall} · {(value.activeContext.preset.ownReferences.POTA ?? []).join(", ")} <button type="button" onClick={() => onChange({ ...value, activeContext: null })}>End context after saving</button></p>}
  </section>;
}
export function PortableContextBanner({ settings, draft, onApply, onEnd, disabled = false }: { settings: Data; draft: Data; onApply: (qso: Data) => void; onEnd: () => void; disabled?: boolean }) {
  const active = portableOperating(settings.portableOperating).activeContext;
  const captured = draft.extraFields?.APP_OM0RXXLOG_PORTABLE_NAME;
  if (!active && !captured) return null;
  return <section role="status" className="portable-context-banner"><strong>{active ? `Portable: ${active.preset.name}` : "Home defaults restored for next blank contact"}</strong>
    {active && <span> {active.preset.stationCall} · {active.preset.locator} · {(active.preset.ownReferences.POTA ?? []).join(", ")} </span>}
    <small>Current draft: {captured ?? "home / existing context"}</small>
    <button type="button" disabled={disabled} onClick={() => onApply(applyPortableDefaults(draft, settings))}>Apply {active ? "portable" : "home"} defaults to current draft</button>
    {active && <button type="button" disabled={disabled} onClick={onEnd}>End portable context</button>}
  </section>;
}
export function AntennaDraftSelector({ settings, draft, txBand, fresh, onApply, disabled = false, rotor, onGoto }: { settings: Data; draft: Data; txBand: string | null; fresh: boolean; onApply: (qso: Data) => void; disabled?: boolean; rotor?: RotorSnapshot | null; onGoto?: (rotorBearing: number) => void }) {
  const [bearing, setBearing] = useState("");
  const [transmit, setTransmit] = useState<{ band: string | null; fresh: boolean } | null>(null);
  useEffect(() => {
    if (!settings.stationEquipment?.automaticSelection || !isTauri()) { setTransmit(null); return; }
    let active = true, reading = false;
    const read = async () => { if (reading) return; reading = true; try {
      const value = await invoke<Data>("antenna_transmit_context");
      if (active) setTransmit({ band: value.fresh === true ? bandForRadio(value.transmitFrequencyHz) : null, fresh: value.fresh === true });
    } catch { if (active) setTransmit({ band: null, fresh: false }); } finally { reading = false; } };
    void read(); const timer = window.setInterval(() => void read(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, [settings.stationEquipment?.automaticSelection]);
  const choice = antennaChoice(settings.stationEquipment, transmit?.band ?? txBand, transmit?.fresh ?? fresh, draft.extraFields?.APP_OM0RXXLOG_ANTENNA_MANUAL === "Y");
  const profiles = antennaCollection(settings.stationEquipment).profiles.filter(p => !p.archived);
  // Use captured draft offset, never today's edited profile, for the explicitly
  // selected antenna. The raw provider heading remains independently visible.
  const associated = draft.extraFields?.APP_OM0RXXLOG_ANTENNA_ROTOR === "workspace-rotor";
  const offset = Number(draft.extraFields?.APP_OM0RXXLOG_ANTENNA_OFFSET ?? 0), observed = rotorProjection(rotor ?? null);
  if (!profiles.length) return null;
  return <section><label>Antenna software profile<select aria-label="Current draft antenna profile" disabled={disabled} value={draft.extraFields?.APP_OM0RXXLOG_ANTENNA_ID ?? ""} onChange={e => { const p = profiles.find(p => p.id === e.target.value); if (p) { const next = antennaSnapshot(draft, p); next.extraFields.APP_OM0RXXLOG_ANTENNA_MANUAL = "Y"; onApply(next); } }}><option value="">Unknown / choose explicitly</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><small>{choice.reason}{choice.selected ? ` · proposed ${choice.selected.name}` : ""}. Selection applies only to this draft.</small></label>
    {associated && Number.isFinite(offset) && <div><p>Rotor observed: {typeof observed.azimuth === "number" ? `${observed.azimuth}°` : "unknown"} · Antenna observed: {typeof observed.azimuth === "number" ? `${antennaHeading(observed.azimuth, offset)}°` : "unknown"} · captured offset {offset}°</p>
      <label>Desired antenna bearing °<input aria-label="Desired antenna bearing" type="number" min={0} max={360} value={bearing} onChange={e => setBearing(e.target.value)} /></label>
      <button type="button" disabled={disabled || !onGoto || !observed.connected || !bearing.trim() || !Number.isFinite(Number(bearing)) || Number(bearing) < 0 || Number(bearing) > 360} onClick={() => onGoto?.(rotorTarget(Number(bearing), offset))}>Turn antenna to bearing</button><small>Explicit target maps to rotor bearing {bearing.trim() && Number.isFinite(Number(bearing)) ? rotorTarget(Number(bearing), offset) : "—"}°. Profile edits and selection send no movement.</small></div>}
  </section>;
}
