import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import DataManagementPanel from "./DataManagementPanel";
import DisplaySettings from "./DisplaySettings";
import { EquipmentSettings } from "./StationEquipment";
import CWSettings from "./CWSettings";
import { validateCWProfile, type CWContext } from "./cwMacros";
import type { CWState } from "./cwController";
import ReferenceScheduleControl from "./ReferenceScheduleControl";
import "./ServiceSettings.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Props = { values: Data; request: Request; onSaved: (value: Data) => void; dataRequest?: Request; onDataChanged?: () => void; rotorSettings?: ReactNode; workspaceSettings?: ReactNode; syncSettings?: ReactNode; requestedTab?: "Station" | "Wavelog" | "Sync"; requestedTabRevision?: number; cwContext?: CWContext; cwState?: CWState; refreshCW?: () => Promise<void>; cwProvider?: string };
const tabs = ["Station", "Wavelog", "Sync", "QRZ", "Reference data", "Rotator", "CW", "Display", "Workspace", "Backups"] as const;
type Tab = typeof tabs[number];

function Credential({ account, label, request, leadingField, visible = false, showSavedStatus = false }: { account: string; label: string; request: Request; leadingField?: ReactNode; visible?: boolean; showSavedStatus?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [stored, setStored] = useState<"unchecked" | "checking" | "saved" | "missing" | "unavailable">("unchecked");
  const checked = useRef(false);
  const statusRevision = useRef(0);
  useEffect(() => {
    // Presence metadata is read once on first display, never the saved secret.
    // Merely mounting Settings or changing tabs does not repeatedly read Keychain.
    if (!showSavedStatus || !visible || checked.current) return;
    checked.current = true;
    const revision = statusRevision.current;
    setStored("checking");
    void request("secret_status").then(response => {
      if (revision !== statusRevision.current) return;
      setStored(response[account] === true ? "saved" : response[account] === false ? "missing" : "unavailable");
    }, () => { if (revision === statusRevision.current) setStored("unavailable"); });
  }, [account, request, showSavedStatus, visible]);
  const save = async () => {
    if (busy || !value) return;
    setBusy(true); setMessage(""); statusRevision.current++;
    try {
      await request("secret_save", { account, value });
      setValue(""); setStored("saved"); setMessage(`${label} saved securely.`);
    } catch {
      setStored(current => current === "checking" ? "unavailable" : current);
      setMessage(`Could not save ${label}. Check the app’s Keychain access and try again.`);
    }
    finally { setBusy(false); }
  };
  const status = stored === "saved" ? "Saved securely. Not verified for this Wavelog URL and station ID." : stored === "missing" ? "No saved token. Enter your API v2 token." : stored === "checking" ? "Checking saved token…" : stored === "unavailable" ? "Saved token status unavailable. Keychain access may need attention." : "";
  return <div className={`service-credential${leadingField ? " service-account-row" : ""}`}>{leadingField}<label>{label}<input type="password" aria-label={label} autoComplete="off" value={value} disabled={busy} maxLength={8192} placeholder={showSavedStatus && stored === "saved" ? "•••••••• — saved" : undefined}
    onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }} /></label>
    <button type="button" disabled={busy || !value} onClick={() => void save()}>{busy ? "Saving…" : `Save ${label}`}</button>
    {message && <p role="status">{message}</p>}{showSavedStatus && status && <p className="service-credential-state" role="status">{status}</p>}</div>;
}

export default function ServiceSettings({ values, request, onSaved, dataRequest, onDataChanged, rotorSettings, workspaceSettings, syncSettings, requestedTab, requestedTabRevision, cwContext, cwState, refreshCW, cwProvider }: Props) {
  const [tab, setTab] = useState<Tab>(requestedTab ?? "Station");
  useEffect(() => { if (requestedTab) setTab(requestedTab); }, [requestedTab, requestedTabRevision]);
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
      const saved = { ...form, ...(form.cwProfile ? { cwProfile: validateCWProfile(form.cwProfile) } : {}) };
      const response = await request("settings_save", { settings: saved });
      onSaved(response.settings); setForm(response.settings);
      setMessage("Settings saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save settings. Check the fields and try again."); }
    finally { setBusy(false); }
  };
  return <section className="service-settings" aria-label="Station and service settings">
    <div className="service-tabs" role="tablist" aria-label="Settings sections">{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`service-tab-${index}`} aria-controls="service-settings-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
      if (next !== null) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`service-tab-${next}`)?.focus(); }
    }}>{name}</button>)}</div>
    <div id="service-settings-panel" role="tabpanel" aria-labelledby={`service-tab-${tabs.indexOf(tab)}`}>
    <p hidden={tab === "Display" || tab === "CW" || tab === "Workspace" || tab === "Sync"}>URLs and account details are grouped with their credentials. Save settings for non-secret fields; each credential has its own secure Save button.</p>
    {tab === "Sync" && <div>{syncSettings ?? <p>Synchronization tools are unavailable in this view.</p>}</div>}
    <div hidden={tab !== "Workspace"}>{workspaceSettings ?? <p>Workspace arrangements are unavailable in this view.</p>}</div>
    <div hidden={tab !== "Display"}><DisplaySettings /></div>
    <div hidden={tab !== "Rotator"}>{rotorSettings ?? <p>Rotator settings are unavailable in this view.</p>}</div>
    <ReferenceScheduleControl request={request} visible={tab === "Reference data"} />
    <form onSubmit={event => void save(event)} noValidate><fieldset disabled={busy}>
      <div hidden={tab !== "CW"}><CWSettings value={form.cwProfile} saved={values.cwProfile} onChange={cwProfile => setForm(current => ({ ...current, cwProfile }))} context={cwContext} request={request} state={cwState} refresh={refreshCW} radioProvider={cwProvider} /></div>
      <section hidden={tab !== "Station"}><h2>Station identity</h2><div className="service-fields">{[["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"]].map(([key, label]) => key === "defaultPower" ? <div key={key} className="service-default-power">{field(key, label)}
        <label className="service-enable"><input type="checkbox" aria-describedby="automatic-power-help" checked={form.automaticTransmitPower === true} disabled={typeof values.automaticTransmitPower !== "boolean"}
          onChange={event => setForm(current => ({ ...current, automaticTransmitPower: event.target.checked }))} />Automatic measured power</label>
        <p id="automatic-power-help">{typeof values.automaticTransmitPower !== "boolean" ? "Automatic capture is unavailable in this version." : "Capture KPA500 measured output via the remote station. Default power is the fallback; a TX power edit sets a manual override."}</p>
      </div> : field(key, label))}</div></section>
      <div hidden={tab !== "Station"}><EquipmentSettings value={form.stationEquipment} onChange={stationEquipment => setForm(current => ({ ...current, stationEquipment }))} /></div>
      <section hidden={tab !== "Station"}><h2>Logbook mode</h2><label>Use xLog as<select aria-label="Logbook mode" value={form.logbookMode ?? "wavelog"} onChange={event => setForm(current => ({ ...current, logbookMode: event.target.value }))}>
        <option value="local">Standalone local logbook</option><option value="wavelog">Local logbook + Wavelog sync</option>
      </select></label><p>{form.logbookMode === "local" ? "Contacts stay in this app. Wavelog synchronization and catalog checks are disabled; logging, awards, QRZ, cluster, radio and rotator remain available." : "Contacts are saved locally. Wavelog synchronization follows your Sync settings."} Save settings to apply. Switching modes keeps contacts, pending changes and saved credentials.</p></section>
      <section hidden={tab !== "Wavelog"}><h2>Wavelog synchronization</h2><p>The URL and station ID identify the online logbook; the API v2 token authorizes access. Configure synchronization in Sync.</p><div className="service-fields">{field("wavelogURL", "Wavelog URL", "url")}{field("wavelogStationID", "Wavelog station ID", "number")}</div><Credential account="wavelog-token" label="Wavelog API v2 token" request={request} visible={tab === "Wavelog"} showSavedStatus /></section>
      <section hidden={tab !== "QRZ"}><h2>QRZ callsign lookup</h2><p>Use your QRZ username and password for XML callsign lookup.</p><label className="service-enable"><input type="checkbox" checked={form.qrzEnabled === true} onChange={event => setForm(current => ({ ...current, qrzEnabled: event.target.checked }))} />Use QRZ XML lookup</label><Credential account="qrz-password" label="QRZ password" request={request} leadingField={field("qrzUsername", "QRZ username")} /></section>
      <section hidden={tab !== "Reference data"}><h2>Club Log reference data</h2><p>This connection downloads CTY reference data using an API key. It is not a Club Log QSO uploader and does not use a separate account callsign.</p><Credential account="clublog-api-key" label="Club Log API key" request={request} leadingField={field("clubLogCTYURL", "Club Log CTY URL", "url")} /></section>
      <section hidden={tab !== "Reference data"}><h2>LoTW activity reference</h2><p>This public reference feed does not require your LoTW password.</p><div className="service-fields">{field("lotwActivityURL", "LoTW activity URL", "url")}</div></section>
      <div className="live-actions" hidden={tab === "Backups" || tab === "Display" || tab === "Rotator" || tab === "Workspace" || tab === "Sync"}><button type="submit" className="primary">{busy ? "Saving settings…" : "Save settings"}</button><span role="status">{message}</span></div>
    </fieldset></form>
    <div hidden={tab !== "Reference data" && tab !== "Backups"}>{dataRequest ? <DataManagementPanel onRequest={dataRequest} onChanged={onDataChanged ?? (() => {})} visible={tab === "Reference data" || tab === "Backups"} section={tab === "Backups" ? "backups" : "references"} sourceSettings={values} /> : <p>Reference and backup tools are unavailable in this view.</p>}</div>
    <p className="service-security-note" hidden={tab === "CW" || tab === "Workspace" || tab === "Sync"}>Credentials stay in the integrated app’s separate macOS Keychain service. Existing application credentials are not changed. Never paste credentials into a support chat.</p>
    </div>
  </section>;
}
