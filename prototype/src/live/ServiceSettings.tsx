import { useState, type FormEvent } from "react";
import DataManagementPanel from "./DataManagementPanel";
import "./ServiceSettings.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Props = { values: Data; request: Request; onSaved: (value: Data) => void; dataRequest?: Request; onDataChanged?: () => void };
const tabs = ["Station", "Wavelog", "QRZ", "Reference data", "Backups"] as const;
type Tab = typeof tabs[number];

function Credential({ account, label, request }: { account: string; label: string; request: Request }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    if (busy || !value) return;
    setBusy(true); setMessage("");
    try {
      await request("secret_save", { account, value });
      setValue(""); setMessage(`${label} saved securely.`);
    } catch { setMessage(`Could not save ${label}. Check the app’s Keychain access and try again.`); }
    finally { setBusy(false); }
  };
  return <div className="service-credential"><label>{label}<input type="password" aria-label={label} autoComplete="off" value={value} disabled={busy} maxLength={8192}
    onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }} /></label>
    <button type="button" disabled={busy || !value} onClick={() => void save()}>{busy ? "Saving…" : `Save ${label}`}</button>
    {message && <p role="status">{message}</p>}</div>;
}

export default function ServiceSettings({ values, request, onSaved, dataRequest, onDataChanged }: Props) {
  const [tab, setTab] = useState<Tab>("Station");
  const [form, setForm] = useState(values);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const field = (key: string, label: string, type = "text") => <label key={key}>{label}<input aria-label={label} type={type} value={form[key] ?? ""}
    min={key === "wavelogStationID" ? 1 : undefined} step={key === "wavelogStationID" ? 1 : undefined}
    onChange={event => setForm(current => ({ ...current, [key]: key === "wavelogStationID" ? Number(event.target.value) : event.target.value }))} /></label>;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await request("settings_save", { settings: form });
      onSaved(response.settings); setForm(response.settings);
      setMessage("Settings saved. Synchronization remains manual; use Sync when ready.");
    } catch { setMessage("Could not save settings. Check the fields and try again."); }
    finally { setBusy(false); }
  };
  return <section className="service-settings" aria-label="Station and service settings">
    <div className="service-tabs" role="tablist" aria-label="Settings sections">{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`service-tab-${index}`} aria-controls="service-settings-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
      if (next !== null) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`service-tab-${next}`)?.focus(); }
    }}>{name}</button>)}</div>
    <div id="service-settings-panel" role="tabpanel" aria-labelledby={`service-tab-${tabs.indexOf(tab)}`}>
    <p>URLs and account details are grouped with their credentials. Save settings for non-secret fields; each credential has its own secure Save button.</p>
    <form onSubmit={event => void save(event)} noValidate><fieldset disabled={busy}>
      <section hidden={tab !== "Station"}><h2>Station identity</h2><div className="service-fields">{[["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"]].map(([key, label]) => field(key, label))}</div></section>
      <section hidden={tab !== "Wavelog"}><h2>Wavelog synchronization</h2><p>The URL and station ID identify the online logbook; the API v2 token authorizes access. Synchronization is manual.</p><div className="service-fields">{field("wavelogURL", "Wavelog URL", "url")}{field("wavelogStationID", "Wavelog station ID", "number")}</div><Credential account="wavelog-token" label="Wavelog API v2 token" request={request} /></section>
      <section hidden={tab !== "QRZ"}><h2>QRZ callsign lookup</h2><p>Use your QRZ username and password for XML callsign lookup.</p><label className="service-enable"><input type="checkbox" checked={form.qrzEnabled === true} onChange={event => setForm(current => ({ ...current, qrzEnabled: event.target.checked }))} />Use QRZ XML lookup</label><div className="service-fields">{field("qrzUsername", "QRZ username")}</div><Credential account="qrz-password" label="QRZ password" request={request} /></section>
      <section hidden={tab !== "Reference data"}><h2>Club Log reference data</h2><p>This connection downloads CTY reference data using an API key. It is not a Club Log QSO uploader and does not use a separate account callsign.</p><div className="service-fields">{field("clubLogCTYURL", "Club Log CTY URL", "url")}</div><Credential account="clublog-api-key" label="Club Log API key" request={request} /></section>
      <section hidden={tab !== "Reference data"}><h2>LoTW activity reference</h2><p>This public reference feed does not require your LoTW password.</p><div className="service-fields">{field("lotwActivityURL", "LoTW activity URL", "url")}</div></section>
      <div className="live-actions" hidden={tab === "Backups"}><button type="submit" className="primary">{busy ? "Saving settings…" : "Save settings"}</button><span role="status">{message}</span></div>
    </fieldset></form>
    <div hidden={tab !== "Reference data" && tab !== "Backups"}>{dataRequest ? <DataManagementPanel onRequest={dataRequest} onChanged={onDataChanged ?? (() => {})} section={tab === "Backups" ? "backups" : "references"} sourceSettings={values} /> : <p>Reference and backup tools are unavailable in this view.</p>}</div>
    <p className="service-security-note">Credentials stay in the integrated app’s separate macOS Keychain service. Existing application credentials are not changed. Never paste credentials into a support chat.</p>
    </div>
  </section>;
}
