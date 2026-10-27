import type { KeyboardEvent, ReactNode } from "react";
import { ContestTextField } from "./ContestPresentation";
import { contestKeyChord, resolveContestKeyBinding, type ContestKeyBinding,
  type ContestKeyBindingAction, type ContestKeyBindingContext } from "./contestKeyBindings";
import "./ContestOperatingLanes.css";

export type ContestOperatingLaneID = "laneA" | "laneB";
export type ContestLaneBinding = { radioID: string; receiverID: string | null; vfo: string | null;
  sliceID: string | null; generation: string | number; status?: "configured" | "current" | "stale" | "unavailable" };
export type ContestLaneField = { id: string; label: string; value: string; visible?: boolean; enabled?: boolean;
  readOnly?: boolean; required?: boolean; maximumUTF8Bytes?: number };
export type ContestOperatingLane = {
  laneID: ContestOperatingLaneID; label?: string; draftID: string; bindingVersion: number;
  binding: ContestLaneBinding | null; fields: readonly ContestLaneField[];
  frequencyHz: number | null; frequencyText?: string; receiveFrequencyHz?: number | null; receiveFrequencyText?: string;
  mode: string; modes?: readonly string[]; run: boolean; reservedSerial: number | null;
  rememberedCQHz?: number | null; enterPolicy?: "manual" | "esm";
  keyBindings?: readonly ContestKeyBinding[]; functionKeys?: readonly { key: string; label: string }[];
  dupe?: { state: "unchecked" | "clear" | "duplicate"; reason?: string };
  errors?: readonly string[]; disabled?: boolean; canLog?: boolean; canSend?: boolean;
  canStop?: boolean; outputUnavailableReason?: string | null;
};
export type ContestLaneActionContext = { laneID: ContestOperatingLaneID; draftID: string;
  bindingVersion: number; bindingGeneration: string | number | null };
export type ContestLaneAction = ContestLaneActionContext & (
  | { kind: "field-change"; fieldID: string; value: string }
  | { kind: "focus"; fieldID: string }
  | { kind: "frequency-change"; value: string }
  | { kind: "receive-frequency-change"; value: string }
  | { kind: "mode-change"; value: string }
  | { kind: "run-change"; value: boolean }
  | { kind: "remember-cq" | "return-cq" | "tune" | "listen" | "request-tx" | "log" | "clear" | "stop" }
  | { kind: "function-key"; key: string }
  | { kind: "operator-key"; key: "Enter"; fieldID: string | null }
  | { kind: "key-binding"; action: ContestKeyBindingAction; fieldID: string | null }
);
type LaneIntent<T = ContestLaneAction> = T extends ContestLaneAction ? Omit<T, keyof ContestLaneActionContext> : never;
export type ContestObservedTransmit = { state: "unknown" | "idle" | "transmitting" | "uncertain";
  laneID?: ContestOperatingLaneID | null; radioID?: string | null };
export type ContestOperatingLanesProps = {
  mode: "SO1V" | "SO2V" | "SO2R"; lanes: readonly ContestOperatingLane[];
  entryLaneID: ContestOperatingLaneID | null; listeningLaneID: ContestOperatingLaneID | null;
  requestedTransmitLaneID: ContestOperatingLaneID | null; observedTransmit: ContestObservedTransmit;
  disabled?: boolean; onAction: (action: ContestLaneAction) => void;
  renderLaneTools?: (lane: ContestOperatingLane) => ReactNode;
};

const laneName = (id: ContestOperatingLaneID | null | undefined) => id === "laneA" ? "Lane A" : id === "laneB" ? "Lane B" : "Unknown";
const frequency = (hz: number | null | undefined) => hz == null ? "Unknown" : `${(hz / 1_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kHz`;
function bindingContext(field: string | null): ContestKeyBindingContext {
  return field === "callsign" ? "Callsign" : field === "sent" || field === "receive" ? "Report"
    : field === "other_1" ? "Other 1" : field === "other_2" ? "Other 2" : field ? "Exchange" : "*";
}

/** Presentation and lane-bound intents only. The owner retains buffering,
 * receipts, revision fences, radio routing, arming and single-output authority.
 * Focus and field changes never synthesize listening, tune or TX requests.
 */
export function ContestOperatingLanes(props: ContestOperatingLanesProps) {
  if (props.mode === "SO1V") return null;
  const valid = props.lanes.length === 2 && new Set(props.lanes.map(lane => lane.laneID)).size === 2
    && new Set(props.lanes.map(lane => lane.draftID)).size === 2 && props.lanes.every(lane => Boolean(lane.draftID));
  if (!valid) return <section aria-label="Operating lanes"><p role="alert">Two independent lane drafts are unavailable. Refresh the contest session before using two-lane entry.</p></section>;
  const observed = props.observedTransmit;
  return <section className="contest-operating-lanes" aria-label={`${props.mode} operating lanes`}>
    <div className="contest-operating-lanes-facts" aria-label="Entry, listening and transmit state">
      <strong>{props.mode}</strong><dl>
        <div><dt>Entry focus</dt><dd>{laneName(props.entryLaneID)}</dd></div>
        <div><dt>Listening route</dt><dd>{laneName(props.listeningLaneID)}</dd></div>
        <div><dt>Requested TX</dt><dd>{laneName(props.requestedTransmitLaneID)}</dd></div>
        <div><dt>Observed TX</dt><dd>{observed.state === "transmitting" ? `Transmitting · ${laneName(observed.laneID)}${observed.radioID ? ` · ${observed.radioID}` : ""}`
          : observed.state === "idle" ? "Observed idle" : observed.state === "uncertain" ? "Uncertain" : "Unknown"}</dd></div>
      </dl>
    </div>
    <p className="contest-operating-lanes-scope">One shared log and serial authority. Entry focus, listening and transmit state are independent.</p>
    <div className="contest-operating-lanes-grid">{props.lanes.map(lane => <Lane key={`${lane.laneID}/${lane.draftID}`} lane={lane} {...props}/>)}</div>
  </section>;
}

function Lane({ lane, disabled, entryLaneID, listeningLaneID, requestedTransmitLaneID, onAction, renderLaneTools }: ContestOperatingLanesProps & { lane: ContestOperatingLane }) {
  const name = lane.label || laneName(lane.laneID), blocked = Boolean(disabled || lane.disabled);
  const binding = lane.binding, routeAvailable = Boolean(binding && !["stale", "unavailable"].includes(binding.status ?? "configured"));
  const context: ContestLaneActionContext = { laneID: lane.laneID, draftID: lane.draftID,
    bindingVersion: lane.bindingVersion, bindingGeneration: binding?.generation ?? null };
  const send = (action: LaneIntent) => onAction({ ...context, ...action } as ContestLaneAction);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const fieldID = target?.dataset.contestLaneField ?? null;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.metaKey && ["a", "c", "v", "x", "z", "arrowleft", "arrowright", "backspace"].includes(event.key.toLowerCase())) return;
    if (event.key === "Escape") { consume(); if (lane.canStop) send({ kind: "stop" }); return; }
    const chord = contestKeyChord(event), action = chord && lane.keyBindings
      ? resolveContestKeyBinding(lane.keyBindings as ContestKeyBinding[], bindingContext(fieldID), chord) : null;
    if (action) {
      consume();
      const outputBlocked = action.startsWith("SEND_F") && (!routeAvailable || !lane.canSend);
      const tuneBlocked = ["RETURN_CQ_FREQUENCY", "TUNE_SPOT", "VFO_UP", "VFO_DOWN"].includes(action) && !routeAvailable;
      if (!blocked && !outputBlocked && !tuneBlocked && (action !== "LOG_NOW" || lane.canLog))
        send({ kind: "key-binding", action, fieldID });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === "Enter" && fieldID) {
      consume();
      if (!blocked) {
        if (lane.enterPolicy === "esm") send({ kind: "operator-key", key: "Enter", fieldID });
        else if (lane.canLog) send({ kind: "log" });
      }
    } else if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) {
      consume(); if (!blocked && routeAvailable && lane.canSend) send({ kind: "function-key", key: event.key });
    }
    // Tab stays native: its only emitted effect is a field-focus intent.
  };
  return <section className={`contest-operating-lane${entryLaneID === lane.laneID ? " is-entry-focused" : ""}`}
    aria-label={name} data-lane-id={lane.laneID} onKeyDown={onKeyDown}>
    <header><h3>{name}</h3><span>{entryLaneID === lane.laneID ? "Entry focus" : "Entry available"}
      {listeningLaneID === lane.laneID ? " · Listening route" : ""}{requestedTransmitLaneID === lane.laneID ? " · TX requested" : ""}</span></header>
    <div className="contest-operating-lane-binding"><span>{binding ? `${binding.radioID} · Receiver ${binding.receiverID ?? "unknown"} · VFO ${binding.vfo ?? "unknown"} · Slice ${binding.sliceID ?? "unknown"}` : "Radio / receiver / VFO / slice unbound"}</span>
      <span>{binding ? `${binding.status ?? "configured"} · generation ${binding.generation} · binding ${lane.bindingVersion}` : `Generation unknown · binding ${lane.bindingVersion}`}</span></div>
    <div className="contest-operating-lane-fields">{lane.fields.filter(field => field.visible !== false).map(field => <ContestTextField key={field.id}
      label={field.label} aria-label={`${name} ${field.label}`} className={field.id === "callsign" ? "contest-operating-lane-call" : undefined}
      value={field.value} readOnly={field.readOnly} disabled={blocked || field.enabled === false} required={field.required}
      autoComplete="off" spellCheck={false} data-contest-lane-field={field.id}
      onFocus={() => send({ kind: "focus", fieldID: field.id })}
      onChange={event => { const value = event.target.value; if (!blocked && field.enabled !== false && !field.readOnly && new TextEncoder().encode(value).length <= (field.maximumUTF8Bytes ?? 160))
        send({ kind: "field-change", fieldID: field.id, value }); }}/>)}</div>
    <div className="contest-operating-lane-frequency"><label>Frequency Hz<input aria-label={`${name} frequency Hz`} inputMode="numeric" value={lane.frequencyText ?? (lane.frequencyHz == null ? "" : String(lane.frequencyHz))}
      disabled={blocked} onChange={event => send({ kind: "frequency-change", value: event.target.value })}/></label>
      <label>Mode<select aria-label={`${name} mode`} value={lane.mode} disabled={blocked}
        onChange={event => send({ kind: "mode-change", value: event.target.value })}>{(lane.modes ?? [lane.mode]).map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label>Receive / split Hz<input aria-label={`${name} receive frequency Hz`} inputMode="numeric" placeholder="Unknown"
        value={lane.receiveFrequencyText ?? (lane.receiveFrequencyHz == null ? "" : String(lane.receiveFrequencyHz))} disabled={blocked}
        onChange={event => send({ kind: "receive-frequency-change", value: event.target.value })}/></label>
      <span>RX {frequency(lane.receiveFrequencyHz)}<br/>Reserved serial {lane.reservedSerial ?? "unavailable"}</span></div>
    <div className={`contest-operating-lane-dupe is-${lane.dupe?.state ?? "unchecked"}`} role="status">
      {lane.dupe?.state === "duplicate" ? "Duplicate" : lane.dupe?.state === "clear" ? "Duplicate check clear" : "Duplicate check unavailable"}{lane.dupe?.reason ? ` · ${lane.dupe.reason}` : ""}</div>
    {lane.errors?.length ? <p className="contest-operating-lane-error" role="alert">{lane.errors.join(" · ")}</p> : null}
    <div className="contest-operating-lane-style" role="group" aria-label={`${name} operating style`}>
      <label><input type="radio" name={`${lane.laneID}-style`} checked={lane.run} disabled={blocked} onChange={() => send({ kind: "run-change", value: true })}/>Run</label>
      <label><input type="radio" name={`${lane.laneID}-style`} checked={!lane.run} disabled={blocked} onChange={() => send({ kind: "run-change", value: false })}/>S&amp;P</label>
      <span>CQ {frequency(lane.rememberedCQHz)}</span>
      <button type="button" disabled={blocked || lane.frequencyHz == null} onClick={() => send({ kind: "remember-cq" })}>Remember CQ</button>
      <button type="button" disabled={blocked || !routeAvailable || lane.rememberedCQHz == null} onClick={() => send({ kind: "return-cq" })}>Return CQ</button>
    </div>
    <div className="contest-operating-lane-actions">
      <button type="button" disabled={blocked || !routeAvailable || lane.frequencyHz == null} onClick={() => send({ kind: "tune" })}>Tune here</button>
      <button type="button" disabled={blocked || !routeAvailable} onClick={() => send({ kind: "listen" })}>Listen here</button>
      <button type="button" disabled={blocked || !routeAvailable} onClick={() => send({ kind: "request-tx" })}>Request TX here</button>
      <button type="button" disabled={!lane.canStop} onClick={() => send({ kind: "stop" })}>Stop {name}</button>
      <button type="button" disabled={blocked} onClick={() => send({ kind: "clear" })}>Wipe {name}</button>
      <button type="button" className="contest-primary" disabled={blocked || !lane.canLog} onClick={() => send({ kind: "log" })}>Log {name}</button>
    </div>
    {lane.functionKeys?.length ? <details className="contest-operating-lane-macros"><summary>{name} function keys</summary><div>{lane.functionKeys.map(key => <button key={key.key} type="button"
      disabled={blocked || !routeAvailable || !lane.canSend} onClick={() => send({ kind: "function-key", key: key.key })}>{key.key}: {key.label}</button>)}</div></details> : null}
    {!lane.canSend && <p className="contest-operating-lane-unavailable">{lane.outputUnavailableReason || "Output unavailable; review this lane's radio and output settings."}</p>}
    {renderLaneTools?.(lane)}
  </section>;
}
