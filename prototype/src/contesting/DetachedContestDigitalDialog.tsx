import { useEffect, useState } from "react";
import { closeContestSetupDialog, saveContestDigitalDialog, setupDialogRequest,
  type ContestDigitalSave, type ContestDigitalSnapshot, type SetupDialogSnapshot } from "./contestSetupDialogs";
import { validWSJTXConfiguration } from "../live/WSJTXPanel";
import "./ContestWorkspace.css";
import "./DetachedContestDigitalDialog.css";

export function DetachedContestDigitalDialog() {
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null);
  const [draft, setDraft] = useState<ContestDigitalSnapshot["configuration"] | null>(null);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setDraft(current => current ?? value.auxiliary.digital?.configuration ?? null); setError(""); }
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : "Contest Setup is unavailable."); retry = setTimeout(() => void load(), 250); }
      }
    };
    void load(); return () => { active = false; clearTimeout(retry); };
  }, []);
  const submit = async (action: ContestDigitalSave["action"]) => {
    if (!snapshot || !draft || saving) return;
    const configuration = action === "stop" ? snapshot.auxiliary.digital?.configuration ?? draft : draft;
    if (!validWSJTXConfiguration(configuration)) return;
    setSaving(true); setError("");
    try { await saveContestDigitalDialog(snapshot, { configuration, action }); await closeContestSetupDialog(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Digital logging settings could not be saved."); }
    finally { setSaving(false); }
  };
  const digital = snapshot?.auxiliary.digital;
  return <main className="contest-digital-dialog" aria-label="Digital logging setup">
    <header><div><h1>Digital logging</h1><p>Configure the existing xLog receive path used while a Not1MM contest is open.</p></div>
      <span className={digital?.running ? "is-listening" : "is-inactive"}>{digital?.running ? "Listening" : digital ? "Stopped" : "Unavailable"}</span></header>
    <section aria-labelledby="wsjtx-heading">
      <div className="digital-section-heading"><div><h2 id="wsjtx-heading">WSJT-X / JTDX</h2><p>Logged contacts arrive over UDP after you accept the external app’s Log QSO dialog.</p></div><strong>Receive only</strong></div>
      {draft ? <div className="digital-fields"><label><span>Multicast or loopback address</span><input autoFocus aria-label="WSJT-X UDP address" value={draft.address}
        onChange={event => setDraft({...draft,address:event.target.value.trim()})}/></label><label><span>UDP port</span><input aria-label="WSJT-X UDP port" type="number" min="1" max="65535" value={draft.port}
        onChange={event => setDraft({...draft,port:Number(event.target.value)})}/></label></div>
        : <p role="status">The xLog WSJT-X host is not available. Reopen Contest Setup after the station service is ready.</p>}
      <p className="digital-reference">Original Not1MM defaults: <code>224.0.0.1:2237</code>. xLog also permits <code>127.0.0.1</code> for one-computer operation.</p>
      <p className="digital-safety">This listener does not send decodes, replies, CAT commands, or PTT. Configure WSJT-X/JTDX radio control independently.</p>
    </section>
    <section aria-labelledby="fldigi-heading" className="is-unavailable"><div className="digital-section-heading"><div><h2 id="fldigi-heading">fldigi</h2><p>Original Not1MM receives logged QSOs at <code>127.0.0.1:9876</code> and sends F1–F12 through XML-RPC.</p></div><strong>Not integrated</strong></div>
      <dl><div><dt>XML-RPC</dt><dd>Enable in fldigi</dd></div><div><dt>Contest</dt><dd>Generic Contest</dd></div><div><dt>Text Capture Order</dt><dd><code>CALL EXCHANGE</code></dd></div></dl>
      <p>xLog does not currently have a contest fldigi UDP/XML-RPC adapter, so this window cannot claim a connection, receive fldigi QSOs, send macros, key transmit, or return fldigi to RX.</p>
    </section>
    {error && <p role="alert" className="digital-error">{error}</p>}
    <footer><button type="button" disabled={saving} onClick={() => void closeContestSetupDialog()}>Cancel</button>
      <button type="button" disabled={saving || !digital || !(digital.running || digital.configuration.enabled)} onClick={() => void submit("stop")}>Stop listening</button>
      <button type="button" disabled={saving || !draft || !validWSJTXConfiguration(draft)} onClick={() => void submit("save")}>Save settings</button>
      <button type="button" className="contest-primary" disabled={saving || !draft || !validWSJTXConfiguration(draft)} onClick={() => void submit("start")}>{saving ? "Applying…" : "Save and listen"}</button></footer>
  </main>;
}
