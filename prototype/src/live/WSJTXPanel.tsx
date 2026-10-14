import { useEffect, useRef, useState } from "react";
import "./WSJTXPanel.css";

type Configuration = { enabled: boolean; address: string; port: number };
type Snapshot = { configuration: Configuration; running: boolean; received_count: number; imported_count: number;
  duplicate_count: number; ignored_count: number; rejected_count: number; dropped_count: number; status: string; receive_only: boolean };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;

export function validWSJTXConfiguration(value: Configuration | null): boolean {
  if (!value || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return false;
  const octets = value.address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part, index) => !/^\d+$/.test(value.address.split(".")[index]) || !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return value.address === "127.0.0.1" || (octets[0] >= 224 && octets[0] <= 239);
}

export default function WSJTXPanel({ request, onImported }: { request: Request; onImported?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Configuration | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef(request); requestRef.current = request;
  const onImportedRef = useRef(onImported); onImportedRef.current = onImported;
  const importedRef = useRef(0);

  useEffect(() => {
    let active = true, reading = false;
    const read = async () => {
      if (reading) return; reading = true;
      try {
        const value = await requestRef.current("wsjtx_snapshot") as Snapshot;
        if (active) {
          if (value.imported_count > importedRef.current) onImportedRef.current?.();
          importedRef.current = value.imported_count;
          setSnapshot(value); setDraft(current => current ?? value.configuration);
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "WSJT-X listener unavailable."); }
      finally { reading = false; }
    };
    void read(); const timer = window.setInterval(() => void read(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const edit = (change: Partial<Configuration>) => {
    setDraft(current => current ? { ...current, ...change } : current); setDirty(true); setNotice("");
  };
  const save = async (start: boolean) => {
    if (!validWSJTXConfiguration(draft) || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const configured = await request("wsjtx_configure", { configuration: { ...draft, enabled: start ? true : draft!.enabled } });
      setSnapshot(configured); setDraft(configured.configuration); setDirty(false);
      if (start) {
        const running = await request("wsjtx_start"); setSnapshot(running);
        setNotice("Listening for contacts accepted in WSJT-X. No packets or radio commands are sent.");
      } else setNotice("Settings saved. Listening resumes automatically on the next app start only when enabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not configure WSJT-X logging."); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await request("wsjtx_stop"); setSnapshot(value); setDraft(value.configuration); setDirty(false);
      setNotice("WSJT-X logging stopped and disabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not stop WSJT-X logging."); }
    finally { setBusy(false); }
  };

  return <section className="wsjtx-panel" aria-label="WSJT-X UDP logging">
    <header><div><h2>WSJT-X UDP logging</h2><p>Receive the Logged ADIF message after you accept WSJT-X’s Log QSO dialog. Contacts save locally first and use the normal duplicate and synchronization rules.</p></div>
      <strong className={snapshot?.running ? "teal" : "secondary"}>{snapshot?.running ? "Listening" : "Stopped"}</strong></header>
    <p className="wsjtx-safety">Receive-only: xLog never sends WSJT-X packets, replies to decodes, keys PTT or changes the radio through this integration.</p>
    {error && <p className="live-error" role="alert">{error}</p>}
    {notice && <p className="live-message" role="status">{notice}</p>}
    {draft ? <>
      <div className="wsjtx-fields">
        <label>UDP address<input aria-label="WSJT-X UDP address" value={draft.address} maxLength={45} onChange={event => edit({ address: event.target.value.trim() })} /></label>
        <label>UDP port<input aria-label="WSJT-X UDP port" type="number" min="1" max="65535" value={draft.port} onChange={event => edit({ port: Number(event.target.value) })} /></label>
      </div>
      <p>Use <code>127.0.0.1</code> for one computer, or the same IPv4 multicast group configured in WSJT-X when several applications need the feed. The WSJT-X default port is <code>2237</code>.</p>
      <div className="live-actions"><button type="button" disabled={busy || !validWSJTXConfiguration(draft)} onClick={() => void save(false)}>Save settings</button>
        <button type="button" className="primary" disabled={busy || !validWSJTXConfiguration(draft)} onClick={() => void save(true)}>Save and listen</button>
        <button type="button" disabled={busy || !(snapshot?.running || snapshot?.configuration.enabled)} onClick={() => void stop()}>Stop listening</button>
        {dirty && <span className="amber">Unsaved changes</span>}</div>
      {!validWSJTXConfiguration(draft) && <p role="alert">Use 127.0.0.1 or an IPv4 multicast address from 224.0.0.0–239.255.255.255, and a port from 1–65535.</p>}
    </> : <p role="status">Loading WSJT-X settings…</p>}
    <footer><span>{snapshot?.status || "Checking listener"}</span><span>Datagrams {snapshot?.received_count ?? 0} · Logged {snapshot?.imported_count ?? 0} · Duplicates {snapshot?.duplicate_count ?? 0} · Other messages {snapshot?.ignored_count ?? 0} · Rejected {snapshot?.rejected_count ?? 0} · Dropped {snapshot?.dropped_count ?? 0}</span></footer>
  </section>;
}
