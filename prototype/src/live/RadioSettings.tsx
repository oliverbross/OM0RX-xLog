import { useEffect, useState } from "react";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { radioLabel, radioName, type RadioID, type StationSession } from "./stationSession";
import "./RadioSettings.css";

const radios = ["radio1", "radio2"] as const;
export default function RadioSettings({ requestedRadioId, requestedRadioRevision, onRefreshLocalState, onDraftState }: { requestedRadioId?: RadioID; requestedRadioRevision?: number; onRefreshLocalState?: () => Promise<string>; onDraftState?: (id: RadioID, blocked: boolean) => void }) {
  const [radioId, setRadioId] = useState<RadioID>("radio1");
  const [sessions, setSessions] = useState<Partial<Record<RadioID, StationSession>>>({});
  const [message, setMessage] = useState("");
  useEffect(() => { if (requestedRadioId) setRadioId(requestedRadioId); }, [requestedRadioId, requestedRadioRevision]);
  return <section className="radio-settings" aria-label="Radio settings">
    <header><h2>Radios</h2><p>Choose your transceiver and connection. Each radio keeps its own setup.</p></header>
    <div className="radio-settings-tabs" role="tablist" aria-label="Configured radios">
      {radios.map((id, index) => <button key={id} type="button" role="tab" id={`radio-settings-tab-${id}`}
        aria-controls={`radio-settings-panel-${id}`} aria-selected={radioId === id} tabIndex={radioId === id ? 0 : -1}
        onClick={() => setRadioId(id)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1
            : event.key === "ArrowRight" ? (index + 1) % radios.length : event.key === "ArrowLeft" ? (index + radios.length - 1) % radios.length : null;
          if (next !== null) { event.preventDefault(); const selected = radios[next]; setRadioId(selected); document.getElementById(`radio-settings-tab-${selected}`)?.focus(); }
        }}>{radioLabel(id)} · {radioName(sessions[id] ?? null)}</button>)}
    </div>
    {radios.map(id => <div key={id} role="tabpanel" id={`radio-settings-panel-${id}`} aria-labelledby={`radio-settings-tab-${id}`} hidden={radioId !== id}>
      <AgentConnectionSetup radioId={id} radioForm onDraftState={blocked => onDraftState?.(id, blocked)} onSession={next => setSessions(previous => ({ ...previous, [id]: next }))} />
    </div>)}
    {onRefreshLocalState && <details className="radio-settings-disclosure"><summary>Local app diagnostics</summary>
      <p>Refresh xLog's local draft and radio observation if a finished operation is blocking spot selection. This does not disconnect the Remote Station Agent, rotor, or Wavelog.</p>
      <button type="button" onClick={() => void onRefreshLocalState().then(setMessage, cause => setMessage(cause instanceof Error ? cause.message : "Local state could not be refreshed."))}>Refresh local radio state</button>
      {message && <p role="status">{message}</p>}
    </details>}
  </section>;
}
