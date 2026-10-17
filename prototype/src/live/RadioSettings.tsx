import { useEffect, useState } from "react";
import { Radio, ShieldCheck } from "lucide-react";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { stationSessionRequest, type RadioID, type StationSession } from "./stationSession";
import "./RadioSettings.css";

const radios = ["radio1", "radio2"] as const satisfies readonly RadioID[];
const label = (radioId: RadioID) => radioId === "radio1" ? "Radio 1" : "Radio 2";
const providerNames: Record<string, string> = {
  direct_agent: "Remote Station Agent",
  direct_flex_lan: "Direct FLEX LAN",
  direct_tci: "Direct TCI",
  hamlib: "Local Hamlib",
};

function RadioSlot({ radioId, visible, activeRadio, txOwner, onRouting }: { radioId: RadioID; visible: boolean; activeRadio: RadioID | null; txOwner: RadioID | null; onRouting: (active: RadioID, owner: RadioID | null) => void }) {
  const [session, setSession] = useState<StationSession | null>(null);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingMessage, setRoutingMessage] = useState("");
  const snapshot = session?.radio?.snapshot;
  const connected = snapshot?.radio?.connected === true && snapshot?.radio?.observed === true;
  const provider = session?.selection.provider;
  const capabilities = Array.isArray(snapshot?.capabilities?.supported_commands)
    ? snapshot.capabilities.supported_commands as string[] : [];
  return <div role="tabpanel" id={`radio-settings-panel-${radioId}`} aria-labelledby={`radio-settings-tab-${radioId}`} hidden={!visible}>
    <div className="radio-settings-summary" aria-label={`${label(radioId)} status`}>
      <div><Radio size={17} aria-hidden="true" /><span><strong>{label(radioId)}</strong><small>{provider ? providerNames[provider] ?? provider : "No provider selected"}</small></span></div>
      <span className={`live-station-status ${connected ? "is-online" : "is-offline"}`} role="status"><i aria-hidden="true" />{connected ? "Observed live" : "Not connected"}</span>
    </div>
    <div className="radio-settings-routing" aria-label={`${label(radioId)} routing`}>
      <div><strong>{activeRadio === radioId ? "Active radio" : "Standby radio"}</strong><span>{txOwner === radioId ? "Owns transmit authority" : txOwner ? `${label(txOwner)} owns transmit authority` : "No radio owns transmit authority"}</span></div>
      {activeRadio !== radioId && <button type="button" disabled={routingBusy || !session} onClick={() => {
        setRoutingBusy(true); setRoutingMessage("");
        void stationSessionRequest<{ active_radio: RadioID }>(radioId, { action: "set_active_radio" })
          .then(result => { if (result.active_radio !== radioId) throw new Error("The active radio response did not match the requested radio."); onRouting(result.active_radio, txOwner); setRoutingMessage(`${label(radioId)} is now active.`); }, cause => setRoutingMessage(cause instanceof Error ? cause.message : "The active radio could not be changed."))
          .finally(() => setRoutingBusy(false));
      }}>Use as active radio</button>}
      {routingMessage && <p role="status">{routingMessage}</p>}
    </div>
    <section className="radio-settings-section" aria-labelledby={`${radioId}-connection-heading`}>
      <div className="radio-settings-section-head"><div><h2 id={`${radioId}-connection-heading`}>Connection</h2><p>Select one provider, save its setup, then connect explicitly.</p></div></div>
      <AgentConnectionSetup radioId={radioId} providers connections followSelection compact onSession={next => { setSession(next); onRouting(next.active_radio, next.tx_owner); }} />
    </section>
    <details className="radio-settings-disclosure">
      <summary>Configuration and control readiness</summary>
      <div className="radio-settings-readiness">
        <div><ShieldCheck size={16} aria-hidden="true" /><p><strong>Transmit authority</strong><span>{snapshot?.allow_transmit === true ? "Requested for this connection" : "Not granted"}</span></p></div>
        <dl><dt>Radio identity</dt><dd>{session?.selection.selection_id ?? "Unavailable"}</dd>
          <dt>Observed frequency</dt><dd>{typeof snapshot?.radio?.frequency_hz === "number" ? `${(snapshot.radio.frequency_hz / 1e6).toFixed(6)} MHz` : "Unavailable"}</dd>
          <dt>Mode</dt><dd>{snapshot?.radio?.mode ?? "Unavailable"}</dd>
          <dt>Available controls</dt><dd>{capabilities.length ? capabilities.map(item => item.replace(/^station_/, "").replace(/_/g, " ")).join(" · ") : "No confirmed controls"}</dd></dl>
        <p>Operational commands remain gated by the selected radio identity, fresh observations, provider capabilities and station interlocks. Configuration changes never transmit by themselves.</p>
      </div>
    </details>
  </div>;
}

export default function RadioSettings({ requestedRadioId, requestedRadioRevision }: { requestedRadioId?: RadioID; requestedRadioRevision?: number }) {
  const [radioId, setRadioId] = useState<RadioID>("radio1");
  const [routing, setRouting] = useState<{ active: RadioID | null; owner: RadioID | null }>({ active: null, owner: null });
  useEffect(() => { if (requestedRadioId) setRadioId(requestedRadioId); }, [requestedRadioId, requestedRadioRevision]);
  return <section className="radio-settings" aria-label="Radio settings">
    <header><h2>Radios</h2><p>Each setup has its own saved identity, connection and operation receipts.</p></header>
    <div className="radio-settings-tabs" role="tablist" aria-label="Configured radios">
      {radios.map((id, index) => <button key={id} type="button" role="tab" id={`radio-settings-tab-${id}`}
        aria-controls={`radio-settings-panel-${id}`} aria-selected={radioId === id} tabIndex={radioId === id ? 0 : -1}
        onClick={() => setRadioId(id)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1
            : event.key === "ArrowRight" ? (index + 1) % radios.length : event.key === "ArrowLeft" ? (index + radios.length - 1) % radios.length : null;
          if (next !== null) { event.preventDefault(); const selected = radios[next]; setRadioId(selected); document.getElementById(`radio-settings-tab-${selected}`)?.focus(); }
        }}>{label(id)}</button>)}
    </div>
    {radios.map(id => <RadioSlot key={id} radioId={id} visible={radioId === id} activeRadio={routing.active} txOwner={routing.owner}
      onRouting={(active, owner) => setRouting({ active, owner })} />)}
  </section>;
}
