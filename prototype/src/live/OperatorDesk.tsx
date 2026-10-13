import { useEffect, useRef, useState, type SetStateAction, type ReactNode } from "react";
import { Radio, Navigation, CircleX, CircleCheck } from "lucide-react";
import { DeskIntelligence } from "./CallsignIntelligence";
export { DeskIntelligence } from "./CallsignIntelligence";
import { bandForRadio } from "./BandMaps";
import { rotorCommandParams, rotorProjection, type RotorSnapshot } from "./rotorControl";
import "./OperatorDesk.css";
import RotorCompass from "./RotorCompass";
import { DeskAntenna } from "./StationEquipment";
import { deskEquipmentKind, equipmentProfile, hasConfiguredRotor } from "./equipmentPreferences";
import QSOHeader, { type ReferenceEvidence } from "./QSOHeader";
import { useDuplicateContact } from "./useDuplicateContact";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
type Props = { draft: Data | null; setDraft: (value: SetStateAction<Data | null>) => void; save: () => void; clear: () => void; busy: boolean; draftLocked?: boolean; referenceEvidence?: ReferenceEvidence | null;
  lookup: Data | null; previous: Data[]; request: Request; refresh: number; onEditor: () => void; onReadRadio: () => Promise<void>;
  follow: boolean; setFollow: (value: boolean) => void; rotor: RotorSnapshot | null; autoRotor: boolean; setAutoRotor: (value: boolean) => void; onManualRotor: () => void; isEditing?: boolean; intelligenceBands?: string[]; equipment?: unknown; cwControls?: ReactNode };
const normalizedCall = (value: unknown) => String(value ?? "").trim().toUpperCase();
const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
const modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"];
const utc = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
// Same mean Earth radius as XLogCore/Geo.swift, which supplies lookup distances.
export function rotorPathDistance(shortPath: unknown, path: "SP" | "LP"): number | undefined {
  const circumference = 2 * Math.PI * 6371.0088;
  return finite(shortPath) && shortPath >= 0 && shortPath <= circumference / 2
    ? path === "SP" ? shortPath : circumference - shortPath : undefined;
}

export function DeskQSO({ draft, setDraft, save, clear, busy, draftLocked, onEditor, onReadRadio, follow, setFollow, isEditing, cwControls, referenceEvidence, request, refresh }: Props) {
  const duplicateDate = useDuplicateContact(draft, isEditing, request, refresh);
  const [frequencyText, setFrequencyText] = useState<string | null>(null);
  const [timeText, setTimeText] = useState<{ date: string; time: string } | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState("");
  const draftIdentity = useRef(draft?.id); draftIdentity.current = draft?.id;
  useEffect(() => { setFrequencyText(null); setTimeText(null); setError(""); }, [draft?.id]);
  useEffect(() => { if (follow) setFrequencyText(null); }, [follow]);
  if (!draft) return <section className="desk-panel desk-active"><h2><Radio size={15} /> Active QSO</h2><p>Opening logbook…</p></section>;
  const update = (key: string, value: unknown) => {
    if (["frequencyHz", "band", "mode"].includes(key)) setFollow(false);
    setDraft(current => current ? { ...current, [key]: value, ...(key === "sigInfo" && value && !current.sig ? { sig: "COTA" } : {}) } : current);
  };
  const textField = (key: string, title: string, className = "") => <label className={className}><span>{title}</span><input aria-label={`Desk ${title}`} value={draft[key] ?? ""} maxLength={key === "call" ? 32 : undefined} onChange={event => update(key, ["call", "gridSquare"].includes(key) ? event.target.value.toUpperCase() : event.target.value)} autoComplete="off" spellCheck={false} /></label>;
  const selectField = (key: string, title: string, options: string[]) => <label><span>{title}</span><select aria-label={`Desk ${title}`} value={draft[key] ?? ""} onChange={event => update(key, event.target.value)}><option value="">—</option>{draft[key] && !options.includes(draft[key]) && <option>{draft[key]}</option>}{options.map(value => <option key={value}>{value}</option>)}</select></label>;
  const start = utc(draft.start), date = timeText?.date ?? start.slice(0, 10), time = timeText?.time ?? start.slice(11, 19);
  const changeTime = (key: "date" | "time", value: string) => {
    const next = { date, time, [key]: value }; setTimeText(next);
    const candidate = `${next.date}T${next.time.length === 5 ? next.time + ":00" : next.time}Z`;
    if (next.date && next.time && Number.isFinite(Date.parse(candidate)) && utc(candidate).slice(0, 10) === next.date) update("start", candidate);
  };
  const mhz = frequencyText ?? (finite(draft.frequencyHz) && draft.frequencyHz > 0 ? (draft.frequencyHz / 1e6).toFixed(6) : "");
  const validFrequency = !mhz || /^\d+(?:\.\d{0,6})?$/.test(mhz) && Number(mhz) > 0 && Number(mhz) <= 1_000_000;
  const candidate = `${date}T${time.length === 5 ? time + ":00" : time}Z`;
  const validTime = !!date && !!time && Number.isFinite(Date.parse(candidate)) && utc(candidate).slice(0, 10) === date;
  const frequencyBand = mhz && validFrequency ? bandForRadio(Math.round(Number(mhz) * 1e6)) : null;
  const canSave = !busy && !reading && /^[A-Z0-9/-]{3,32}$/.test(normalizedCall(draft.call)) && validFrequency && validTime && !!draft.band && !!draft.mode && (!frequencyBand || frequencyBand === draft.band);
  const read = async () => { const identity = draft.id; setReading(true); setError(""); try { await onReadRadio(); if (draftIdentity.current === identity) setFrequencyText(null); } catch (cause) { if (draftIdentity.current === identity) setError(cause instanceof Error ? cause.message : "Radio readback unavailable."); } finally { setReading(false); } };
  return <section className="desk-panel desk-active" aria-label="Active QSO"><QSOHeader title="Active QSO" call={draft.call} evidence={referenceEvidence} duplicateDate={duplicateDate} /><form inert={draftLocked} aria-busy={draftLocked} onSubmit={event => { event.preventDefault(); if (canSave) save(); }} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (canSave) save(); }
    if (event.key === "Escape") { event.preventDefault(); event.currentTarget.querySelector<HTMLInputElement>('[aria-label="Desk Callsign"]')?.focus(); }
  }}>
    <div className="desk-active-primary">{textField("call", "Callsign", "desk-call")}
      <label className="desk-date"><span>Date</span><input aria-label="Desk UTC date" type="date" value={date} onChange={event => changeTime("date", event.target.value)} /></label>
      <label><span>UTC</span><input aria-label="Desk UTC time" type="time" step={1} value={time} onChange={event => changeTime("time", event.target.value)} /></label>
      <label className="desk-frequency"><span>Frequency MHz</span><input aria-label="Desk Frequency MHz" inputMode="decimal" value={mhz} aria-invalid={!validFrequency} onChange={event => {
        const value = event.target.value; setFollow(false); setFrequencyText(value);
        if (!value) update("frequencyHz", null);
        else if (/^\d+(?:\.\d{0,6})?$/.test(value) && Number(value) > 0 && Number(value) <= 1_000_000) {
          const frequencyHz = Math.round(Number(value) * 1e6), band = bandForRadio(frequencyHz);
          setDraft(current => current ? { ...current, frequencyHz, ...(band ? { band } : {}) } : current);
        }
      }} /></label>{selectField("band", "Band", bands)}{selectField("mode", "Mode", modes)}{textField("rstSent", "RST S")}{textField("rstReceived", "RST R")}
    </div>
    <div className="desk-active-location">{textField("name", "Name")}{textField("comment", "Comment")}{textField("gridSquare", "Grid")}{textField("country", "Country")}{textField("county", "County")}</div>
    <div className="desk-active-references">{textField("potaReference", "POTA")}{textField("sotaReference", "SOTA")}{textField("iota", "IOTA")}{textField("wwffReference", "WWFF")}{textField("sigInfo", "Castle")}</div>
    {error && <p className="desk-error" role="alert">{error}</p>}
    {(!validFrequency || !validTime || frequencyBand && frequencyBand !== draft.band) && <p className="desk-error" role="alert">Check the UTC date, frequency and band before logging.</p>}
    <footer className="desk-active-actions"><button type="button" onClick={onEditor}>Full editor</button><button type="button" disabled={busy || reading} onClick={() => void read()}><Radio size={12} />{reading ? "Reading…" : "Read radio"}</button><label className="desk-toggle"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />Follow radio</label><span /><button type="button" disabled={busy} onClick={clear}><CircleX size={12} />Clear QSO</button><button className="desk-log" disabled={!canSave}><CircleCheck size={13} />{isEditing ? "Update QSO" : "Log QSO"}</button></footer>
  </form>{cwControls}</section>;
}

export function DeskRotor({ draft, lookup, rotor, request, autoRotor, setAutoRotor, onManualRotor }: Props) {
  const [path, setPath] = useState<"SP" | "LP">("SP"), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const observed = rotorProjection(rotor), call = normalizedCall(draft?.call);
  const info = call && normalizedCall(lookup?.call) === call ? lookup : null;
  const bearing = path === "SP" ? info?.bearing : info?.long_path_bearing;
  const distance = rotorPathDistance(info?.distance_km, path);
  const turn = async (nextPath: "SP" | "LP") => {
    const nextBearing = nextPath === "SP" ? info?.bearing : info?.long_path_bearing;
    if (!observed.connected || !finite(nextBearing) || nextBearing < 0 || nextBearing > 360 || busy) return;
    onManualRotor(); setPath(nextPath); setBusy(true); setMessage("");
    try { await request("rotor_goto", rotorCommandParams(rotor, { bearing: nextBearing, label: call })); setMessage(`${nextPath} move accepted; watch the observed bearing.`); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Rotor motion unavailable."); }
    finally { setBusy(false); }
  };
  const stop = async () => { onManualRotor(); setMessage(""); try { await request("rotor_stop", rotorCommandParams(rotor)); setMessage("Stop accepted; watch the observed rotor state."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Rotor stop unavailable."); } };
  return <section className="desk-panel desk-rotor" aria-label="Rotor"><h2><Navigation size={15} aria-hidden="true" /> Rotor</h2><div className="desk-rotor-body"><RotorCompass connected={observed.connected} azimuth={observed.azimuth} target={bearing} path={path} />
      <div className="desk-rotor-target"><small className={observed.connected ? "teal" : "desk-offline"}>● {observed.connected ? "ROTOR CONNECTED" : "ROTOR OFFLINE"}</small><strong>{call || "—"}</strong><span>{info?.gridSquare || "No grid"} · {finite(info?.latitude) && finite(info?.longitude) ? "Position resolved" : "No position"}</span><div className="desk-current"><b>{observed.connected && finite(observed.azimuth) ? `${Math.round(observed.azimuth).toString().padStart(3, "0")}°` : "---°"}</b><small>CURRENT</small></div><p><b>{path} {finite(bearing) ? `${Math.round(bearing)}°` : "---°"}</b> <span>— {finite(distance) ? `${Math.round(distance).toLocaleString()} km` : "km"}</span></p><span>{observed.status || "Rotor telemetry unavailable"}</span></div></div>
    <div className="desk-rotor-actions"><button type="button" aria-label="Turn rotor short path" aria-pressed={path === "SP"} disabled={busy || !observed.connected || !finite(info?.bearing)} onClick={() => void turn("SP")}>{finite(info?.bearing) ? `SP · ${Math.round(info.bearing)}°` : "SP"}</button><button type="button" aria-label="Turn rotor long path" aria-pressed={path === "LP"} disabled={busy || !observed.connected || !finite(info?.long_path_bearing)} onClick={() => void turn("LP")}>{finite(info?.long_path_bearing) ? `LP · ${Math.round(info.long_path_bearing)}°` : "LP"}</button><button type="button" aria-label="Stop desk rotor" className="desk-stop" disabled={!rotor?.owner} onClick={() => void stop()}>■ Stop</button></div>
    <label className="desk-toggle" title="When enabled, turn short path to the resolved callsign, including a typed call. Selected spots wait for confirmed radio tuning. Stop or reconnect disables automatic turns."><input type="checkbox" checked={autoRotor} disabled={!observed.connected} onChange={event => setAutoRotor(event.target.checked)} />Auto rotor</label>{message && <p className="desk-rotor-result" role="status">{message}</p>}
  </section>;
}

export default function OperatorDesk(props: Props) {
  const profile = equipmentProfile(props.equipment);
  const kind = deskEquipmentKind(profile, props.rotor, hasConfiguredRotor(localStorage));
  return <div className="operator-desk"><div className={`operator-desk-top${kind === "none" ? " without-equipment" : ""}`}><DeskQSO {...props} /><DeskIntelligence {...props} />{kind === "rotor" ? <DeskRotor {...props} /> : kind === "antenna" ? <DeskAntenna profile={profile} /> : null}</div></div>;
}
