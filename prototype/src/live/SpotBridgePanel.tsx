import { useEffect, useRef, useState } from "react";
import "./SpotBridgePanel.css";
import { useSettingsSaveToast } from "./SettingsSaveToast";

type Style = { priority: number; colorHex: string; lifetimeSeconds: number };
type Configuration = { enabled: boolean; logbookPort: number; contestPort: number; styles: Record<string, Style> };
type Snapshot = { configuration: Configuration; running: boolean; received_count: number;
  accepted_count: number; rejected_count: number; duplicate_count: number; dropped_count?: number; status: string };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
export const spotCategories = [
  ["stationWorkedBefore", "Station worked before", "Logbook"], ["dxccNotConfirmed", "DXCC not confirmed", "Logbook"],
  ["bandNotConfirmed", "Band not confirmed", "Logbook"], ["modeNotConfirmed", "Mode not confirmed", "Logbook"],
  ["slotNotConfirmed", "Slot not confirmed", "Logbook"], ["other", "Other", "Logbook"],
  ["newMultiplier", "New multiplier", "Contest"], ["workedBefore", "Worked before", "Contest"],
  ["useful", "Useful", "Contest"], ["useless", "Useless", "Contest"], ["unknown", "Unknown", "Contest"],
] as const;

export function validSpotConfiguration(value: Configuration | null): boolean {
  return !!value && Number.isInteger(value.logbookPort) && value.logbookPort >= 1024 && value.logbookPort <= 65535 &&
    Number.isInteger(value.contestPort) && value.contestPort >= 1024 && value.contestPort <= 65535 && value.logbookPort !== value.contestPort &&
    spotCategories.every(([key]) => {
      const style = value.styles?.[key];
      return style && Number.isInteger(style.priority) && style.priority >= 1 && style.priority <= 5 &&
        /^#[0-9a-f]{6}$/i.test(style.colorHex) && Number.isInteger(style.lifetimeSeconds) && style.lifetimeSeconds >= 30 && style.lifetimeSeconds <= 86400;
    });
}

export default function SpotBridgePanel({ request, provider = "direct_agent" }: { request: Request; provider?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Configuration | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveToast = useSettingsSaveToast();
  const requestRef = useRef(request); requestRef.current = request;
  useEffect(() => {
    let active = true, reading = false;
    const read = async () => {
      if (reading) return; reading = true;
      try {
        const value = await requestRef.current("spot_bridge_snapshot");
        if (active) { setSnapshot(value); setDraft(current => current ?? value.configuration); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Spot receiver unavailable."); }
      finally { reading = false; }
    };
    void read(); const timer = window.setInterval(() => void read(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const edit = (update: (current: Configuration) => Configuration) => {
    setDraft(current => current ? update(current) : current); setDirty(true); setNotice("");
  };
  const style = (key: string, patch: Partial<Style>) => edit(current => ({ ...current,
    styles: { ...current.styles, [key]: { ...current.styles[key], ...patch } } }));
  const save = async (start: boolean) => {
    if (!validSpotConfiguration(draft) || busy || start && provider !== "direct_agent") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const configured = await request("spot_bridge_configure", { configuration: { ...draft, enabled: start ? true : draft!.enabled } });
      setSnapshot(configured); setDraft(configured.configuration); setDirty(false);
      if (start) {
        const running = await request("spot_bridge_start"); setSnapshot(running);
        saveToast.show("Spot bridge settings saved and listeners started");
      } else saveToast.show("Spot bridge settings saved");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not configure spot receiver."); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError("");
    try { const value = await request("spot_bridge_stop"); setSnapshot(value); setDraft(current => current ? { ...current, enabled: false } : value.configuration); setNotice("UDP listeners stopped."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not stop spot receiver."); }
    finally { setBusy(false); }
  };
  return <section className="spot-bridge" aria-label="RUMlog spot bridge">
    <header><div><h2>RUMlog spot bridge</h2><p>Logbook and contest spots → the embedded Remote Station Agent's FLEX display. No separate SpotToSunFlex application is needed.</p></div>
      <strong className={snapshot?.running ? "teal" : "secondary"}>{snapshot?.running ? "Listening" : "Stopped"}</strong></header>
    {error && <p className="live-error" role="alert">{error}</p>}
    {notice && <p className="live-message" role="status">{notice}</p>}{saveToast.toast}
    {provider !== "direct_agent" && <p className="spot-bridge-provider-note" role="status">Select and connect Remote station · embedded xCat to start forwarding. Direct FLEX LAN and Hamlib do not receive these UDP spots. An already-running listener is not stopped by changing provider.</p>}
    {draft ? <>
      <div className="spot-bridge-ports">
        <label>Logbook UDP port<input aria-label="Logbook UDP port" type="number" min="1024" max="65535" value={draft.logbookPort} onChange={e => edit(value => ({ ...value, logbookPort: Number(e.target.value) }))} /></label>
        <label>Contest UDP port<input aria-label="Contest UDP port" type="number" min="1024" max="65535" value={draft.contestPort} onChange={e => edit(value => ({ ...value, contestPort: Number(e.target.value) }))} /></label>
        <span>Send RUMlog UDP to <code>127.0.0.1</code>. Close any other receiver using these ports before starting.</span>
      </div>
      <table><thead><tr><th>Feed</th><th>Category</th><th>Priority</th><th>Colour</th><th>Lifetime, seconds</th></tr></thead>
        <tbody>{spotCategories.map(([key, title, feed]) => <tr key={key}>
          <td>{feed}</td><th scope="row">{title}</th>
          <td><select aria-label={`${title} ${feed} priority`} value={draft.styles[key]?.priority ?? ""} onChange={e => style(key, { priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>{priority}{priority === 5 ? " · highest" : ""}</option>)}</select></td>
          <td><input type="color" aria-label={`${title} ${feed} colour`} value={draft.styles[key]?.colorHex ?? "#000000"} onChange={e => style(key, { colorHex: e.target.value.toUpperCase() })} /></td>
          <td><input type="number" aria-label={`${title} ${feed} lifetime seconds`} min="30" max="86400" value={draft.styles[key]?.lifetimeSeconds ?? ""} onChange={e => style(key, { lifetimeSeconds: Number(e.target.value) })} /></td>
        </tr>)}</tbody></table>
      <div className="live-actions"><button disabled={busy || !validSpotConfiguration(draft)} onClick={() => void save(false)}>Save settings</button>
        <button className="primary" disabled={busy || provider !== "direct_agent" || !validSpotConfiguration(draft)} onClick={() => void save(true)}>Save and start listeners</button>
        <button disabled={busy || !snapshot?.running} onClick={() => void stop()}>Stop listeners</button>
        {dirty && <span className="amber">Unsaved changes</span>}</div>
      {!validSpotConfiguration(draft) && <p role="alert">Use distinct ports from 1024–65535, priorities from 1–5 and lifetimes from 30–86400 seconds.</p>}
    </> : <p role="status">Loading saved spot settings…</p>}
    <footer><span>{snapshot?.status || "Checking receiver"}</span><span>Received {snapshot?.received_count ?? 0} · ACK accepted {snapshot?.accepted_count ?? 0} · Rejected {snapshot?.rejected_count ?? 0} · Duplicates {snapshot?.duplicate_count ?? 0} · Dropped {snapshot?.dropped_count ?? 0}</span>
      <small>ACK accepted means the radio command was acknowledged, not that its marker has been visually inspected on the Maestro. Cluster and UDP spots share duplicate suppression.</small></footer>
  </section>;
}
