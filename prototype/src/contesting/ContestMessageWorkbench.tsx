import { useEffect, useRef, useState } from "react";
import type { ContestSetupMacro } from "./ContestSetupPanel";
import "./ContestMessageWorkbench.css";

export type MessageBankScope = { mode: string; contest: string; operator: string };
export type MessageBank = { id?: string; name: string; scope: MessageBankScope; dialect: "not1mm" | "n1mm";
  original: string; originalSHA256?: string; macros: ContestSetupMacro[] };
type ImportReport = { line: number; status: "supported" | "translated" | "warning" | "rejected"; message: string };
type ImportResult = { bank: MessageBank; report: ImportReport[]; canSave: boolean };
type BankResult = { banks: MessageBank[]; activeBankID: string | null };
type PreviewResult = { text: string; noOutput: boolean; warnings: string[]; rejections: string[];
  actions: { kind: string; token: string; executed: false }[]; binding: { draftID?: string; serial: number | null };
  nextESM: { keys: string[]; basis: string; warning: string; draftID?: string } };
export type ContestMessageWorkbenchProps = {
  scope: MessageBankScope; effectiveMacros: ContestSetupMacro[];
  draft?: { id: string; fields: Record<string, string> }; serial?: number | null; disabled?: boolean;
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  onMutate: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  onExport: (content: string, filename: string) => void | Promise<void>;
};

function completeRows(rows: ContestSetupMacro[]): ContestSetupMacro[] {
  return (["R", "S"] as const).flatMap(mode => Array.from({ length: 12 }, (_, index) => {
    const key = `F${index + 1}`;
    return { mode, key, label: "", template: "", ...rows.find(row => row.mode === mode && row.key === key) };
  }));
}
export function exportNot1MMBank(bank: MessageBank): string {
  return completeRows(bank.macros).map(row => `${row.mode}|${row.key}|${row.label}|${row.template}`).join("\n") + "\n";
}

/** Editing/import/preview are drafts. Activation is a separate durable action. */
export function ContestMessageWorkbench({ scope, effectiveMacros, draft, serial, request, onMutate, onExport, disabled = false }: ContestMessageWorkbenchProps) {
  const [bank, setBank] = useState<MessageBank>(() => ({ name: "My messages", scope, dialect: "not1mm", original: "", macros: completeRows(effectiveMacros) }));
  const [banks, setBanks] = useState<BankResult>({ banks: [], activeBankID: null });
  const [selectedID, setSelectedID] = useState(""), [dialect, setDialect] = useState<"not1mm" | "n1mm">("not1mm");
  const [source, setSource] = useState(""), [report, setReport] = useState<ImportReport[]>([]), [canSave, setCanSave] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null), [previewKey, setPreviewKey] = useState("R:F1");
  const [testCall, setTestCall] = useState(draft?.fields.callsign ?? "K1ABC"), [testSerial, setTestSerial] = useState(String(serial ?? ""));
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const generation = useRef(0), previewSequence = useRef(0);
  const scopeKey = JSON.stringify(scope), draftKey = JSON.stringify(draft);
  useEffect(() => {
    const current = ++generation.current;
    previewSequence.current++;
    setBank({ name: "My messages", scope, dialect: "not1mm", original: "", macros: completeRows(effectiveMacros) });
    setSource(""); setReport([]); setCanSave(true); setPreview(null); setSelectedID(""); setMessage(""); setPending(false);
    void request("contest_message_banks", {}).then(value => { if (current === generation.current) setBanks(value as BankResult); })
      .catch(error => { if (current === generation.current) setMessage(error instanceof Error ? error.message : "Message banks could not be read."); });
    return () => { generation.current++; };
    // Session owner remounts at a session boundary; scope changes discard stale replies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, request]);
  useEffect(() => { setTestCall(draft?.fields.callsign ?? "K1ABC"); setTestSerial(String(serial ?? "")); setPreview(null); previewSequence.current++; }, [draftKey, serial]);
  const busy = disabled || pending;
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    const current = generation.current;
    setPending(true); setMessage("");
    try { await operation(); } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : "Message operation failed."); }
    finally { if (current === generation.current) setPending(false); }
  };
  const refresh = async () => { const current = generation.current, value = await request("contest_message_banks", {}); if (current === generation.current) setBanks(value as BankResult); };
  const edit = (index: number, property: "label" | "template", value: string) => {
    setBank(current => ({ ...current, macros: current.macros.map((row, i) => i === index ? { ...row, [property]: value } : row) }));
    setPreview(null); previewSequence.current++;
  };
  const importDraft = () => run(async () => {
    const current = generation.current;
    const result = await request("contest_message_import", { dialect, source, name: bank.name, scope }) as ImportResult;
    if (current !== generation.current) return;
    setBank(result.bank); setReport(result.report); setCanSave(result.canSave); setPreview(null); previewSequence.current++;
    setMessage("Import staged for review. Save named bank and Activate are separate steps.");
  });
  const previewDraft = () => run(async () => {
    const current = generation.current, sequence = ++previewSequence.current;
    const [mode, key] = previewKey.split(":"), row = bank.macros.find(item => item.mode === mode && item.key === key);
    const value = await request("contest_message_preview", { template: row?.template ?? "", mode: scope.mode,
      draft: { id: draft?.id ?? "synthetic", fields: { ...draft?.fields, callsign: testCall } },
      ...(testSerial.trim() ? { serial: Number(testSerial) } : {}) }) as PreviewResult;
    if (current === generation.current && sequence === previewSequence.current) setPreview(value);
  });
  const selected = banks.banks.find(item => item.id === selectedID);
  return <section className="contest-message-workbench" aria-label="Message workbench" aria-busy={busy}>
    <header><h2>Message workbench</h2><p>{scope.mode} · {scope.contest} · {scope.operator}. Preview never sends, logs, tunes or plays audio.</p></header>
    <fieldset disabled={busy}><legend>Named banks</legend>
      <label>Bank name <input value={bank.name} maxLength={128} onChange={event => setBank({ ...bank, name: event.target.value })}/></label>
      <label>Saved bank <select value={selectedID} onChange={event => setSelectedID(event.target.value)}><option value="">Choose saved bank</option>
        {banks.banks.filter(item => item.scope.contest === scope.contest && item.scope.operator === scope.operator && item.scope.mode === scope.mode).map(item =>
          <option key={item.id} value={item.id}>{item.name}{item.id === banks.activeBankID ? " (last activated)" : ""}</option>)}</select></label>
      <div className="contest-message-actions"><button type="button" disabled={!selected} onClick={() => { if (selected) { setBank(structuredClone(selected)); setSource(selected.original); setReport([]); setCanSave(true); setPreview(null); previewSequence.current++; } }}>Load saved draft</button>
        <button type="button" disabled={!bank.name.trim() || !canSave} onClick={() => void run(async () => { await onMutate("contest_message_bank_save", { bank }); await refresh(); setMessage("Named bank saved. Active messages are unchanged until Activate."); })}>Save named bank</button>
        <button type="button" disabled={!selected} onClick={() => void run(async () => { await onMutate("contest_message_bank_activate", { bankID: selectedID }); await refresh(); setMessage("Saved bank activated through contest setup."); })}>Activate selected saved bank</button>
        <button type="button" onClick={() => void run(async () => { await onExport(exportNot1MMBank(bank), "messages-not1mm.txt"); setMessage("Not1MM export prepared. Export does not save or activate a bank."); })}>Export Not1MM file</button>
      </div>
    </fieldset>
    <fieldset disabled={busy}><legend>Import a draft</legend>
      <label>File dialect <select value={dialect} onChange={event => setDialect(event.target.value as "not1mm" | "n1mm")}><option value="not1mm">Not1MM R|F1|label|template</option><option value="n1mm">N1MM .mc (explicit Run / S&amp;P sections)</option></select></label>
      <label>Message file <input type="file" accept=".mc,.txt" onChange={event => { const file = event.target.files?.[0], current = generation.current; if (!file) return; if (file.size > 65536) { setMessage("Message file exceeds 64 KiB."); return; } void file.text().then(value => { if (current === generation.current) setSource(value); }).catch(() => { if (current === generation.current) setMessage("Message file could not be read."); }); }}/></label>
      <label>Original source <textarea rows={5} maxLength={65536} value={source} onChange={event => setSource(event.target.value)}/></label>
      <button type="button" disabled={!source.trim()} onClick={() => void importDraft()}>Stage import and report</button>
      {report.length > 0 && <ul aria-label="Import report">{report.map((item, index) => <li key={index}><strong>{item.status}</strong>{item.line ? ` · line ${item.line}` : ""}: {item.message}</li>)}</ul>}
      {bank.original && <details><summary>Retained original import</summary><pre>{bank.original}</pre></details>}
    </fieldset>
    {(["R", "S"] as const).map(mode => <fieldset key={mode} disabled={busy}><legend>{mode === "R" ? "Run" : "S&P"} F1–F12</legend>
      <div className="contest-message-scroll"><table><thead><tr><th>Key</th><th>Label</th><th>Template</th></tr></thead><tbody>{bank.macros.map((row, index) => row.mode === mode && <tr key={row.key}><th scope="row">{row.key}</th>
        <td><input aria-label={`${mode} ${row.key} message label`} value={row.label} maxLength={128} onChange={event => edit(index, "label", event.target.value)}/></td>
        <td><input aria-label={`${mode} ${row.key} message template`} value={row.template} maxLength={1024} onChange={event => edit(index, "template", event.target.value)}/></td></tr>)}</tbody></table></div>
    </fieldset>)}
    <fieldset disabled={busy}><legend>No-output preview</legend>
      <label>Message <select value={previewKey} onChange={event => { setPreviewKey(event.target.value); setPreview(null); previewSequence.current++; }}>{bank.macros.map(row => <option key={`${row.mode}:${row.key}`} value={`${row.mode}:${row.key}`}>{row.mode === "R" ? "Run" : "S&P"} {row.key}</option>)}</select></label>
      <label>Synthetic / next call <input value={testCall} maxLength={1024} onChange={event => { setTestCall(event.target.value); setPreview(null); previewSequence.current++; }}/></label>
      <label>Simulated serial <input type="number" min={1} max={999999999} value={testSerial} onChange={event => { setTestSerial(event.target.value); setPreview(null); previewSequence.current++; }}/></label>
      <button type="button" onClick={() => void previewDraft()}>Preview without output</button>
      {preview && <div role="status"><pre aria-label="Rendered message preview">{preview.text || "(No rendered text)"}</pre>
        <p>Bound draft: {preview.binding.draftID ?? "synthetic"} · simulated serial: {preview.binding.serial ?? "unavailable"}</p>
        {preview.actions.map((action, index) => <p key={index}>{action.kind}: {action.token} · preview only</p>)}
        {[...preview.rejections, ...preview.warnings].map((item, index) => <p key={index}>{item}</p>)}
        <p>Next ESM: {preview.nextESM.keys.join(", ") || "No highlighted message"} · {preview.nextESM.basis}. {preview.nextESM.warning}</p>
      </div>}
    </fieldset>
    <p>Only declared N1MM text translations are supported. Radio VOICE memories and managed WAV slots differ; missing voice assets never block manual logging. ESM and custom key bindings are preserved.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
