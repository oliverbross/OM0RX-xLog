import { useState } from "react";
import { currentStackClassification, partialStackCall, type CallStackClassification, type CallStackDecision,
  type CallStackState } from "./contestCallStack";

export type ContestCallStackPanelProps = {
  state: CallStackState;
  disabled?: boolean;
  occupied: boolean;
  currentCallsign: string;
  classificationScope: string;
  classifications: CallStackClassification[];
  onAdd(callsign: string): void;
  onSelect(id: string): void;
  onPromote(id: string): void;
  onRemove(id: string): void;
  onLoad(id: string, decision?: CallStackDecision): void;
  onLogNext(): void;
  onRecover(retryMissing: boolean): void;
  onKeepQueue(): void;
};
/** Inline in the existing session owner: every callback uses the existing Python mutation path. */
export function ContestCallStackPanel({ state, disabled = false, occupied, currentCallsign, classificationScope,
  classifications, onAdd, onSelect, onPromote, onRemove, onLoad, onLogNext, onRecover, onKeepQueue }: ContestCallStackPanelProps) {
  const [call, setCall] = useState(""), [decision, setDecision] = useState<CallStackDecision | "">(""),
    [showOnDeck, setShowOnDeck] = useState(true);
  const locked = disabled || state.pending !== null;
  const selected = state.items.find(item => item.id === state.selectedID), next = state.items[0];
  const load = (id: string) => { onLoad(id, occupied ? decision || undefined : undefined); setDecision(""); };
  return <section className="contest-call-stack" aria-label="Call Stack">
    <header><h2>Call Stack</h2><p>Manual order · {state.items.length} queued · heard fragments only</p>
      <label><input type="checkbox" checked={showOnDeck} onChange={event => setShowOnDeck(event.target.checked)}/> Show On Deck</label></header>
    {showOnDeck && <p aria-label="On Deck">On Deck: <strong>{next?.callsign ?? "No queued caller"}</strong>
      {next && partialStackCall(next.callsign) && " · partial call, complete before logging"}</p>}
    <div className="contest-call-stack-add"><label>Heard call or partial <input aria-label="Add heard call to stack" value={call}
      disabled={locked} maxLength={32} autoComplete="off" onChange={event => setCall(event.target.value.toUpperCase())}/></label>
      <button type="button" disabled={locked || !call.trim()} onClick={() => { onAdd(call); setCall(""); }}>Add caller</button></div>
    {occupied && <label>Current entry decision <select aria-label="Occupied entry decision" disabled={locked} value={decision}
      onChange={event => setDecision(event.target.value as CallStackDecision | "")}>
      <option value="">Choose before loading</option><option value="swap">Swap with queued caller</option>
      <option value="park">Park current caller at end</option><option value="discard">Discard current entry</option>
    </select></label>}
    <ol aria-label="Queued callers">{state.items.map(item => {
      const classification = currentStackClassification(item, classificationScope, classifications), partial = partialStackCall(item.callsign);
      return <li key={item.id}>
        <button type="button" disabled={locked} aria-pressed={state.selectedID === item.id} onClick={() => onSelect(item.id)}>{item.callsign}</button>
        <span>{partial ? "Partial · assistance only" : classification?.state === "duplicate" ? `Duplicate · retained: ${classification.reason}`
          : classification?.state === "clear" ? "Clear in current duplicate scope" : "Duplicate status pending"}</span>
        {Object.entries(item.fragments).map(([id, fragment]) => <span key={id}> · {id}: {fragment.value} (heard)</span>)}
        <button type="button" aria-label={`Promote ${item.callsign}`} disabled={locked || item.id === next?.id} onClick={() => onPromote(item.id)}>First</button>
        <button type="button" aria-label={`Remove ${item.callsign}`} disabled={locked} onClick={() => onRemove(item.id)}>Remove</button>
      </li>;
    })}</ol>
    <div className="contest-call-stack-actions">
      <button type="button" disabled={locked || !selected || occupied && !decision} onClick={() => selected && load(selected.id)}>Load selected</button>
      <button type="button" disabled={locked || !next || occupied && !decision} onClick={() => next && load(next.id)}>Load next</button>
      <button type="button" disabled={locked || !next || !currentCallsign.trim() || partialStackCall(currentCallsign)} onClick={onLogNext}>Log and load next</button>
    </div>
    {state.pending && <div role="status"><p>{state.pending.phase === "committed"
      ? "Contact saved. Queue retained until the next caller is loaded; resolve any changed entry explicitly."
      : "Operation pending confirmation. Entry and queue are retained; recover the original receipt before continuing."}</p>
      <button type="button" disabled={disabled} onClick={() => onRecover(false)}>Check original receipt</button>
      {state.pending.phase !== "committed" && <button type="button" disabled={disabled} onClick={() => onRecover(true)}>Retry original operation</button>}
      {state.pending.phase === "committed" && <button type="button" disabled={disabled} onClick={onKeepQueue}>Keep queue for manual loading</button>}
    </div>}
    <p>Loading changes Entry only. Calls containing ? must be completed before a contact can be saved.</p>
  </section>;
}
