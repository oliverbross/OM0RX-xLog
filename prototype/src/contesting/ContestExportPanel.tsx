import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Download, X } from "lucide-react";
import type { ContestExportSaveOwner } from "./contestExportSave";
import type { ContestCabrilloHeader, ContestExportFormat, ContestPreparedExport, ContestSessionSummary } from "./types";
import { isStructuredEntry } from "./types";

type Props = {
  session: ContestSessionSummary; opener: RefObject<HTMLButtonElement | null>; saveOwner: ContestExportSaveOwner;
  prepare: (format: ContestExportFormat, header: ContestCabrilloHeader) => Promise<ContestPreparedExport | null>;
  release: (prepared: ContestPreparedExport) => Promise<unknown>;
  onClose: () => void; onSaved: (filename: string) => void;
};
const bands = ["ALL", "160M", "80M", "40M", "20M", "15M", "10M"];
const singleOperator = (value: string) => ["single operator", "single-operator", "single-op"].includes(value.trim().toLowerCase());
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function ContestExportPanel({ session, opener, saveOwner, prepare, release, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const save = useSyncExternalStore(saveOwner.subscribe, saveOwner.snapshot, saveOwner.snapshot);
  const scopeMatches = save.phase !== "idle" && save.scope?.sessionID === session.sessionID &&
    save.scope.workspaceGeneration === session.workspaceGeneration;
  const ownedPrepared = scopeMatches && (save.phase === "saving" || save.phase === "failed" || save.phase === "unknown") ? save.prepared : undefined;
  const foreignSave = save.phase !== "idle" && !scopeMatches;
  const [prepared, setPrepared] = useState<ContestPreparedExport | null>(ownedPrepared ?? null);
  const preparedRef = useRef<ContestPreparedExport | null>(prepared), saveRef = useRef(save), releaseRef = useRef(release);
  const [preparing, setPreparing] = useState(false), [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false), [format, setFormat] = useState<ContestExportFormat>("cabrillo");
  const [assisted, setAssisted] = useState("NON-ASSISTED"), [band, setBand] = useState("ALL"), [power, setPower] = useState("LOW");
  const locationField = isStructuredEntry(session.rule.entry)
    ? session.rule.entry.stationFields?.find(field => field.role === "cabrilloLocation") : undefined;
  const frozenLocation = locationField ? session.station.stationFields?.[locationField.id] ?? "" : null;
  const [location, setLocation] = useState(frozenLocation ?? ""), [club, setClub] = useState(""), [name, setName] = useState("");
  const [address, setAddress] = useState(""), [email, setEmail] = useState("");
  const supported = singleOperator(session.operator.category);
  const practicePreview = session.rule.identity.id.startsWith("sac-") || session.rule.identity.id.startsWith("jidx-") || session.rule.identity.id.startsWith("arrl-dx-");
  preparedRef.current = prepared; saveRef.current = save; releaseRef.current = release;

  useEffect(() => {
    const element = dialog.current, trigger = opener.current;
    if (!element) return;
    if (typeof element.showModal === "function") element.showModal(); else element.setAttribute("open", "");
    closeButton.current?.focus();
    return () => { if (element.open && typeof element.close === "function") element.close(); if (trigger?.isConnected) trigger.focus(); };
  }, [opener]);
  useEffect(() => { if (ownedPrepared) setPrepared(ownedPrepared); }, [ownedPrepared]);
  useEffect(() => {
    if (!scopeMatches) return;
    if (save.phase === "saved") { onSaved(save.result.filename); saveOwner.acknowledgeKnown(); }
    if (save.phase === "cancelled") { setPrepared(null); setCancelled(true); saveOwner.acknowledgeKnown(); }
  }, [save, saveOwner, onSaved, scopeMatches]);
  useEffect(() => () => {
    const ready = preparedRef.current, ownerState = saveRef.current;
    if (ready && ownerState.phase === "idle") void releaseRef.current(ready).catch(() => {});
  }, []);

  const close = () => {
    if (prepared && save.phase === "idle") void release(prepared).catch(() => {});
    preparedRef.current = null;
    onClose();
  };
  const makeHeader = (): ContestCabrilloHeader => ({ callsign: session.station.callsign, categoryOperator: "SINGLE-OP",
    categoryAssisted: assisted, categoryBand: band, categoryMode: session.rule.mode, categoryTransmitter: "ONE", categoryPower: power,
    operators: [session.operator.callsign], location: (frozenLocation ?? location).trim(), ...(club.trim() ? { club: club.trim() } : {}),
    name: name.trim(), addressLines: address.trim() ? [address.trim()] : [], email: email.trim() });
  const runPrepare = async () => {
    if (!supported || preparing || !location.trim() || !name.trim()) return;
    setPreparing(true); setError(""); setCancelled(false);
    try { setPrepared(await prepare(format, makeHeader())); } catch (cause) { setError(errorText(cause)); }
    finally { setPreparing(false); }
  };
  const runSave = () => {
    if (!prepared) return;
    if (save.phase === "failed") void saveOwner.retry({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration });
    else void saveOwner.save(prepared, release);
  };
  const editExport = () => {
    if (save.phase === "saving" || save.phase === "unknown") return;
    if (save.phase === "failed") saveOwner.discardKnown();
    else if (prepared) void release(prepared).catch(() => {});
    preparedRef.current = null; setPrepared(null); setError(""); setCancelled(false);
  };

  return <dialog ref={dialog} className="contest-export-dialog" aria-label="Export contest log"
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } }}>
    <header><div><p>CONTEST EXPORT</p><h2>{practicePreview ? "Prepare a practice export" : "Prepare a submission file"}</h2></div><button ref={closeButton} type="button" onClick={close}><X size={14}/>Close</button></header>
    {practicePreview && <p className="contest-alert" role="status">{session.rule.identity.id.startsWith("jidx-") ? "JIDX export is a scoring and format preview. Sponsor acceptance of the maritime-mobile ENTITY token and multi-operator categories remains open." : session.rule.identity.id.startsWith("arrl-dx-") ? "ARRL DX export is a scoring and format preview. Full category and contest-date rules and sponsor submission acceptance remain open." : "SAC export is a scoring and format preview. It is not sponsor-submission ready because full category and contest-date rules are not yet enforced."}</p>}
    {!supported ? <p className="contest-alert is-error" role="alert">Export is unavailable for the stored category “{session.operator.category}”. This preview supports Single Operator only.</p> : <>
      {foreignSave && <section className="contest-alert is-uncertain" role="alert"><div><strong>Another contest export needs attention</strong><p>{save.phase === "saving" ? "Its save dialog is still open." : save.phase === "unknown" ? "Check its selected folder before starting another export." : "Dismiss its completed save state before starting another export."}</p></div>{save.phase !== "saving" && <button type="button" onClick={() => save.phase === "unknown" ? saveOwner.acknowledgeUnknown() : saveOwner.discardKnown()}>{save.phase === "unknown" ? "I checked the folder" : "Dismiss"}</button>}</section>}
      {!foreignSave && !prepared && save.phase !== "unknown" && <div className="contest-export-fields">
        <label>Format<select value={format} disabled={preparing} onChange={event => setFormat(event.target.value as ContestExportFormat)}><option value="cabrillo">Cabrillo</option><option value="adif">ADIF</option></select></label>
        <label>Assistance<select value={assisted} disabled={preparing} onChange={event => setAssisted(event.target.value)}><option>NON-ASSISTED</option><option>ASSISTED</option></select></label>
        <label>Band<select value={band} disabled={preparing} onChange={event => setBand(event.target.value)}>{bands.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Power<select value={power} disabled={preparing} onChange={event => setPower(event.target.value)}><option>HIGH</option><option>LOW</option><option>QRP</option></select></label>
        <label>{frozenLocation !== null ? "Cabrillo section" : "Location"}<input maxLength={64} required readOnly={frozenLocation !== null} disabled={preparing} value={frozenLocation ?? location} onChange={event => { if (frozenLocation === null) setLocation(event.target.value); }}/></label>
        <label>Name<input maxLength={75} required disabled={preparing} value={name} onChange={event => setName(event.target.value)}/></label>
        <label>Club<input maxLength={128} disabled={preparing} value={club} onChange={event => setClub(event.target.value)}/></label>
        <label>Email<input maxLength={254} disabled={preparing} value={email} onChange={event => setEmail(event.target.value)}/></label>
        <label className="contest-export-wide">Address line<input maxLength={160} disabled={preparing} value={address} onChange={event => setAddress(event.target.value)}/></label>
        <p className="contest-source contest-export-wide">SINGLE-OP · {session.rule.mode} · ONE transmitter · no overlay · {session.rule.sourceVerification} source preview</p>
      </div>}
      {!foreignSave && prepared && <section className="contest-export-summary" aria-label="Prepared export summary"><strong>{prepared.format === "cabrillo" ? practicePreview ? "Cabrillo practice export" : "Cabrillo submission preview" : "ADIF compatibility export"}</strong><dl><div><dt>Revision</dt><dd>{prepared.revision}</dd></div><div><dt>QSOs</dt><dd>{prepared.qsoCount}</dd></div><div><dt>Points</dt><dd>{prepared.totalPoints}</dd></div><div><dt>Multipliers</dt><dd>{prepared.multiplierCount}</dd></div><div><dt>Claimed score</dt><dd>{prepared.claimedScore.toLocaleString()}</dd></div><div><dt>Size</dt><dd>{prepared.byteLength.toLocaleString()} bytes</dd></div></dl><p className="contest-source">{session.rule.sourceVerification} source · {prepared.formatterVersion} preview</p></section>}
      {!foreignSave && save.phase === "unknown" && <section className="contest-alert is-uncertain" role="alert"><div><strong>Save outcome not confirmed</strong><p>Check the selected folder before saving again.</p></div><button type="button" onClick={() => { saveOwner.acknowledgeUnknown(); setPrepared(null); }}>I checked the folder</button></section>}
      {!foreignSave && save.phase === "failed" && <p className="contest-alert is-error" role="alert">{save.result.message}</p>}
      {cancelled && <p className="contest-alert" role="status">Save cancelled.</p>}{error && <p className="contest-alert is-error" role="alert">{error}</p>}
      {!foreignSave && <footer>{!prepared && save.phase !== "unknown" && <button className="contest-primary" type="button" disabled={preparing || !location.trim() || !name.trim()} onClick={() => void runPrepare()}>{preparing ? "Preparing…" : "Prepare export"}</button>}
        {prepared && save.phase !== "unknown" && <><button type="button" disabled={save.phase === "saving"} onClick={editExport}>{save.phase === "failed" ? "Prepare again" : "Edit export"}</button><button className="contest-primary" type="button" disabled={save.phase === "saving"} onClick={runSave}><Download size={14}/>{save.phase === "saving" ? "Saving…" : save.phase === "failed" ? "Retry Save…" : "Save…"}</button></>}</footer>}
    </>}
  </dialog>;
}
