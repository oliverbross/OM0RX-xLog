import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadStationSession, radioConnected, radioLabel, radioName, stationSessionRequest, type RadioID, type StationSession } from "./stationSession";

/** Operating routing only. This never connects, arms or modifies a radio profile. */
export function RadioOperatingSelector({ onSettings }: { onSettings?: (radioId: RadioID) => void }) {
  const [sessions, setSessions] = useState<StationSession[]>([]), [error, setError] = useState(""), [readError, setReadError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef(false), reading = useRef(false), again = useRef(false), switching = useRef(false);
  const refresh = async () => {
    if (reading.current) { again.current = true; return; }
    reading.current = true;
    try {
      do {
        again.current = false;
        const next = await Promise.all([loadStationSession("radio1"), loadStationSession("radio2")]);
        if (active.current) { setSessions(next); setReadError(""); }
      } while (active.current && again.current);
    } catch (cause) { if (active.current) setReadError(`Radio routing is unavailable. ${typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "Check connection status in Settings."}`); }
    finally { reading.current = false; }
  };
  useEffect(() => {
    active.current = true; const stops: (() => void)[] = [];
    void Promise.allSettled(["xlog:station-session", "xlog:station-telemetry"].map(event => listen(event, () => void refresh()))).then(results => {
      for (const result of results) if (result.status === "fulfilled") { if (active.current) stops.push(result.value); else result.value(); }
      if (active.current) void refresh();
    });
    return () => { active.current = false; stops.forEach(stop => stop()); };
  }, []);
  const owner = sessions.find(session => session.tx_owner)?.tx_owner;
  const choose = async (id: RadioID) => {
    if (switching.current) return;
    switching.current = true; setBusy(true); setError("");
    try {
      // Recheck immediately; native routing/TX locks remain the authority.
      const states = await Promise.all([loadStationSession("radio1"), loadStationSession("radio2")]);
      const held = states.find(value => value.tx_owner)?.tx_owner;
      if (held && states[0].active_radio !== id) throw new Error(`${radioLabel(held)} currently has transmit control. Disconnect it in Radios settings before switching.`);
      if (states.some(value => [value.pending_setup_receipt, value.last_receipt, value.manual_tune_receipt, value.tci_filter_receipt].some(receipt => receipt && ["pending", "unknown"].includes(receipt.status)))) throw new Error("A radio operation is unresolved. Check it in Radios settings before switching.");
      const result = await stationSessionRequest<{ active_radio: RadioID }>(id, { action: "set_active_radio" });
      if (result.active_radio !== id) throw new Error("The operating radio was not confirmed. Check routing before another request.");
      await refresh();
    } catch (cause) { if (active.current) setError(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "The operating radio could not be changed."); }
    finally { switching.current = false; if (active.current) setBusy(false); }
  };
  return <section aria-label="Operating radio" className="radio-operating-selector">
    {(["radio1", "radio2"] as const).map(id => {
      const state = sessions.find(value => value.radio_id === id);
      return <button key={id} type="button" aria-pressed={state?.active_radio === id} disabled={busy || !state}
        title={state?.active_radio === id ? "Active for logging" : `Use ${radioLabel(id)} for logging`}
        onClick={() => void choose(id)}>{id === "radio1" ? "R1" : "R2"} · {radioName(state ?? null)} · {radioConnected(state ?? null) ? "Connected" : "Offline"}</button>;
    })}
    {(error || readError) && <p role="alert">{error || readError}{owner && onSettings && <button type="button" onClick={() => onSettings(owner)}>Open {radioLabel(owner)} settings</button>}</p>}
  </section>;
}
