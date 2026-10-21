import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Database, FileUp, ShieldCheck } from "lucide-react";
import { contestLogTransferAPI, type ContestLogTransferAPI, type LegacyContestPreview, type LegacyPreview, type TransferContext, type TransferResult } from "./contestLogTransferNative";
import "./ContestWorkspace.css";
import "./ContestLogTransferWindow.css";

type Mode = "legacy" | "transfer";
const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "The operation failed.";
const count = (value: number, noun: string) => `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

export function ContestLogTransferWindow({ api = contestLogTransferAPI }: { api?: ContestLogTransferAPI }) {
  const [mode, setMode] = useState<Mode>("legacy");
  const [context, setContext] = useState<TransferContext | null>(null);
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [contestNR, setContestNR] = useState<number | null>(null);
  const [pluginID, setPluginID] = useState("");
  const [transfer, setTransfer] = useState<TransferResult | null>(null);
  const [confirming, setConfirming] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const contest = useMemo(() => preview?.contests.find(item => item.contestNR === contestNR) ?? preview?.contest ?? null, [preview, contestNR]);
  const importCall = String(preview?.station?.Call ?? context?.stationCall ?? "").trim().toUpperCase();
  const importReady = Boolean(preview && contest && pluginID && context?.workspaceGeneration &&
    /^[A-Z0-9/\-]{3,32}$/.test(importCall) && Number.isSafeInteger(contest?.frequencyHz) && Number(contest?.frequencyHz) > 0);

  useEffect(() => { void api.context().then(setContext).catch(cause => setError(message(cause))); }, [api]);
  useEffect(() => { setPluginID(contest?.pluginCandidates[0] ?? ""); setConfirming(null); }, [contest?.contestNR]);

  const chooseLegacy = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await api.chooseLegacy();
      if (!value) return;
      setPreview(value);
      const selected = value.contest ?? value.contests[0] ?? null;
      setContestNR(selected?.contestNR ?? null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const importLegacy = async () => {
    if (!preview || !contest || !pluginID || !context?.workspaceGeneration || !importReady) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.importLegacy({
        expectedRevision: 0,
        workspaceGeneration: context.workspaceGeneration,
        pluginID, name: contest.contestName || "Imported Not1MM contest", station: { ...(preview.station ?? {}), Call: importCall },
        operator: importCall, frequencyHz: contest.frequencyHz, settings: contest.settings,
        sourceIdentity: preview.source.identity, sourceDigest: preview.source.digest, sourceContestNR: contest.contestNR,
      });
      const imported = Number((result.legacyImport as Record<string, unknown> | undefined)?.importedRows ?? contest.rowCount);
      setNotice(`${count(imported, "contact")} imported into a new xLog contest session.`);
      setConfirming(null);
      setTransfer(null);
      setContext(null);
      setContext(await api.context());
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const prepareTransfer = async () => {
    if (!context?.sessionID || context.expectedRevision === undefined) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.transfer("contest_log_transfer_prepare", {
        sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration, expectedRevision: context.expectedRevision,
      });
      setTransfer(result); setConfirming("transfer");
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const commitTransfer = async () => {
    if (!context?.sessionID || context.expectedRevision === undefined || !transfer) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.transfer("contest_log_transfer_commit", {
        sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration,
        expectedRevision: context.expectedRevision, manifestID: transfer.manifest.manifestID,
      });
      setTransfer(result); setConfirming(null);
      setNotice(`${count(result.counts.inserted, "contact")} added; ${count(result.counts.alreadyTransferred, "contact")} already transferred.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const showTransfer = async () => {
    setMode("transfer"); setConfirming(null); setTransfer(null); setError("");
    try { setContext(await api.context()); }
    catch (cause) { setError(message(cause)); }
  };

  return <main className="contest-workspace contest-transfer" aria-label="Import or Transfer Log">
    <header className="contest-header">
      <div><h1>Import or Transfer Log</h1><p>Move contest contacts through xLog's verified local owners.</p></div>
      <ShieldCheck aria-hidden="true" size={20}/>
    </header>
    <div className="contest-transfer-tabs" role="tablist" aria-label="Log operation">
      <button role="tab" aria-selected={mode === "legacy"} onClick={() => { setMode("legacy"); setConfirming(null); }}><FileUp size={15}/> Legacy Not1MM</button>
      <button role="tab" aria-selected={mode === "transfer"} onClick={() => { void showTransfer(); }}><ArrowRightLeft size={15}/> Active contest to Logbook</button>
    </div>
    {error && <p className="contest-alert is-error" role="alert">{error}</p>}
    {notice && <p className="contest-alert" role="status">{notice}</p>}

    {mode === "legacy" ? <section className="contest-transfer-pane" aria-labelledby="legacy-title">
      <header><div><h2 id="legacy-title">Import a legacy contest</h2><p>The native picker reads one Not1MM SQLite database. Its path stays outside this web view.</p></div>
        <button onClick={chooseLegacy} disabled={busy}>{preview ? "Choose another file…" : "Choose Not1MM database…"}</button></header>
      {!preview ? <div className="contest-transfer-empty"><Database size={25}/><p>Choose a database to preview its contests. Nothing is written during preview.</p></div> : <>
        <div className="contest-transfer-source"><strong>Verified source</strong><span>{preview.source.identity}</span><span>{(preview.source.byteLength / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB · {preview.source.digest.slice(0, 12)}…</span></div>
        <div className="contest-transfer-fields">
          <label><span>Contest</span><select value={contestNR ?? ""} onChange={event => setContestNR(Number(event.target.value))}>{preview.contests.map(item => <option key={item.contestNR} value={item.contestNR}>{item.contestName} · {count(item.rowCount, "contact")}</option>)}</select></label>
          <label><span>xLog contest plugin</span><select value={pluginID} onChange={event => setPluginID(event.target.value)} disabled={!contest?.pluginCandidates.length}>{contest?.pluginCandidates.map(candidate => <option key={candidate}>{candidate}</option>)}</select></label>
        </div>
        {contest && <dl className="contest-transfer-facts"><div><dt>Contacts</dt><dd>{contest.rowCount.toLocaleString()}</dd></div><div><dt>First UTC</dt><dd>{contest.firstUTC || "Not recorded"}</dd></div><div><dt>Last UTC</dt><dd>{contest.lastUTC || "Not recorded"}</dd></div><div><dt>Exchange</dt><dd>{contest.exchangeValues.join(", ") || "Not recorded"}</dd></div></dl>}
        {confirming === "legacy" ? <div className="contest-transfer-confirm" role="group" aria-label="Confirm legacy import"><p><strong>Create a new contest session and import {contest?.rowCount.toLocaleString()} contacts?</strong> The legacy database remains unchanged.</p><div><button onClick={() => setConfirming(null)} disabled={busy}>Cancel</button><button className="contest-primary" onClick={importLegacy} disabled={busy || !pluginID}>{busy ? "Importing…" : `Import ${contest?.rowCount.toLocaleString()} contacts`}</button></div></div>
          : <footer><span>{importReady ? "This creates a separate xLog-owned contest session; it does not merge with the active session." : "A valid xLog workspace, station callsign, and source contact frequency are required."}</span><button className="contest-primary" onClick={() => setConfirming("legacy")} disabled={busy || !importReady}>Review import…</button></footer>}
      </>}
    </section> : <section className="contest-transfer-pane" aria-labelledby="transfer-title">
      <header><div><h2 id="transfer-title">Transfer the active contest</h2><p>Copies the immutable contest snapshot into the normal xLog logbook. Existing transfer receipts prevent duplicates.</p></div></header>
      {context?.sessionID ? <div className="contest-transfer-active"><div><span>Active session</span><strong>{context.contestName}</strong><small>{context.sessionID}</small></div><div><span>Revision</span><strong>{context.expectedRevision}</strong></div><div><span>Contacts</span><strong>{context.qsoCount?.toLocaleString() ?? 0}</strong></div></div>
        : <div className="contest-transfer-empty"><p>Open a contest session in Contest Setup before preparing a transfer.</p></div>}
      {transfer && <><dl className="contest-transfer-facts"><div><dt>Total</dt><dd>{transfer.counts.total}</dd></div><div><dt>{transfer.phase === "committed" ? "Transferred now" : "New"}</dt><dd>{transfer.phase === "committed" ? transfer.counts.inserted : transfer.counts.pending}</dd></div><div><dt>Already transferred</dt><dd>{transfer.counts.alreadyTransferred}</dd></div><div><dt>Conflicts / errors</dt><dd>{transfer.counts.conflicts} / {transfer.counts.errors}</dd></div></dl>
        {(transfer.conflicts.length > 0 || transfer.errors.length > 0) && <ul className="contest-transfer-issues">{[...transfer.conflicts, ...transfer.errors].map(issue => <li key={`${issue.qsoID}-${issue.code}`}><strong>{issue.code}</strong><span>{issue.message}</span></li>)}</ul>}</>}
      {confirming === "transfer" && transfer ? <div className="contest-transfer-confirm" role="group" aria-label="Confirm logbook transfer"><p><strong>Add {transfer.counts.pending.toLocaleString()} contacts to the normal logbook?</strong> {transfer.counts.alreadyTransferred.toLocaleString()} are already recorded and will not be duplicated. Conflicting rows remain unchanged for review.</p><div><button onClick={() => setConfirming(null)} disabled={busy}>Cancel</button><button className="contest-primary" onClick={commitTransfer} disabled={busy || transfer.counts.pending === 0}>{busy ? "Transferring…" : "Transfer to Logbook"}</button></div></div>
        : <footer><span>This is not an ADIF merge; xLog matches exact contest-session provenance and retained source digests.</span><button className="contest-primary" onClick={prepareTransfer} disabled={busy || !context?.sessionID}>{busy ? "Preparing…" : "Preview transfer"}</button></footer>}
    </section>}
  </main>;
}

export default ContestLogTransferWindow;

