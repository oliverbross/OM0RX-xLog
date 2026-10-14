import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadStationSession, stationSessionRequest, type StationReceipt, type StationSession } from "./stationSession";
import type { StationProvider } from "../worker";

const journalKey = "xlog.station-session.pending";
const reviewedKey = "xlog.station-session.reviewed";
const providerLabels: Record<StationProvider, string> = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", hamlib: "Local Hamlib" };
const notice = (receipt: StationReceipt) => receipt.request.action === "select"
  ? receipt.status === "acknowledged" ? "Radio selection acknowledged. Connect the selected radio explicitly."
    : "Radio selection outcome is unknown. Review the selected radio and check this receipt before another request."
  : receipt.status === "saved" ? "Agent endpoint saved. No connection was started."
  : receipt.status === "acknowledged" ? "Connection request acknowledged. Check observed station state before operating."
  : "Connection outcome is unknown. Check observed station state before issuing another connection request.";

/** Desk and child share one native Agent setup, lifecycle and receipt owner. */
export function AgentConnectionSetup({ connections = false, legacyEndpoint = "", providers = false, onlySelection = false, selectionTarget }: {
  connections?: boolean; legacyEndpoint?: string; providers?: boolean; onlySelection?: boolean; selectionTarget?: StationProvider;
}) {
  const [state, setState] = useState<StationSession | null>(null), [url, setURL] = useState("");
  const [token, setToken] = useState(""), [transmit, setTransmit] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [pending, setPending] = useState(() => sessionStorage.getItem(journalKey));
  const [conflict, setConflict] = useState(false);
  const [legacyHint, setLegacyHint] = useState(false);
  const [providerTarget, setProviderTarget] = useState<StationProvider | null>(null);
  const active = useRef(false), dirty = useRef(false), inFlight = useRef(false), readSequence = useRef(0);
  const current = useRef<StationSession | null>(null);
  const refresh = async (adopt = false) => {
    const sequence = ++readSequence.current;
    try {
      const next = await loadStationSession();
      if (!active.current || sequence !== readSequence.current) return;
      if (adopt || !dirty.current) {
        const hint = !adopt && !current.current && !next.base_url && next.revision === 0 && !next.last_receipt ? legacyEndpoint : "";
        current.current = next; setState(next); setURL(hint || next.base_url); dirty.current = !!hint; setConflict(false);
        setLegacyHint(!!hint);
      } else if (next.generation !== current.current?.generation || next.revision !== current.current?.revision) {
        setConflict(true);
      } else { current.current = next; setState(next); }
      if (next.last_receipt && ["pending", "unknown"].includes(next.last_receipt.status)
        && sessionStorage.getItem(reviewedKey) !== next.last_receipt.operation_id) {
        sessionStorage.setItem(journalKey, next.last_receipt.operation_id); setPending(next.last_receipt.operation_id);
        setMessage(notice(next.last_receipt));
      }
      if (next.last_receipt && ["saved", "acknowledged"].includes(next.last_receipt.status)
        && sessionStorage.getItem(journalKey) === next.last_receipt.operation_id) {
        sessionStorage.removeItem(journalKey); setPending(null); setMessage(notice(next.last_receipt));
      }
      setError("");
    } catch { if (active.current && sequence === readSequence.current) setError("Shared Agent setup is unavailable. Refresh before making changes."); }
  };
  useEffect(() => {
    active.current = true; const stops: (() => void)[] = [];
    const focused = () => { void refresh(); };
    window.addEventListener("focus", focused);
    void Promise.allSettled(["xlog:station-session", "xlog:station-selection"].map(name => listen(name, () => { void refresh(); }))).then(results => {
      for (const result of results) {
        if (result.status === "fulfilled") { if (active.current) stops.push(result.value); else result.value(); }
      }
      if (active.current) void refresh();
    });
    return () => { active.current = false; readSequence.current++; stops.forEach(stop => stop()); window.removeEventListener("focus", focused); };
  }, []);
  const target = selectionTarget ?? providerTarget ?? (state?.selection.provider as StationProvider | null) ?? "direct_agent";
  const execute = async (action: "save" | "connect" | "disconnect" | "forget" | "select") => {
    const base = current.current;
    if (!base || inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const id = crypto.randomUUID();
    try {
      // Journal identity only: tokens and access-bearing connection details never enter browser storage.
      sessionStorage.setItem(journalKey, id); setPending(id);
      const receipt = await stationSessionRequest<StationReceipt>({ action, operation_id: id, generation: base.generation, revision: base.revision,
        ...(action === "save" ? { base_url: url.trim() } : { selection_generation: base.selection.generation, selection_id: base.selection.selection_id,
          ...(action === "select" ? { provider: target } : { allow_transmit: action === "connect" && transmit }), ...(action === "connect" && token ? { token } : {}) }) });
      if (!active.current) return;
      setToken(""); setTransmit(false); setMessage(notice(receipt));
      if (receipt.status === "saved" || receipt.status === "acknowledged") {
        sessionStorage.removeItem(journalKey); setPending(null); await refresh(action === "save");
      }
    } catch { if (active.current) setError("No outcome was confirmed. Check this operation's receipt before trying another request."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const check = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await stationSessionRequest<StationReceipt | null>({ action: "receipt", operation_id: pending });
      if (!active.current) return;
      setError(""); setMessage(receipt ? notice(receipt) : "No operation was admitted under this identity. Refresh setup before trying again.");
      if (!receipt || receipt.status === "saved" || receipt.status === "acknowledged") {
        sessionStorage.removeItem(journalKey); setPending(null); await refresh();
      }
    } catch { if (active.current) setError("The receipt is unavailable. Keep this operation pending and check again."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const selected = state?.selection.provider === "direct_agent" && !!state.selection.selection_id;
  return <div className="live-station-connect" aria-label={onlySelection ? "Shared radio selection" : "Shared Agent connection setup"}>
    {providers && <div>
      <p>Selected radio: {state?.selection.provider ? providerLabels[state.selection.provider as StationProvider] : "Unavailable"}. Applying a different provider retires the previous radio. Connect the selected radio explicitly.</p>
      {selectionTarget ? <p>Requested radio: {providerLabels[selectionTarget]}</p> : <label>Radio provider<select aria-label="Shared radio provider" value={target} disabled={!state || busy || !!pending} onChange={event => setProviderTarget(event.target.value as StationProvider)}>
        {(Object.keys(providerLabels) as StationProvider[]).map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}
      </select></label>}
      <button type="button" disabled={!state?.selection.selection_id || state.selection.provider === target || busy || !!pending || !!error}
        onClick={() => void execute("select")}>Apply shared radio selection</button>
    </div>}
    {!onlySelection && <><p>Saved Agent endpoint is shared across windows. Saving it does not connect a radio.</p>
    <label>Agent HTTPS URL<input aria-label="Shared Agent HTTPS URL" type="url" value={url} disabled={!state || busy}
      placeholder="https://station.example:8443" onChange={event => { dirty.current = true; setLegacyHint(false); setURL(event.target.value); }} /></label>
    <div className="live-station-actionrow"><button type="button" disabled={!state || busy || !!pending || conflict} onClick={() => void execute("save")}>{legacyHint ? "Import previous Agent endpoint" : "Save Agent endpoint"}</button>
      <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved endpoint</button></div>
    {legacyHint && <p>Your previous Desk endpoint is shown for review. Import it once to share it across windows.</p>}
    {state && dirty.current && <p>Save endpoint changes before connecting. This text has not changed shared setup.</p>}
    {conflict && <p role="alert">Agent setup changed in another window. Your text is retained; reload saved endpoint to review the current setup.</p>}
    </>}
    {connections && <>
      <label>Agent token<input aria-label="Shared Agent token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
      <label><input type="checkbox" checked={transmit} onChange={event => setTransmit(event.target.checked)} /> Allow CAT transmit controls for this connection</label>
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved Agent</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect Agent</button></div>
      <button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("forget")}>Forget saved Agent token</button>
      {!selected && <p>{providers ? "Select Remote Station Agent above before connecting." : "Select Remote Station Agent in the main station controls before connecting."}</p>}
    </>}
    {onlySelection && <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh radio selection</button>}
    {pending && <button type="button" disabled={busy} onClick={() => void check()}>{onlySelection ? "Check radio selection receipt" : "Check connection setup receipt"}</button>}
    {pending && message.includes("unknown") && <button type="button" disabled={busy} onClick={() => { sessionStorage.setItem(reviewedKey, pending); sessionStorage.removeItem(journalKey); setPending(null); setMessage("Previous outcome remains unknown. Review observed state before a new explicit request."); void refresh(); }}>I have reviewed observed state</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {state?.last_receipt && <p>Last shared operation: {state.last_receipt.request.action} · {state.last_receipt.status}. Acknowledgement does not confirm radio state.</p>}
  </div>;
}
