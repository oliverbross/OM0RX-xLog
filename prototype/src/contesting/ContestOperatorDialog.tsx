import { useEffect, useRef, useState, type FormEvent } from "react";
import { closeContestSetupDialog, saveContestSetupDialog, setupDialogRequest, type SetupDialogSnapshot } from "./contestSetupDialogs";
import "./ContestWorkspace.css";
import "./ContestOperatorDialog.css";

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Contest Setup is unavailable.";

export function ContestOperatorDialog() {
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null);
  const [operator, setOperator] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setOperator(value.document.operator); setError(""); }
      } catch (cause) {
        if (active) { setError(errorMessage(cause)); retry = setTimeout(() => void load(), 250); }
      }
    };
    void load();
    return () => { active = false; clearTimeout(retry); };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = operator.trim();
    if (!snapshot || savingRef.current) return;
    if (!next) { setError("Operator is required."); return; }
    savingRef.current = true; setSaving(true); setError("");
    void saveContestSetupDialog(snapshot, { ...snapshot.document, operator: next })
      .then(() => closeContestSetupDialog())
      .catch(cause => setError(errorMessage(cause)))
      .finally(() => { savingRef.current = false; setSaving(false); });
  };

  return <main className="contest-workspace contest-operator-dialog" aria-label="Contest Operator">
    <header><h1>Contest Operator</h1><p>New contacts will be logged under this operator.</p></header>
    {snapshot ? <form onSubmit={submit}>
      <label><span>Operator callsign</span><input autoFocus required maxLength={20} value={operator}
        onChange={event => setOperator(event.target.value)} /></label>
      {error && <p className="contest-alert is-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={saving} onClick={() => void closeContestSetupDialog()}>Cancel</button>
        <button className="contest-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
    </form> : error ? <><p className="contest-alert is-error" role="alert">{error}</p>
      <button type="button" onClick={() => void closeContestSetupDialog()}>Cancel</button></> : <p role="status">Loading operator…</p>}
  </main>;
}
