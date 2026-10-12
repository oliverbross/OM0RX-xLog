import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import "./QSOEditor.css";

type Data = Record<string, any>;
type Props = {
  draft: Data | null; setDraft: (value: SetStateAction<Data | null>) => void;
  save: () => void | Promise<unknown>; clear: () => void; busy: boolean;
  lookup: Data | null; previous: Data[]; follow: boolean; setFollow: (value: boolean) => void;
  request?: (method: string, params?: Data) => Promise<any>;
  onReadRadio?: () => void | Promise<void>;
};
type MatrixCell = { band: string; mode: string; worked: boolean; confirmed: boolean };
type MatrixState = { call: string; adif: number | null; callCells?: MatrixCell[]; countryCells?: MatrixCell[]; callError?: string; countryError?: string };
type Field = { key: string; label: string; kind?: "number" | "textarea" | "enum"; options?: string[] };
const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
const modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"];
const matrixBands = ["80m", "40m", "20m", "15m", "10m"];
const matrixModes = ["CW", "SSB", "FT8"];
function StatusMatrix({ scope, cells }: { scope: string; cells: MatrixCell[] }) {
  const status = (band: string, mode: string) => {
    const matches = cells.filter(cell => cell.band === band && cell.mode === mode);
    return matches.some(cell => cell.confirmed) ? "Confirmed" : matches.some(cell => cell.worked) ? "Worked" : "Unworked";
  };
  const other = Array.from(cells.reduce((bySlot, cell) => {
    if (cell.worked && (!matrixBands.includes(cell.band) || !matrixModes.includes(cell.mode))) {
      const key = `${cell.band}|${cell.mode}`;
      const prior = bySlot.get(key);
      bySlot.set(key, { ...cell, confirmed: cell.confirmed || prior?.confirmed === true });
    }
    return bySlot;
  }, new Map<string, MatrixCell>()).values());
  return <><div className="qso-matrix-scroll"><table className="qso-matrix" aria-label={`${scope} band and mode status`}><thead><tr><th scope="col">Mode</th>{matrixBands.map(band => <th scope="col" key={band}>{band}</th>)}</tr></thead><tbody>{matrixModes.map(mode => <tr key={mode}><th scope="row">{mode}</th>{matrixBands.map(band => {
    const value = status(band, mode);
    return <td key={band} className={`qso-matrix-${value.toLowerCase()}`} aria-label={`${scope} ${band} ${mode}: ${value}`} title={`${band} ${mode}: ${value}`}>{value === "Unworked" ? "—" : value === "Confirmed" ? "C" : "W"}</td>;
  })}</tr>)}</tbody></table></div><p className="qso-matrix-legend">C Confirmed · W Worked · — Unworked</p>{other.length > 0 && <div className="qso-matrix-other" aria-label={`${scope} other band and mode status`}>{other.map(cell => <span key={`${cell.band}|${cell.mode}`} className={cell.confirmed ? "qso-matrix-confirmed" : "qso-matrix-worked"}>{cell.band} {cell.mode} · {cell.confirmed ? "Confirmed" : "Worked"}</span>)}</div>}</>;
}
const groups: Record<string, Field[]> = {
  Station: [
    { key: "stationLocation", label: "Station location" }, { key: "radio", label: "Radio" },
    { key: "txPower", label: "TX power W" }, { key: "operatorCall", label: "Operator" },
    { key: "myCall", label: "Station call" }, { key: "myGrid", label: "Station grid" },
    { key: "receiveFrequencyHz", label: "RX frequency MHz" }, { key: "receiveBand", label: "RX band", kind: "enum", options: bands },
    { key: "propagationMode", label: "Propagation" }, { key: "antennaPath", label: "Antenna path" },
  ],
  General: [
    { key: "name", label: "Name" }, { key: "gridSquare", label: "Gridsquare" },
    { key: "country", label: "Country" }, { key: "dxcc", label: "DXCC", kind: "number" },
    { key: "continent", label: "Continent", kind: "enum", options: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"] },
    { key: "cqZone", label: "CQ zone" }, { key: "ituZone", label: "ITU zone" },
    { key: "state", label: "State" }, { key: "county", label: "County" },
    { key: "qth", label: "Location" }, { key: "email", label: "Email" },
  ],
  References: [
    { key: "potaReference", label: "POTA" }, { key: "sotaReference", label: "SOTA" },
    { key: "iota", label: "IOTA" }, { key: "wwffReference", label: "WWFF" },
    { key: "sig", label: "SIG" }, { key: "sigInfo", label: "SIG info" }, { key: "dok", label: "DOK" },
  ],
  Notes: [{ key: "comment", label: "Comment", kind: "textarea" }, { key: "notes", label: "QSO note", kind: "textarea" }],
  QSL: [
    { key: "qslSent", label: "QSL sent", kind: "enum", options: ["Y", "N", "R", "Q", "I", "V"] },
    { key: "qslReceived", label: "QSL received", kind: "enum", options: ["Y", "N", "R", "Q", "I", "V"] },
    { key: "qslMethod", label: "QSL method", kind: "enum", options: ["B", "D", "E", "M"] },
    { key: "qslVia", label: "QSL via" }, { key: "qslMessage", label: "QSL message", kind: "textarea" },
    { key: "lotwSent", label: "LoTW sent", kind: "enum", options: ["Y", "N", "Q", "I"] },
    { key: "lotwReceived", label: "LoTW received", kind: "enum", options: ["Y", "N", "V", "I"] },
  ],
};
const lookupFields = ["name", "gridSquare", "country", "dxcc", "continent", "cqZone", "ituZone", "state", "county", "qth", "email"];
const call = (value: unknown) => String(value ?? "").trim().toUpperCase();
const iso = (value: unknown): string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) ? value : "";
const datePart = (value: unknown) => iso(value).slice(0, 10);
const timePart = (value: unknown) => iso(value).slice(11, 19);
const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return false;
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
};
const fromParts = (day: string, time: string) => `${day}T${time.length === 5 ? `${time}:00` : time}Z`;
const frequencyText = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) && hz > 0 ? (hz / 1_000_000).toFixed(6) : "";
const parseFrequency = (value: string): number | null => {
  if (!/^\d{1,4}(?:\.\d{1,6})?$/.test(value.trim())) return null;
  const hz = Math.round(Number(value) * 1_000_000);
  return Number.isSafeInteger(hz) && hz >= 1 && hz <= 1_000_000_000_000 ? hz : null;
};
const bandFor = (hz: number): string => {
  const ranges: [number, number, string][] = [[1.8,2,"160m"],[3.5,4,"80m"],[5.25,5.5,"60m"],[7,7.3,"40m"],[10.1,10.15,"30m"],[14,14.35,"20m"],[18.068,18.168,"17m"],[21,21.45,"15m"],[24.89,24.99,"12m"],[28,29.7,"10m"],[50,54,"6m"],[70,70.5,"4m"],[144,148,"2m"],[420,450,"70cm"]];
  const mhz = hz / 1_000_000; return ranges.find(([min,max]) => mhz >= min && mhz < max)?.[2] ?? "";
};

export function QSOEditor({ draft, setDraft, save, clear, busy, lookup, previous, follow, setFollow, request, onReadRadio }: Props) {
  const [tab, setTab] = useState("QSO");
  const [frequencyDraft, setFrequencyDraft] = useState<string | null>(null);
  const [receiveDraft, setReceiveDraft] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, { date: string; time: string }>>({});
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [matrix, setMatrix] = useState<MatrixState | null>(null);
  const [radioBusy, setRadioBusy] = useState(false);
  const [radioError, setRadioError] = useState("");
  const callRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const update = (key: string, value: unknown) => { if (["frequencyHz", "band", "mode"].includes(key)) setFollow(false); setDraft((current) => current ? { ...current, [key]: value } : current); };
  useEffect(() => { setFrequencyDraft(null); setReceiveDraft(null); setTimeDrafts({}); setNumericDrafts({}); setShowErrors(false); }, [draft?.id]);
  useEffect(() => { if (follow) setFrequencyDraft(null); }, [follow]);
  const currentFrequency = frequencyDraft ?? frequencyText(draft?.frequencyHz);
  const currentReceive = receiveDraft ?? frequencyText(draft?.receiveFrequencyHz);
  const currentTime = (key: "start" | "end") => timeDrafts[key] ?? { date: datePart(draft?.[key]), time: timePart(draft?.[key]) };
  const sameLookup = !!draft && !!lookup && call(lookup.call) !== "" && call(lookup.call) === call(draft.call);
  const matchingPrevious = useMemo(() => previous.filter((item) => call(item.call) === call(draft?.call)).slice(0, 6), [previous, draft?.call]);
  const matrixCall = call(draft?.call);
  const matrixADIF = sameLookup && Number.isInteger(lookup?.dxcc) && lookup.dxcc > 0 ? lookup.dxcc as number : null;
  useEffect(() => {
    if (!request || !/^[A-Z0-9/-]{3,32}$/.test(matrixCall)) { setMatrix(null); return; }
    let active = true;
    setMatrix({ call: matrixCall, adif: matrixADIF });
    void request("logbook_matrix", { call: matrixCall }).then(value => {
      if (!active) return;
      setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ?
        { ...current, callCells: Array.isArray(value?.cells) ? value.cells : [],
          callError: Array.isArray(value?.cells) ? undefined : "Call history response is incomplete." } : current);
    }).catch(() => { if (active) setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ? { ...current, callError: "Could not read call history." } : current); });
    if (matrixADIF !== null) void request("cluster_history", { call: matrixCall, adif: matrixADIF }).then(value => {
      if (!active) return;
      const history = value?.history;
      const valid = call(history?.call) === matrixCall && history?.adif === matrixADIF && Array.isArray(history?.matrix);
      setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ?
        { ...current, countryCells: valid ? history.matrix : undefined,
          countryError: valid ? undefined : "Country history response does not match this callsign." } : current);
    }).catch(() => { if (active) setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ? { ...current, countryError: "Could not read country history." } : current); });
    return () => { active = false; };
  }, [request, matrixCall, matrixADIF]);
  const errors: string[] = [];
  if (draft) {
    const normalized = call(draft.call);
    if (!/^[A-Z0-9/-]{3,32}$/.test(normalized)) errors.push("Enter a 3–32 character callsign using letters, digits, slash or hyphen.");
    if (!String(draft.band ?? "").trim()) errors.push("Select a band.");
    if (!String(draft.mode ?? "").trim()) errors.push("Select an operating mode.");
    if (currentFrequency && parseFrequency(currentFrequency) === null) errors.push("Enter a valid operating frequency in MHz or leave it blank.");
    const frequencyHz = parseFrequency(currentFrequency);
    if (frequencyHz && bandFor(frequencyHz) && bandFor(frequencyHz).toLowerCase() !== String(draft.band).toLowerCase()) errors.push(`${currentFrequency} MHz belongs to ${bandFor(frequencyHz)}, not ${draft.band}.`);
    if (currentReceive && parseFrequency(currentReceive) === null) errors.push("Enter a valid RX frequency in MHz or leave it blank.");
    const start = fromParts(currentTime("start").date, currentTime("start").time);
    if (!validDate(start) || Date.parse(start) < Date.UTC(1900,0,1) || Date.parse(start) > Date.UTC(2100,0,1)) errors.push("Enter a valid QSO start date and time in UTC.");
    const endParts = currentTime("end");
    const end = fromParts(endParts.date, endParts.time);
    if ((endParts.date || endParts.time) && (!validDate(end) || Date.parse(end) < Date.parse(start))) errors.push("QSO end must be a valid UTC time after start.");
    if (numericDrafts.dxcc !== undefined && numericDrafts.dxcc !== "" && (!/^\d+$/.test(numericDrafts.dxcc) || Number(numericDrafts.dxcc) < 1)) errors.push("DXCC must be a positive number.");
  }
  const canSave = !!draft && !busy && errors.length === 0;
  const submit = (event?: FormEvent) => { event?.preventDefault(); if (!canSave) { setShowErrors(true); return; } void save(); };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); }
    if (event.key === "Escape") { event.preventDefault(); setTab("QSO"); window.setTimeout(() => callRef.current?.focus(), 0); }
  };
  const changeFrequency = (key: "frequencyHz" | "receiveFrequencyHz", text: string) => {
    if (key === "frequencyHz") setFollow(false);
    key === "frequencyHz" ? setFrequencyDraft(text) : setReceiveDraft(text);
    const hz = text ? parseFrequency(text) : null;
    if (text && hz === null) return;
    setDraft((current) => current ? { ...current, [key]: hz, ...(key === "frequencyHz" && hz && bandFor(hz) ? { band: bandFor(hz) } : {}) } : current);
  };
  const changeTime = (key: "start" | "end", part: "date" | "time", value: string) => {
    const next = { ...currentTime(key), [part]: value };
    setTimeDrafts((current) => ({ ...current, [key]: next }));
    if (key === "end" && !next.date && !next.time) { update("end", null); return; }
    const candidate = fromParts(next.date, next.time);
    if (validDate(candidate)) update(key, candidate);
  };
  const field = ({ key, label, kind, options }: Field) => {
    const value = draft?.[key];
    if (kind === "textarea") return <label key={key} className="qso-field qso-wide"><span>{label}</span><textarea aria-label={label} rows={key === "notes" ? 5 : 3} value={value ?? ""} onChange={(event) => update(key, event.target.value)} /></label>;
    if (key === "receiveFrequencyHz") return <label key={key} className="qso-field"><span>{label}</span><input aria-label={label} inputMode="decimal" value={currentReceive} onChange={(event) => changeFrequency("receiveFrequencyHz", event.target.value)} /></label>;
    if (kind === "enum") return <label key={key} className="qso-field"><span>{label}</span><select aria-label={label} value={value ?? ""} onChange={(event) => update(key, event.target.value)}><option value="">—</option>{value && !options?.includes(String(value)) && <option value={value}>{value}</option>}{options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
    return <label key={key} className="qso-field"><span>{label}</span><input aria-label={label} type={kind === "number" ? "number" : key === "email" ? "email" : "text"} min={kind === "number" ? 1 : undefined} step={kind === "number" ? 1 : undefined} value={kind === "number" ? numericDrafts[key] ?? String(value ?? "") : value ?? ""} onChange={(event) => { const text = event.target.value; if (kind === "number") { setNumericDrafts((current) => ({ ...current, [key]: text })); if (text === "" || /^\d+$/.test(text)) update(key, text ? Number(text) : null); } else update(key, ["myCall", "operatorCall", "myGrid", "gridSquare"].includes(key) ? text.toUpperCase() : text); }} autoComplete="off" spellCheck={false} /></label>;
  };
  const fillLookup = () => {
    if (!sameLookup) return;
    setDraft((current) => {
      if (!current || call(current.call) !== call(lookup?.call)) return current;
      const next = { ...current };
      for (const key of lookupFields) if ((next[key] === "" || next[key] == null) && lookup?.[key] != null && lookup[key] !== "") next[key] = lookup[key];
      return next;
    });
  };
  const readRadio = async () => {
    if (!onReadRadio || busy || radioBusy) return;
    setRadioBusy(true); setRadioError("");
    try { await onReadRadio(); setFrequencyDraft(null); setReceiveDraft(null); }
    catch (cause) { setRadioError(cause instanceof Error ? cause.message : "Radio readback unavailable."); }
    finally { setRadioBusy(false); }
  };
  const matchingMatrix = matrix?.call === matrixCall && matrix.adif === matrixADIF ? matrix : null;
  if (!draft) return <section className="qso-editor" aria-label="Log QSO"><p>Opening logbook…</p></section>;
  return <section className="qso-editor" ref={rootRef} onKeyDown={keyDown} aria-label="Log QSO"><div className="qso-editor-main"><div className="qso-editor-head"><h2>Active contact</h2><span>Local QSO draft · UTC</span></div>
    <form onSubmit={submit} noValidate><div className="qso-primary"><label className="qso-field qso-call"><span>Callsign</span><input ref={callRef} aria-label="Callsign" value={draft.call ?? ""} maxLength={32} onChange={(event) => update("call", event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} /></label><label className="qso-field"><span>Frequency MHz</span><input aria-label="Frequency MHz" inputMode="decimal" value={currentFrequency} onChange={(event) => changeFrequency("frequencyHz", event.target.value)} /></label><label className="qso-field"><span>Band</span><select aria-label="Band" value={draft.band ?? ""} onChange={(event) => update("band", event.target.value)}><option value="">Select band</option>{draft.band && !bands.includes(draft.band) && <option value={draft.band}>{draft.band}</option>}{bands.map((band) => <option key={band}>{band}</option>)}</select></label><label className="qso-field"><span>Mode</span><select aria-label="Mode" value={draft.mode ?? ""} onChange={(event) => update("mode", event.target.value)}><option value="">Select mode</option>{draft.mode && !modes.includes(draft.mode) && <option value={draft.mode}>{draft.mode}</option>}{modes.map((mode) => <option key={mode}>{mode}</option>)}</select></label></div>
      <div className="qso-time-row">{(["start", "end"] as const).map((key) => <div className="qso-utc" key={key}><strong>{key === "start" ? "Start UTC" : "End UTC"}</strong><label><span>Date</span><input aria-label={`${key === "start" ? "Start" : "End"} UTC date`} type="date" value={currentTime(key).date} onChange={(event) => changeTime(key, "date", event.target.value)} /></label><label><span>Time</span><input aria-label={`${key === "start" ? "Start" : "End"} UTC time`} type="time" step={1} value={currentTime(key).time} onChange={(event) => changeTime(key, "time", event.target.value)} /></label></div>)}<div className="qso-reports">{field({ key: "rstSent", label: "RST sent" })}{field({ key: "rstReceived", label: "RST received" })}</div></div>
      <nav className="qso-tabs" aria-label="QSO fields">{["QSO", ...Object.keys(groups), "Metadata"].map((name) => <button type="button" key={name} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === "QSO" && <div className="qso-fields">{field({ key: "submode", label: "Submode" })}<p className="qso-help">Frequency is optional for manual logging. When entered within an amateur band, it sets the matching band. Keep a split RX frequency in Station.</p></div>}
      {groups[tab] && <div className="qso-fields">{groups[tab].map(field)}</div>}
      {tab === "Metadata" && <div className="qso-metadata"><p>Captured identity and sync fields are retained with this draft. ADIF extensions remain editable below.</p><dl>{[["id", "Local ID"], ["wavelogID", "Wavelog ID"], ["stationProfileID", "Station profile ID"], ["updatedAt", "Updated UTC"], ["isDirty", "Local changes"], ["deletedAt", "Deleted UTC"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{draft[key] == null ? "—" : String(draft[key])}</dd></div>)}</dl><h3>Additional ADIF fields</h3><div className="qso-extra">{Object.entries(draft.extraFields ?? {}).map(([key, value]) => <label key={key}><span>{key}</span><input aria-label={`ADIF ${key}`} value={String(value)} onChange={(event) => setDraft((current) => current ? { ...current, extraFields: { ...(current.extraFields ?? {}), [key]: event.target.value } } : current)} /></label>)}</div>{Object.keys(draft.extraFields ?? {}).length === 0 && <p>No additional ADIF fields in this QSO.</p>}</div>}
      {(showErrors || errors.length > 0) && <div className="qso-validation" role="alert">{errors.length ? <ul>{errors.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <span>QSO is ready to save.</span>}</div>}
      {radioError && <p className="qso-radio-error" role="alert">{radioError}</p>}
      <div className="qso-actions"><label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Follow radio</label>{onReadRadio && <button type="button" onClick={() => void readRadio()} disabled={busy || radioBusy}>{radioBusy ? "Reading radio…" : "Read radio"}</button>}<span>Saved locally first. External sync follows separately.</span><button type="button" onClick={clear} disabled={busy}>Clear QSO</button><button className="qso-save" type="submit" disabled={!canSave}>{draft.wavelogID ? "Update QSO" : "Log QSO"} · ⌘↵</button></div>
    </form></div><aside className="qso-inspector"><section><h3>Callsign intelligence</h3><strong>{sameLookup ? lookup?.country || draft.country || "Country unresolved" : draft.country || "Enter a callsign"}</strong><span>{sameLookup ? lookup?.source || "Lookup" : "No matching lookup"}{sameLookup && typeof lookup?.bearing === "number" ? ` · ${Math.round(lookup.bearing)}° · ${Math.round(lookup.distance_km)} km` : ""}</span><button type="button" onClick={fillLookup} disabled={!sameLookup || busy}>Fill empty fields from lookup</button></section><section><h3>Previous QSOs</h3>{matchingPrevious.length ? <div className="qso-previous">{matchingPrevious.map((item, index) => <div key={item.id ?? index}><time>{item.start ? new Date(item.start).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) : "—"}</time><b>{item.band}</b><span>{item.mode}</span><small>{[item.qslReceived, item.lotwReceived].some(value => ["Y", "V"].includes(String(value).toUpperCase())) ? "Confirmed" : "Worked"}</small></div>)}</div> : <p>No local history for this call.</p>}</section>
    <section><h3>Band / mode matrix · callsign</h3>{!request ? <p>Local matrix is unavailable.</p> : !/^[A-Z0-9/-]{3,32}$/.test(matrixCall) ? <p>Enter a callsign to inspect its local history.</p> : matchingMatrix?.callError ? <p>{matchingMatrix.callError}</p> : matchingMatrix?.callCells ? <StatusMatrix scope="Callsign" cells={matchingMatrix.callCells} /> : <p>Checking local call history…</p>}</section>
    <section><h3>Band / mode matrix · country</h3>{matrixADIF === null ? <p>Country status needs a resolved DXCC entity for this callsign.</p> : !request ? <p>Country matrix is unavailable.</p> : matchingMatrix?.countryError ? <p>{matchingMatrix.countryError}</p> : matchingMatrix?.countryCells ? <><p>{lookup?.country || draft.country || `DXCC ${matrixADIF}`} · DXCC {matrixADIF}</p><StatusMatrix scope="Country" cells={matchingMatrix.countryCells} /></> : <p>Checking all local contacts for this DXCC entity…</p>}</section>
    </aside></section>;
}

export default QSOEditor;
