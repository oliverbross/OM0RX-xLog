import { useEffect, useState, type FormEvent } from "react";
import { closeContestSetupDialog, saveContestRoverDialog, setupDialogRequest, type SetupDialogSnapshot } from "./contestSetupDialogs";
import "./ContestWorkspace.css";
import "./DetachedContestAuxiliaryDialog.css";

const donors = ["Pedro CT2HZA", "John AC2E", "Andre DL4QB", "Adrian VA3NB", "Brian KB3ORR", "Connor KD9LSV",
  "Jeff KE9BPZ", "Tarmo ES1TAR", "Anders SM0HPL 5X7W", "Justin Giorgi AI6YM"];

export function DetachedContestAuxiliaryDialog() {
  const kind = new URLSearchParams(window.location.search).get("view") === "contest-setup-rover" ? "rover" : "about";
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null), [location, setLocation] = useState("");
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setLocation(value.auxiliary.roverLocation); setError(""); }
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : "Contest Setup is unavailable."); retry = setTimeout(() => void load(), 250); }
      }
    };
    void load(); return () => { active = false; clearTimeout(retry); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!snapshot || saving) return;
    setSaving(true); setError("");
    try { await saveContestRoverDialog(snapshot, location); await closeContestSetupDialog(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Rover location could not be saved."); }
    finally { setSaving(false); }
  };
  if (kind === "rover") return <main className="contest-aux-dialog contest-rover-dialog" aria-label="Rover">
    <form onSubmit={submit}>
      <label><span>Rove Location:</span><input autoFocus aria-label="Location" aria-description="Current Rove Location."
        maxLength={10} value={location} onChange={event => setLocation(event.target.value.toUpperCase())}/></label>
      <div className="contest-aux-actions"><button type="button" onClick={() => void closeContestSetupDialog()}>Cancel</button>
        <button type="submit" className="contest-primary" disabled={!snapshot || saving || !location.trim()}>{saving ? "Saving…" : "OK"}</button></div>
    </form>{error && <p role="alert">{error}</p>}
  </main>;
  return <main className="contest-aux-dialog contest-about-dialog" aria-label="About Not1MM">
    <h1>Not1MM</h1>
    <section className="contest-about-scroll">
      <h2>xLog integration</h2>
      {snapshot ? <dl><div><dt>Engine</dt><dd>{snapshot.auxiliary.diagnostics.engine}</dd></div>
        <div><dt>Plugin</dt><dd>{snapshot.auxiliary.diagnostics.plugin}</dd></div>
        <div><dt>Version</dt><dd>{snapshot.auxiliary.diagnostics.version}</dd></div>
        <div><dt>Source</dt><dd>{snapshot.auxiliary.diagnostics.source}</dd></div>
        <div><dt>Reference</dt><dd>{snapshot.auxiliary.diagnostics.reference}</dd></div></dl> : <p role="status">Loading contest details…</p>}
      <h2>To donate visit:</h2><p>paypal.me/k6gte</p><p>or</p><p>patreon.com/K6GTE</p>
      <h2>Donors</h2>{donors.map(donor => <p key={donor}>{donor}</p>)}
    </section>
    {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={() => void closeContestSetupDialog()}>Close</button></footer>
  </main>;
}
