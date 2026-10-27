import { useEffect, useState } from "react";
import { closeContestSetupDialog, saveContestDigitalDialog, setupDialogRequest,
  type ContestDigitalSave, type ContestDigitalSnapshot, type SetupDialogSnapshot } from "./contestSetupDialogs";
import { validWSJTXConfiguration } from "../live/WSJTXPanel";
import "./ContestWorkspace.css";
import "./DetachedContestDigitalDialog.css";

export function DetachedContestDigitalDialog() {
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null);
  const [draft, setDraft] = useState<ContestDigitalSnapshot["configuration"] | null>(null);
  const [fldigiDraft, setFldigiDraft] = useState({ receive_enabled: false, transmit_enabled: false });
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setDraft(current => current ?? value.auxiliary.digital?.configuration ?? null);
          setFldigiDraft(current => current.receive_enabled || current.transmit_enabled ? current : value.auxiliary.digital?.fldigi?.configuration ?? current); setError(""); }
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
    try { await saveContestDigitalDialog(snapshot, { configuration, fldigi_configuration: fldigiDraft, action }); await closeContestSetupDialog(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Digital logging settings could not be saved."); }
    finally { setSaving(false); }
  };
  const digital = snapshot?.auxiliary.digital;
  return <main className="contest-digital-dialog" aria-label="Digital logging setup">
    <header><div><h1>Digital logging</h1><p>Configure xLog’s native receive-only WSJT-X service and choose the destination for accepted contacts.</p></div>
      <span className={digital?.running ? "is-listening" : "is-inactive"}>{digital?.running ? "Listening" : digital ? "Stopped" : "Unavailable"}</span></header>
    <section aria-labelledby="wsjtx-heading">
      <div className="digital-section-heading"><div><h2 id="wsjtx-heading">WSJT-X / JTDX</h2><p>Logged contacts arrive over UDP after you accept the external app’s Log QSO dialog and are saved to the selected destination.</p></div><strong>{draft?.destination === "active_contest" ? "Active contest" : "Ordinary log"} · receive only</strong></div>
      {draft ? <div className="digital-fields"><label><span>Multicast or loopback address</span><input autoFocus aria-label="WSJT-X UDP address" value={draft.address}
        onChange={event => setDraft({...draft,address:event.target.value.trim()})}/></label><label><span>UDP port</span><input aria-label="WSJT-X UDP port" type="number" min="1" max="65535" value={draft.port}
        onChange={event => setDraft({...draft,port:Number(event.target.value)})}/></label>
        <label><span>Logged-contact destination</span><select aria-label="WSJT-X logging destination" value={draft.destination}
          onChange={event => setDraft({...draft,destination:event.target.value as "ordinary_logbook" | "active_contest"})}>
          <option value="ordinary_logbook">Ordinary log</option>
          <option value="active_contest" disabled={!digital?.contest_target_supported}>Active contest</option>
        </select></label></div>
        : <p role="status">The xLog WSJT-X host is not available. Reopen Contest Setup after the station service is ready.</p>}
      <p className="digital-reference">Original Not1MM defaults: <code>224.0.0.1:2237</code>. xLog also permits <code>127.0.0.1</code> for one-computer operation.</p>
      <p className="digital-safety">Review decodes in Productivity → Entry &amp; stack. Select binds the exact current instance and lane; completed ADIF is a separate event. Reply remains unavailable without a qualified output/release contract. This listener sends no CAT or PTT.</p>
      {digital?.contest_target_supported && digital.active_contest && <p className="digital-safety">Active contest routes through the original <code>{digital.active_contest.plugin_id}</code> digital handler. Changing or closing that contest stops this listener; late packets are rejected.</p>}
    </section>
    <section aria-labelledby="fldigi-heading"><div className="digital-section-heading"><div><h2 id="fldigi-heading">fldigi</h2><p>Receive logged ADIF on loopback UDP and send admitted F1–F12 text through loopback XML-RPC.</p></div><strong>{digital?.fldigi?.receive_running ? "Receiving" : fldigiDraft.transmit_enabled ? "Transmit enabled" : "Stopped"}</strong></div>
      <div className="digital-fields"><label><span>Logged-QSO receive</span><input aria-label="Enable fldigi logged-QSO receive" type="checkbox"
        checked={fldigiDraft.receive_enabled} disabled={!digital?.fldigi?.receive_supported}
        onChange={event => setFldigiDraft({...fldigiDraft,receive_enabled:event.target.checked})}/></label>
        <label><span>F1–F12 macro transmit</span><input aria-label="Enable fldigi macro transmit" type="checkbox"
          checked={fldigiDraft.transmit_enabled} disabled={!digital?.fldigi?.transmit_supported}
          onChange={event => setFldigiDraft({...fldigiDraft,transmit_enabled:event.target.checked})}/></label></div>
      <dl><div><dt>Logged ADIF UDP</dt><dd><code>{digital?.fldigi?.udp_endpoint ?? "127.0.0.1:9876"}</code></dd></div><div><dt>XML-RPC</dt><dd><code>{digital?.fldigi?.xmlrpc_endpoint ?? "http://127.0.0.1:7362/RPC2"}</code></dd></div><div><dt>Text order</dt><dd><code>main.tx</code>, then <code>text.add_tx</code></dd></div></dl>
      <p className="digital-safety">Review non-destructive received text and completed ADIF in Productivity → Entry &amp; stack. UDP does not identify the fldigi instance: verify the external app and explicitly accept its completed event. Transmit is separate: <code>^M</code> becomes a newline and <code>^r</code> returns fldigi to receive.</p>
    </section>
    {error && <p role="alert" className="digital-error">{error}</p>}
    <footer><button type="button" disabled={saving} onClick={() => void closeContestSetupDialog()}>Cancel</button>
      <button type="button" disabled={saving || !digital || !(digital.running || digital.configuration.enabled)} onClick={() => void submit("stop")}>Stop listening</button>
      <button type="button" disabled={saving || !draft || !validWSJTXConfiguration(draft)} onClick={() => void submit("save")}>Save settings</button>
      <button type="button" className="contest-primary" disabled={saving || !draft || !validWSJTXConfiguration(draft)} onClick={() => void submit("start")}>{saving ? "Applying…" : "Save and listen"}</button></footer>
  </main>;
}
