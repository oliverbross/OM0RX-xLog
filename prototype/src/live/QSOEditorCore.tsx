import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { Radio, PanelsTopLeft, UserRound, Star, RadioTower, ContactRound, History, Grid3X3, CircleX, CircleCheck } from "lucide-react";
import "./QSOEditor.css";
import QSOHeader, { ReferenceEvidenceStatus, type ReferenceEvidence } from "./QSOHeader";
import type { DraftPowerIntent, DraftPowerState } from "./operatorDraftSession";
import { dxccIdentity } from "./dxccIdentity";
import { countryDisplay } from "./countryDisplay";
import { connectLogbookChanges } from "./logbookWindows";
import { fillEmptyLookupFields } from "./draftEnrichment";
import { QSOExtraFields } from "./QSOExtraFields";
import { qsoBands as bands, qsoFieldGroups as groups, qsoModes as modes, type QSOField as Field } from "./qsoFields";
import { applyModeSignalReportDefaults } from "./signalReportDefaults";
import { useQSOFieldPreferences } from "./useQSOFieldPreferences";
import type { QSOCanvasPanel } from "./QSOEditorCanvas";
import { useDuplicateContact } from "./useDuplicateContact";

type Data = Record<string, any>;
export function safeProfileURL(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      host === "xmldata.qrz.com") return null;
    return url.href;
  } catch { return null; }
}
export type QSOEditorProps = {
  draft: Data | null; setDraft: (value: SetStateAction<Data | null>) => void;
  save: () => void | Promise<unknown>; clear: () => void; busy: boolean; draftLocked?: boolean;
  lookup: Data | null; previous: Data[]; follow: boolean; setFollow: (value: boolean) => void;
  request?: (method: string, params?: Data) => Promise<any>;
  onReadRadio?: () => void | Promise<void>;
  automaticStationMetadata?: Array<{ label: string; value: string; provenance: "observed" | "configured" | "selected" }>;
  isEditing?: boolean;
  radioControls?: boolean;
  followControls?: boolean;
  inspector?: boolean;
  clearLabel?: string;
  referenceEvidence?: ReferenceEvidence | null;
  powerState?: DraftPowerState | null; powerIntent?: DraftPowerIntent | null; automaticPowerEnabled?: boolean;
  onManualPower?: (value: string) => void; onResumeAutomaticPower?: () => void;
  onLocalInputState?: (dirty: boolean) => void;
  resetInputEpoch?: number;
  canAcceptLocalInput?: () => boolean;
  onUndock?: () => void;
  contactActions?: ReactNode;
  canvas?: ComponentType<{ panels: QSOCanvasPanel[]; disabled?: boolean }>;
};
type MatrixCell = { band: string; mode: string; worked: boolean; confirmed: boolean };
type MatrixState = { call: string; adif: number | null; callCells?: MatrixCell[]; countryCells?: MatrixCell[]; countryHistory?: Data; callError?: string; countryError?: string };
const matrixBands = ["80m", "40m", "20m", "15m", "10m"];
const matrixModes = ["CW", "SSB", "FT8"];
function StatusMatrix({ scope, cells }: { scope: string; cells: MatrixCell[] }) {
  const status = (band: string, mode: string) => {
    const matches = cells.filter(cell => cell.band === band && cell.mode === mode);
    return matches.some(cell => cell.confirmed) ? "Confirmed" : matches.some(cell => cell.worked) ? "Worked" : "Unworked";
  };
  return <><div className="qso-matrix-scroll"><table className="qso-matrix" aria-label={`${scope} band and mode status`}><thead><tr><th scope="col">Mode</th>{matrixBands.map(band => <th scope="col" title={band} key={band}>{band}</th>)}</tr></thead><tbody>{matrixModes.map(mode => <tr key={mode}><th scope="row" title={mode}>{mode}</th>{matrixBands.map(band => {
    const value = status(band, mode);
    return <td key={band} className={`qso-matrix-${value.toLowerCase()}`} aria-label={`${scope} ${band} ${mode}: ${value}`} title={`${band} ${mode}: ${value}`}>{value === "Unworked" ? "—" : value === "Confirmed" ? "C" : "W"}</td>;
  })}</tr>)}</tbody></table></div><p className="qso-matrix-legend">C Confirmed · W Worked · — Unworked</p></>;
}
function QRZPhotoViewer({ image, callsign, trigger, onClose, onError }: { image: string; callsign: string; trigger: RefObject<HTMLButtonElement | null>; onClose: () => void; onError: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current, opener = trigger.current;
    if (!element) return;
    if (typeof element.showModal === "function") element.showModal(); else element.setAttribute("open", "");
    closeButton.current?.focus();
    return () => { if (element.open && typeof element.close === "function") element.close(); if (opener?.isConnected) opener.focus(); };
  }, [image, callsign, trigger]);
  return <dialog ref={dialog} className="qso-photo-viewer" aria-label={`Full-size QRZ photo for ${callsign}`} onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onClose(); } else if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); } }}>
    <header><h2>{callsign} · QRZ photo</h2><button ref={closeButton} type="button" onClick={onClose}>Close photo</button></header>
    <img src={image} alt={`${callsign} full-size QRZ profile photo`} referrerPolicy="no-referrer" onError={onError} />
  </dialog>;
}
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

export function draftPowerDescription(draft: Data, power?: DraftPowerState | null, intent?: DraftPowerIntent | null, enabled = false): string {
  if (intent?.action === "manual") return "Manual override · awaiting save.";
  if (intent?.action === "automatic") return "Automatic capture · awaiting save.";
  if (power?.manualOverride) return power.enabled ? "Manual override." : "Manual override · automatic capture off.";
  if (!power) return enabled ? "Measured output unavailable." : "Automatic capture off.";
  const contact = power.contact;
  const sameContact = contact.draftID.toLowerCase() === String(draft.id).toLowerCase() && contact.call === call(draft.call) &&
    contact.band === String(draft.band ?? "").trim().toLowerCase() && contact.mode === String(draft.mode ?? "").trim().toUpperCase() &&
    (contact.frequencyHz ?? null) === (draft.frequencyHz ?? null);
  if (!sameContact) return "Waiting for the current contact to be saved.";
  if (power.selectedSample) return power.enabled ? "Captured KPA500 output · retained for this contact." : "Captured KPA500 output · automatic capture off.";
  if (!power.enabled) return "Automatic capture off.";
  return power.activeScope ? "Default fallback · no measured output captured." : "Default fallback · measured output unavailable.";
}

export function QSOEditor({ draft, setDraft: writeDraft, save, clear, busy, draftLocked, lookup, previous, follow, setFollow, request, onReadRadio, automaticStationMetadata = [], isEditing = false, radioControls = true, followControls = radioControls, clearLabel = "Clear QSO", referenceEvidence,
  powerState, powerIntent, automaticPowerEnabled, onManualPower, onResumeAutomaticPower, onLocalInputState, resetInputEpoch, canAcceptLocalInput, onUndock, contactActions, inspector = true, canvas: Canvas }: QSOEditorProps) {
  const acceptsInput = () => !draftLocked && (canAcceptLocalInput?.() ?? true);
  const setDraft: QSOEditorProps["setDraft"] = value => { if (acceptsInput()) writeDraft(value); };
  const [frequencyDraft, setFrequencyDraft] = useState<string | null>(null);
  const [receiveDraft, setReceiveDraft] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, { date: string; time: string }>>({});
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [newADIFName, setNewADIFName] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [matrix, setMatrix] = useState<MatrixState | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyRefreshError, setHistoryRefreshError] = useState("");
  const historyReadGeneration = useRef(0);
  const [radioBusy, setRadioBusy] = useState(false);
  const [radioError, setRadioError] = useState("");
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [viewedImage, setViewedImage] = useState<{ image: string; call: string } | null>(null);
  const qsoFieldPreferences = useQSOFieldPreferences();
  const photoTrigger = useRef<HTMLButtonElement>(null);
  const readDraftIdentity = useRef(draft?.id); readDraftIdentity.current = draft?.id;
  const callRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const update = (key: string, value: unknown) => {
    if (!acceptsInput()) return;
    if (["frequencyHz", "band", "mode"].includes(key)) setFollow(false);
    const backedFields: Record<string, string[]> = {
      end: ["QSO_DATE_OFF", "TIME_OFF"], receiveFrequencyHz: ["FREQ_RX"], receiveBand: ["BAND_RX"],
      antennaPath: ["ANT_PATH"], qslMessage: ["QSLMSG"],
    };
    setDraft((current) => {
      if (!current) return current;
      if (key === "mode" && typeof value === "string") return applyModeSignalReportDefaults(current, value);
      const fields = backedFields[key];
      if (!fields || value !== null && value !== "") return { ...current, [key]: value };
      const extraFields = { ...(current.extraFields ?? {}) };
      for (const field of fields) {
        const stored = Object.keys(extraFields).find(candidate => candidate.toUpperCase() === field);
        if (stored) delete extraFields[stored];
      }
      return { ...current, [key]: value, extraFields };
    });
  };
  useEffect(() => { setFrequencyDraft(null); setReceiveDraft(null); setTimeDrafts({}); setNumericDrafts({}); setNewADIFName(""); setShowErrors(false); }, [draft?.id, resetInputEpoch]);
  useEffect(() => { if (follow) setFrequencyDraft(null); }, [follow]);
  const canonicalBuffers = useRef<Record<string, any> | null>(null);
  useLayoutEffect(() => {
    const next: Record<string, any> = { id: draft?.id, frequencyHz: draft?.frequencyHz, receiveFrequencyHz: draft?.receiveFrequencyHz,
      start: draft?.start, end: draft?.end, dxcc: draft?.dxcc };
    const previous = canonicalBuffers.current;
    canonicalBuffers.current = next;
    if (!previous || previous.id !== next.id) return;
    // A remote same-ID edit must not leave acknowledged text showing an older
    // value than Save will log. Retain genuinely unfinished/different buffers.
    const acknowledgedFrequency = (text: string | null, value: unknown) => text !== null &&
      (text.trim() ? parseFrequency(text) !== null && parseFrequency(text) === value : value == null);
    if (previous.frequencyHz !== next.frequencyHz)
      setFrequencyDraft(text => acknowledgedFrequency(text, previous.frequencyHz) ? null : text);
    if (previous.receiveFrequencyHz !== next.receiveFrequencyHz)
      setReceiveDraft(text => acknowledgedFrequency(text, previous.receiveFrequencyHz) ? null : text);
    setTimeDrafts(current => {
      let changed: typeof current | null = null;
      for (const [key, parts] of Object.entries(current)) {
        if (previous[key] === next[key]) continue;
        const candidate = fromParts(parts.date, parts.time);
        const acknowledged = key === "end" && !parts.date && !parts.time ? previous[key] == null
          : validDate(candidate) && Date.parse(candidate) === Date.parse(previous[key] ?? "");
        if (acknowledged) { changed ??= { ...current }; delete changed[key]; }
      }
      return changed ?? current;
    });
    setNumericDrafts(current => {
      let changed: typeof current | null = null;
      for (const [key, text] of Object.entries(current)) {
        if (previous[key] === next[key]) continue;
        const acknowledged = text === "" ? previous[key] == null : /^\d+$/.test(text) && Number(text) === previous[key];
        if (acknowledged) { changed ??= { ...current }; delete changed[key]; }
      }
      return changed ?? current;
    });
  }, [draft?.id, draft?.frequencyHz, draft?.receiveFrequencyHz, draft?.start, draft?.end, draft?.dxcc]);
  const currentFrequency = frequencyDraft ?? frequencyText(draft?.frequencyHz);
  const currentReceive = receiveDraft ?? frequencyText(draft?.receiveFrequencyHz);
  const currentTime = (key: "start" | "end") => timeDrafts[key] ?? { date: datePart(draft?.[key]), time: timePart(draft?.[key]) };
  // Text buffers can contain unfinished input that has not entered the shared
  // draft. Native close/dock must not mistake it for an acknowledged draft.
  const bufferedFrequency = (text: string | null, value: unknown) => text !== null &&
    (text.trim() ? parseFrequency(text) === null || parseFrequency(text) !== value : value != null);
  const localInputDirty = !!newADIFName || bufferedFrequency(frequencyDraft, draft?.frequencyHz) ||
    bufferedFrequency(receiveDraft, draft?.receiveFrequencyHz) ||
    Object.entries(timeDrafts).some(([key, parts]) => {
      if (key === "end" && !parts.date && !parts.time) return draft?.end != null;
      const candidate = fromParts(parts.date, parts.time);
      return !validDate(candidate) || Date.parse(candidate) !== Date.parse(draft?.[key] ?? "");
    }) || Object.entries(numericDrafts).some(([key, text]) => text === "" ? draft?.[key] != null :
      !/^\d+$/.test(text) || Number(text) !== draft?.[key]);
  useLayoutEffect(() => { onLocalInputState?.(localInputDirty); });
  useLayoutEffect(() => () => { onLocalInputState?.(false); }, [onLocalInputState]);
  const sameLookup = !!draft && !!lookup && call(lookup.call) !== "" && call(lookup.call) === call(draft.call);
  const profile = sameLookup ? lookup : null;
  const profileImage = safeProfileURL(profile?.imageURL);
  const profileWebsite = safeProfileURL(profile?.websiteURL);
  useEffect(() => { setFailedImage(null); setViewedImage(null); }, [profileImage, draft?.call]);
  const matchingPrevious = useMemo(() => previous.filter((item) => call(item.call) === call(draft?.call)).slice(0, 6), [previous, draft?.call]);
  const matrixCall = call(draft?.call);
  const duplicateDate = useDuplicateContact(draft, isEditing, request, 0);
  const matrixADIF = sameLookup && Number.isInteger(lookup?.dxcc) && lookup.dxcc > 0 ? lookup.dxcc as number : null;
  useEffect(() => connectLogbookChanges(() => {
    // Revoke in-flight replies synchronously, before React schedules the next
    // read. A same-call log/confirmation in another window changes this history.
    historyReadGeneration.current += 1;
    setMatrix(null);
    setHistoryRevision(value => value + 1);
  }, setHistoryRefreshError), []);
  useEffect(() => {
    if (!request || !/^[A-Z0-9/-]{3,32}$/.test(matrixCall)) { setMatrix(null); return; }
    let active = true;
    const generation = ++historyReadGeneration.current;
    const currentRead = () => active && historyReadGeneration.current === generation;
    setMatrix({ call: matrixCall, adif: matrixADIF });
    void request("logbook_matrix", { call: matrixCall }).then(value => {
      if (!currentRead()) return;
      setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ?
        { ...current, callCells: Array.isArray(value?.cells) ? value.cells : [],
          callError: Array.isArray(value?.cells) ? undefined : "Call history response is incomplete." } : current);
    }).catch(() => { if (currentRead()) setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ? { ...current, callError: "Could not read call history." } : current); });
    if (matrixADIF !== null) void request("cluster_history", { call: matrixCall, adif: matrixADIF }).then(value => {
      if (!currentRead()) return;
      const history = value?.history;
      const valid = call(history?.call) === matrixCall && history?.adif === matrixADIF && Array.isArray(history?.matrix);
      setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ?
        { ...current, countryCells: valid ? history.matrix : undefined, countryHistory: valid ? history : undefined,
          countryError: valid ? undefined : "Country history response does not match this callsign." } : current);
    }).catch(() => { if (currentRead()) setMatrix(current => current?.call === matrixCall && current.adif === matrixADIF ? { ...current, countryError: "Could not read country history." } : current); });
    return () => { active = false; };
  }, [request, matrixCall, matrixADIF, historyRevision]);
  const errors: string[] = [];
  if (newADIFName) errors.push("Add the new ADIF field or clear its name before saving.");
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
  const submit = (event?: FormEvent) => { event?.preventDefault(); if (!acceptsInput()) return; if (!canSave) { setShowErrors(true); return; } setShowErrors(false); void save(); };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); }
    if (event.key === "Escape") { event.preventDefault(); window.setTimeout(() => callRef.current?.focus(), 0); }
  };
  const changeFrequency = (key: "frequencyHz" | "receiveFrequencyHz", text: string) => {
    if (!acceptsInput()) return;
    onLocalInputState?.(true);
    if (key === "frequencyHz") setFollow(false);
    key === "frequencyHz" ? setFrequencyDraft(text) : setReceiveDraft(text);
    const hz = text ? parseFrequency(text) : null;
    if (text && hz === null) return;
    setDraft((current) => {
      if (!current) return current;
      const extraFields = { ...(current.extraFields ?? {}) };
      if (hz === null) {
        const field = key === "receiveFrequencyHz" ? "FREQ_RX" : "FREQ";
        const stored = Object.keys(extraFields).find(candidate => candidate.toUpperCase() === field);
        if (stored) delete extraFields[stored];
      }
      return { ...current, [key]: hz, extraFields,
        ...(key === "frequencyHz" && hz && bandFor(hz) ? { band: bandFor(hz) } : {}) };
    });
  };
  const changeTime = (key: "start" | "end", part: "date" | "time", value: string) => {
    if (!acceptsInput()) return;
    onLocalInputState?.(true);
    const next = { ...currentTime(key), [part]: value };
    setTimeDrafts((current) => ({ ...current, [key]: next }));
    if (key === "end" && !next.date && !next.time) { update("end", null); return; }
    const candidate = fromParts(next.date, next.time);
    if (validDate(candidate)) update(key, candidate);
  };
  const field = ({ key, label, kind, options }: Field) => {
    const value = draft?.[key];
    if (key === "txPower") {
      const managed = !isEditing && (!!onManualPower || !!powerState);
      const manual = powerIntent?.action === "manual" || !powerIntent && powerState?.manualOverride;
      const automaticEnabled = powerState?.enabled ?? automaticPowerEnabled ?? false;
      return <div key={key} className="qso-power-field"><label className="qso-field"><span>{label}</span><input aria-label={label} aria-describedby={managed ? "qso-power-source" : undefined}
        value={value ?? ""} inputMode="decimal" autoComplete="off" spellCheck={false}
        onInput={event => { if (acceptsInput() && !isEditing && onManualPower) onManualPower(event.currentTarget.value); }}
        onChange={event => { if (isEditing || !onManualPower) update(key, event.target.value); }} /></label>
        {managed && <div id="qso-power-source" className="qso-power-source"><span>{draftPowerDescription(draft!, powerState, powerIntent, automaticPowerEnabled)}</span>
          {manual && onResumeAutomaticPower && <button type="button" disabled={busy || draftLocked || !automaticEnabled}
            title={automaticEnabled ? undefined : "Enable automatic measured power in Station settings first."} onClick={() => { if (acceptsInput()) onResumeAutomaticPower(); }}>Use automatic</button>}</div>}
      </div>;
    }
    if (kind === "textarea") return <label key={key} className="qso-field qso-wide"><span>{label}</span><textarea aria-label={label} rows={key === "notes" ? 5 : 3} wrap="soft" value={value ?? ""} onChange={(event) => update(key, event.target.value)} /></label>;
    if (key === "receiveFrequencyHz") return <label key={key} className="qso-field"><span>{label}</span><input aria-label={label} inputMode="decimal" value={currentReceive} onChange={(event) => changeFrequency("receiveFrequencyHz", event.target.value)} /></label>;
    if (kind === "enum") return <label key={key} className="qso-field"><span>{label}</span><select aria-label={label} value={value ?? ""} onChange={(event) => update(key, event.target.value)}><option value="">—</option>{value && !options?.includes(String(value)) && <option value={value}>{value}</option>}{options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
    return <label key={key} className="qso-field"><span>{label}</span><input aria-label={label} type={kind === "number" ? "number" : key === "email" ? "email" : "text"} min={kind === "number" ? 1 : undefined} step={kind === "number" ? 1 : undefined} value={kind === "number" ? numericDrafts[key] ?? String(value ?? "") : value ?? ""} onChange={(event) => { if (!acceptsInput()) return; const text = event.target.value; if (kind === "number") { onLocalInputState?.(true); setNumericDrafts((current) => ({ ...current, [key]: text })); if (text === "" || /^\d+$/.test(text)) update(key, text ? Number(text) : null); } else update(key, ["myCall", "operatorCall", "myGrid", "gridSquare"].includes(key) ? text.toUpperCase() : text); }} autoComplete="off" spellCheck={false} /></label>;
  };
  const fillLookup = () => {
    if (!acceptsInput() || !sameLookup) return;
    setDraft(current => fillEmptyLookupFields(current, lookup));
  };
  const readRadio = async () => {
    if (!acceptsInput() || !onReadRadio || busy || radioBusy) return;
    const identity = draft?.id;
    setRadioBusy(true); setRadioError("");
    try { await onReadRadio(); if (acceptsInput() && readDraftIdentity.current === identity) { setFrequencyDraft(null); setReceiveDraft(null); } }
    catch (cause) { if (readDraftIdentity.current === identity) setRadioError(cause instanceof Error ? cause.message : "Radio readback unavailable."); }
    finally { setRadioBusy(false); }
  };
  const matchingMatrix = matrix?.call === matrixCall && matrix.adif === matrixADIF ? matrix : null;
  const countryIdentity = dxccIdentity(matrixCall, profile, matchingMatrix?.countryHistory);
  const displayCountry = countryDisplay(profile?.country);
  const displayCountryIdentity = profile?.country && countryIdentity.label.startsWith(profile.country)
    ? displayCountry + countryIdentity.label.slice(profile.country.length) : countryIdentity.label;
  const countryStatus = countryIdentity.status === "neutral" ? "History unresolved" :
    countryIdentity.status === "new" ? "ATNO" : countryIdentity.status === "worked" ? "Worked" : "Confirmed";
  const captured = automaticStationMetadata.filter(item => item && item.label?.trim() && item.value?.trim() &&
    ["observed", "configured", "selected"].includes(item.provenance));
  if (!draft) return <section className="qso-editor" aria-label="Log QSO"><p>Opening logbook…</p></section>;
  const visibleFields = new Set(qsoFieldPreferences.preference.fields);
  const generalFields = groups.General.filter(item => visibleFields.has(item.key));
  const referenceFields = groups.References.filter(item => visibleFields.has(item.key));
  const noteFields = groups.Notes.filter(item => visibleFields.has(item.key));
  const stationFields = groups.Station.filter(item => visibleFields.has(item.key));
  const qslFields = groups.QSL.filter(item => visibleFields.has(item.key));
  const activePanel = <section className="qso-active" aria-labelledby="qso-active-title">
        <QSOHeader title="Active contact" id="qso-active-title"
          actions={onUndock && <button type="button" disabled={busy || draftLocked || localInputDirty} onClick={() => { if (acceptsInput()) onUndock(); }}><PanelsTopLeft size={15} /> Undock</button>} />
        <div className="qso-primary">
          <label className="qso-field qso-call"><span>Callsign</span><input ref={callRef} aria-label="Callsign" value={draft.call ?? ""} maxLength={32} onChange={(event) => update("call", event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} /></label>
          <label className="qso-field qso-frequency"><span>Frequency MHz</span><input aria-label="Frequency MHz" inputMode="decimal" value={currentFrequency} onChange={(event) => changeFrequency("frequencyHz", event.target.value)} /></label>
          <label className="qso-field"><span>Band</span><select aria-label="Band" value={draft.band ?? ""} onChange={(event) => update("band", event.target.value)}><option value="">Select band</option>{draft.band && !bands.includes(draft.band) && <option value={draft.band}>{draft.band}</option>}{bands.map((band) => <option key={band}>{band}</option>)}</select></label>
          <label className="qso-field"><span>Mode</span><select aria-label="Mode" value={draft.mode ?? ""} onChange={(event) => update("mode", event.target.value)}><option value="">Select mode</option>{draft.mode && !modes.includes(draft.mode) && <option value={draft.mode}>{draft.mode}</option>}{modes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
          {onReadRadio && <button className="qso-read-radio" type="button" onClick={() => void readRadio()} disabled={busy || radioBusy}><Radio size={13} aria-hidden="true" /> {radioBusy ? "Reading…" : "Read radio"}</button>}
        </div>
        <div className="qso-time-row"><div className="qso-timing"><div className={`qso-country-identity qso-country-${countryIdentity.status}`} aria-label={`${displayCountryIdentity}: ${countryStatus}`} title={`${displayCountryIdentity}: ${countryStatus}`}><span>{displayCountryIdentity}</span>{countryIdentity.status !== "neutral" && <small>· {countryStatus}</small>}</div><div className="qso-utc"><strong>UTC</strong><label><span>Date</span><input aria-label="Start UTC date" type="date" value={currentTime("start").date} onChange={(event) => changeTime("start", "date", event.target.value)} /></label><label><span>Time</span><input aria-label="Start UTC time" type="time" step={1} value={currentTime("start").time} onChange={(event) => changeTime("start", "time", event.target.value)} /></label></div></div><div className="qso-reports">{field({ key: "rstSent", label: "RST sent" })}{field({ key: "rstReceived", label: "RST received" })}</div></div>
        {radioError && <p className="qso-radio-error" role="alert">{radioError}</p>}
        {historyRefreshError && <p className="qso-radio-error" role="status">{historyRefreshError}</p>}
        {!inspector && <button type="button" onClick={fillLookup} disabled={!sameLookup || busy || draftLocked}>Fill empty fields from lookup</button>}
      </section>;
  const detailsPanel = <section className="qso-details" aria-labelledby="qso-details-title">
        <h2 id="qso-details-title"><PanelsTopLeft size={15} aria-hidden="true" /> QSO details</h2>
        <div className="qso-detail-columns">
          {generalFields.length > 0 && <section className="qso-detail-column" aria-labelledby="qso-contact-title"><h3 id="qso-contact-title"><UserRound size={13} aria-hidden="true" /> Contact &amp; location</h3><div className="qso-fields">{generalFields.map(field)}</div></section>}
          {(referenceFields.length > 0 || noteFields.length > 0 || duplicateDate) && <section className="qso-detail-column" aria-labelledby="qso-reference-title"><h3 id="qso-reference-title"><Star size={13} aria-hidden="true" /> References &amp; notes</h3><div className="qso-fields">{referenceFields.map(field)}<ReferenceEvidenceStatus call={draft.call} evidence={referenceEvidence} />{duplicateDate && <span className="qso-dupe-status" role="status" title="Previously worked on this band and mode · UTC date">Dupe: Worked on {duplicateDate}</span>}{noteFields.map(field)}</div></section>}
          {(captured.length > 0 || stationFields.length > 0 || qslFields.length > 0) && <section className="qso-detail-column" aria-labelledby="qso-station-title"><h3 id="qso-station-title"><RadioTower size={13} aria-hidden="true" /> Station &amp; QSL</h3>
            {captured.length > 0 && <div className="qso-captured"><strong>Station context</strong><dl>{captured.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}<small>{item.provenance}</small></dt><dd>{item.value}</dd></div>)}</dl></div>}
            <div className="qso-fields">{stationFields.map(field)}{qslFields.map(field)}</div>
          </section>}
          {!generalFields.length && !referenceFields.length && !noteFields.length && !captured.length && !stationFields.length && !qslFields.length && <p className="qso-details-empty">No detail fields are selected. Choose them in Settings → Display → QSO details.</p>}
        </div>
        <details className="qso-more"><summary>Additional QSO fields, timing and ADIF metadata</summary><div className="qso-more-content">
          <div className="qso-more-fields">{field({ key: "submode", label: "Submode" })}{groups.StationExtra.map(field)}{groups.QSLExtra.map(field)}</div>
          <div className="qso-utc qso-end-utc"><strong>End UTC</strong><label><span>Date</span><input aria-label="End UTC date" type="date" value={currentTime("end").date} onChange={(event) => changeTime("end", "date", event.target.value)} /></label><label><span>Time</span><input aria-label="End UTC time" type="time" step={1} value={currentTime("end").time} onChange={(event) => changeTime("end", "time", event.target.value)} /></label></div>
          <div className="qso-metadata"><p>Local identity and sync fields are retained. Additional ADIF fields remain editable.</p><dl>{[["id", "Local ID"], ["wavelogID", "Wavelog ID"], ["stationProfileID", "Station profile ID"], ["updatedAt", "Updated UTC"], ["isDirty", "Local changes"], ["deletedAt", "Deleted UTC"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{draft[key] == null ? "—" : String(draft[key])}</dd></div>)}</dl><h3>Additional ADIF fields</h3><QSOExtraFields draft={draft} setDraft={setDraft} disabled={busy || !acceptsInput()} name={newADIFName} setName={setNewADIFName} /></div>
        </div></details>
      </section>;
  const matrixPanel = <section className="qso-matrices" aria-labelledby="qso-matrix-title"><h2 id="qso-matrix-title"><Grid3X3 size={15} aria-hidden="true" /> Band / mode matrix</h2><div className="qso-matrix-columns"><div className="qso-matrix-section"><div className="qso-matrix-heading"><h3>Callsign</h3><p title={matrixCall}>{matrixCall || "Callsign unresolved"}</p></div>{!request ? <p>Local matrix is unavailable.</p> : !/^[A-Z0-9/-]{3,32}$/.test(matrixCall) ? <p>Enter a callsign to inspect its local history.</p> : matchingMatrix?.callError ? <p>{matchingMatrix.callError}</p> : matchingMatrix?.callCells ? <StatusMatrix scope="Callsign" cells={matchingMatrix.callCells} /> : <p>Checking local call history…</p>}</div><div className="qso-matrix-section"><div className="qso-matrix-heading"><h3>Country</h3><p title={matrixADIF === null ? "DXCC entity unresolved" : `${displayCountry || "Country unresolved"} · DXCC ${matrixADIF}`}>{matrixADIF === null ? "DXCC entity unresolved" : `${displayCountry || "Country unresolved"} · DXCC ${matrixADIF}`}</p></div>{matrixADIF === null ? <p>Country status needs a resolved DXCC entity.</p> : !request ? <p>Country matrix is unavailable.</p> : matchingMatrix?.countryError ? <p>{matchingMatrix.countryError}</p> : matchingMatrix?.countryCells ? <StatusMatrix scope="Country" cells={matchingMatrix.countryCells} /> : <p>Checking local contacts for this DXCC entity…</p>}</div></div></section>;
  const intelligencePanel = <aside className="qso-context-panel" aria-label="Contact context"><h2 id="qso-intelligence-title"><ContactRound size={15} aria-hidden="true" /> Callsign intelligence</h2>
        <div className="qso-profile-summary">{profileImage && failedImage !== profileImage && <button ref={photoTrigger} className="qso-photo-trigger" type="button" aria-label={`View full-size QRZ photo for ${matrixCall}`} aria-haspopup="dialog" onClick={() => setViewedImage({ image: profileImage, call: matrixCall })}><img className="qso-profile-photo" src={profileImage} alt={`${matrixCall} QRZ profile photo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(profileImage)} /></button>}
          <div className="qso-profile-identity"><div className="qso-intelligence"><strong>{profile?.name || matrixCall || "Enter a callsign"}</strong>{profile?.isNewCall === true && <b>NEW CALL</b>}</div><p>{profile ? profile.country || "Country unresolved" : "Enter a callsign to see lookup details."}</p>{profile?.nickname && <p>{profile.nickname}</p>}<span className="qso-profile-source">{profile?.source || (matrixCall ? "Lookup pending" : "Enter a callsign")}</span></div>
        </div>
        {profile?.location_source && <p className="secondary">Position: {profile.location_source}</p>}
        {profile?.lookup_warning && <p className="qso-profile-mismatch" role="status">{profile.lookup_warning}</p>}
        {profile && <dl className="qso-profile-facts">{[["Grid", profile.gridSquare], ["DXCC", profile.dxcc], ["Continent", profile.continent], ["CQ zone", profile.cqZone], ["ITU zone", profile.ituZone], ["Location", profile.qth], ["State", profile.state], ["County", profile.county], ["Email", profile.email], ["QSL manager", profile.qslManager], ["IOTA", profile.iota], ["License class", profile.licenseClass]].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "").map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>}
        {profile && typeof profile.bearing === "number" && Number.isFinite(profile.bearing) && <p>{Math.round(profile.bearing)}°{typeof profile.distance_km === "number" && Number.isFinite(profile.distance_km) ? ` · ${Math.round(profile.distance_km).toLocaleString()} km` : ""}</p>}
        {profileWebsite && <p><a className="qso-profile-link" href={profileWebsite} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Station website</a></p>}
        {profile && (draft.country && profile.country && draft.country.trim().toUpperCase() !== String(profile.country).trim().toUpperCase() || draft.dxcc != null && profile.dxcc != null && Number(draft.dxcc) !== Number(profile.dxcc)) && <p className="qso-profile-mismatch" role="status">Draft country/DXCC differs from this lookup. Your entered fields are unchanged; review them before logging.</p>}
        <button type="button" onClick={fillLookup} disabled={!sameLookup || busy}>Fill empty fields from lookup</button>
      </aside>;
  const previousPanel = <section className="qso-context-panel" aria-labelledby="qso-previous-title"><h2 id="qso-previous-title"><History size={15} aria-hidden="true" /> Previous QSOs</h2>{matchingPrevious.length ? <div className="qso-previous">{matchingPrevious.map((item, index) => {
        const confirmed = [item.qslReceived, item.lotwReceived].some(value => ["Y", "V"].includes(String(value).toUpperCase()));
        const timestamp = item.start ? new Date(item.start).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) : "—";
        return <div key={item.id ?? index}><time dateTime={item.start || undefined} title={`${timestamp} UTC`}>{timestamp}</time><b title={item.band}>{item.band}</b><span title={item.mode}>{item.mode}</span><span className={confirmed ? "qso-history-confirmed" : "qso-history-worked"}>{confirmed ? "Confirmed" : "Worked"}</span></div>;
      })}</div> : <div className="qso-empty"><History size={19} aria-hidden="true" /><strong>No local history</strong><p>No matching QSO is in the loaded local history.</p></div>}</section>;
  return <section className={`qso-editor${inspector ? "" : " qso-editor-without-inspector"}`} ref={rootRef} onKeyDown={keyDown} aria-label="Log QSO">
    <div className="qso-editor-main"><form inert={draftLocked} aria-busy={draftLocked} onSubmit={submit} noValidate>
      {inspector && Canvas ? <Canvas disabled={busy || !!draftLocked} panels={[
        { id: "active-contact", title: "Active contact", content: activePanel },
        { id: "qso-details", title: "QSO details", content: detailsPanel },
        { id: "callsign-intelligence", title: "Callsign intelligence", content: intelligencePanel },
        { id: "previous-qsos", title: "Previous QSOs", content: previousPanel },
        { id: "band-mode-matrix", title: "Band / mode matrix", content: matrixPanel },
      ]} /> : <div className="qso-editor-flow">{activePanel}{detailsPanel}{inspector && intelligencePanel}{inspector && previousPanel}{matrixPanel}</div>}
      {showErrors && <div className="qso-validation" role="alert">{errors.length ? <ul>{errors.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <span>QSO is ready to save.</span>}</div>}
      <footer className="qso-actions"><div className="qso-footer-context">{followControls && <label><input type="checkbox" checked={follow} onChange={(event) => { if (acceptsInput()) setFollow(event.target.checked); }} />Follow radio</label>}<span>Saved to your local logbook.</span></div><div className="qso-footer-buttons">{contactActions}<button type="button" onClick={() => { if (acceptsInput()) clear(); }} disabled={busy}><CircleX size={13} aria-hidden="true" /> {clearLabel}</button><button className="qso-save" type="submit" disabled={!canSave}><CircleCheck size={13} aria-hidden="true" /> {isEditing ? "Update QSO" : "Log QSO"}</button></div></footer>
    </form></div>
    {viewedImage && viewedImage.image === profileImage && viewedImage.call === matrixCall && failedImage !== profileImage && <QRZPhotoViewer image={viewedImage.image} callsign={viewedImage.call} trigger={photoTrigger} onClose={() => setViewedImage(null)} onError={() => { setFailedImage(viewedImage.image); setViewedImage(null); }} />}
  </section>;
}

export default QSOEditor;
