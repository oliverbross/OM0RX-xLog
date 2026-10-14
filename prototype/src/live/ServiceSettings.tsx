import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import DataManagementPanel from "./DataManagementPanel";
import DisplaySettings from "./DisplaySettings";
import { EquipmentSettings } from "./StationEquipment";
import CWSettings from "./CWSettings";
import { validateCWProfile, type CWContext } from "./cwMacros";
import type { CWState } from "./cwController";
import ReferenceScheduleControl from "./ReferenceScheduleControl";
import WSJTXPanel from "./WSJTXPanel";
import "./ServiceSettings.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
export type ServiceSettingsProps = { values: Data; savedValues?: Data; request: Request; onChanged: (value: Data) => void; onSave: (value: Data) => Promise<void>;
  saving?: boolean; pending?: boolean; conflict?: boolean; workspaceChanged?: boolean; dirty?: boolean; sessionError?: string;
  onReconcile?: () => Promise<void>; onRetry?: () => Promise<void>; onUseSaved?: () => void;
  dataRequest?: Request; onDataChanged?: () => void; rotorSettings?: ReactNode; workspaceSettings?: ReactNode; syncSettings?: ReactNode;
  onExternalContact?: () => void;
  availableTabs?: readonly Tab[]; requestedTab?: "Station" | "Wavelog" | "Sync"; requestedTabRevision?: number; cwContext?: CWContext; cwState?: CWState;
  refreshCW?: () => Promise<void>; cwProvider?: string };
const tabs = ["Station", "Wavelog", "Sync", "Integrations", "QRZ", "Reference data", "Rotator", "CW", "Display", "Workspace", "Backups"] as const;
type Tab = typeof tabs[number];

function Credential({ account, label, request, leadingField, visible = false, showSavedStatus = false, savedStatus, missingStatus, allowRemove = false, onChanged }: { account: string; label: string; request: Request; leadingField?: ReactNode; visible?: boolean; showSavedStatus?: boolean; savedStatus?: string; missingStatus?: string; allowRemove?: boolean; onChanged?: () => void }) {
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
      setValue(""); setStored("saved"); setMessage(`${label} saved securely.`); onChanged?.();
    } catch {
      setStored(current => current === "checking" ? "unavailable" : current);
      setMessage(`Could not save ${label}. Check the app’s Keychain access and try again.`);
    }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy || stored !== "saved") return;
    setBusy(true); setMessage(""); statusRevision.current++;
    try {
      await request("secret_save", { account, value: "" });
      setValue(""); setStored("missing"); setMessage(`${label} removed securely.`); onChanged?.();
    } catch { setMessage(`Could not remove ${label}. Check the app’s Keychain access and try again.`); }
    finally { setBusy(false); }
  };
  const status = stored === "saved" ? (savedStatus ?? "Saved securely. Not verified for this Wavelog URL and station ID.") : stored === "missing" ? (missingStatus ?? "No saved token. Enter your API v2 token.") : stored === "checking" ? "Checking saved credential…" : stored === "unavailable" ? "Saved credential status unavailable. Keychain access may need attention." : "";
  return <div className={`service-credential${leadingField ? " service-account-row" : ""}`}>{leadingField}<label>{label}<input type="password" aria-label={label} autoComplete="off" value={value} disabled={busy} maxLength={8192} placeholder={showSavedStatus && stored === "saved" ? "•••••••• — saved" : undefined}
    onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }} /></label>
    <button type="button" disabled={busy || !value} onClick={() => void save()}>{busy ? "Saving…" : `Save ${label}`}</button>
    {allowRemove && stored === "saved" && <button type="button" disabled={busy} onClick={() => void remove()}>{`Remove ${label}`}</button>}
    {message && <p role="status">{message}</p>}{showSavedStatus && status && <p className="service-credential-state" role="status">{status}</p>}</div>;
}

type OnlineLogStatus = { enabled: boolean; enabled_at?: string | null; pending_new_contacts: number;
  states: Record<string, number>; latest_state?: string | null; latest_attempt_at?: string | null; latest_error_code?: string | null };

function QRZUploadControl({ request, visible, refreshRevision }: { request: Request; visible: boolean; refreshRevision: number }) {
  const [status, setStatus] = useState<OnlineLogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let current = true; setBusy(true); setMessage("");
    void request("online_log_status").then(value => { if (current) setStatus(value as OnlineLogStatus); }, () => {
      if (current) setMessage("QRZ upload status is unavailable. No upload setting was changed.");
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [request, visible, refreshRevision, reloadRevision]);
  const configure = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const next = await request("online_log_configure", { enabled, confirm_new_contacts_only: enabled });
      setStatus(next as OnlineLogStatus); setConfirming(false); setConfirmed(false);
      setMessage(enabled ? "QRZ upload enabled for contacts logged from now on." : "QRZ upload disabled. Pending unsent contacts were cancelled.");
    } catch {
      setMessage(enabled ? "Could not enable QRZ upload. Save a valid Logbook API key and try again." : "Could not disable QRZ upload. No change was confirmed.");
    } finally { setBusy(false); }
  };
  const states = status?.states ?? {};
  const attention = (states.rejected ?? 0) + (states.uncertain ?? 0);
  return <div className="service-online-log" aria-label="QRZ Logbook upload">
    <label className="service-enable"><input type="checkbox" aria-describedby="qrz-upload-help" checked={status?.enabled === true}
      disabled={busy || !status} onChange={event => event.target.checked ? setConfirming(true) : void configure(false)} />Upload new contacts to QRZ Logbook</label>
    <p id="qrz-upload-help">Only contacts logged after you enable this are eligible. Existing contacts, imports, Wavelog pulls, confirmations and edits are never backfilled.</p>
    {confirming && status?.enabled !== true && <div className="service-settings-recovery" role="group" aria-label="Confirm QRZ upload enrollment">
      <p>This starts automatic, one-record INSERT uploads for future contacts. Ambiguous outcomes are held for review and never replayed automatically.</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand and want to enroll new contacts from now on</label>
      <button type="button" disabled={busy || !confirmed} onClick={() => void configure(true)}>Enable QRZ uploads</button>
      <button type="button" disabled={busy} onClick={() => { setConfirming(false); setConfirmed(false); }}>Cancel</button>
    </div>}
    {status && <p role="status">Upload is {status.enabled ? "ON" : "OFF"}. {status.pending_new_contacts ?? 0} new contacts pending; {states.delivered ?? 0} delivered; {states.deferred ?? 0} deferred; {attention} require review.</p>}
    {status?.latest_state && <p>Latest outcome: {status.latest_state.replace(/_/g, " ")}{status.latest_error_code ? ` (${status.latest_error_code.replace(/_/g, " ")})` : ""}.</p>}
    <button type="button" disabled={busy} onClick={() => { setStatus(null); setMessage(""); setReloadRevision(value => value + 1); }}>Refresh upload status</button>
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function ServiceSettings({ values, savedValues, request, onChanged, onSave, saving = false, pending = false,
  conflict = false, workspaceChanged = false, dirty = false, sessionError = "", onReconcile, onRetry, onUseSaved, dataRequest, onDataChanged,
  rotorSettings, workspaceSettings, syncSettings, onExternalContact, availableTabs, requestedTab, requestedTabRevision, cwContext, cwState, refreshCW, cwProvider }: ServiceSettingsProps) {
  const visibleTabs = useMemo(() => availableTabs?.filter((value, index, values) => tabs.includes(value) && values.indexOf(value) === index) ?? tabs, [availableTabs]);
  const initialTab = requestedTab && visibleTabs.includes(requestedTab) ? requestedTab : visibleTabs[0] ?? "Station";
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => { if (requestedTab && visibleTabs.includes(requestedTab)) setTab(requestedTab); }, [requestedTab, requestedTabRevision, visibleTabs]);
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] ?? "Station"); }, [tab, visibleTabs]);
  const form = values;
  const [message, setMessage] = useState("");
  const [qrzUploadRevision, setQRZUploadRevision] = useState(0);
  const blocked = pending || conflict || workspaceChanged;
  const update = (change: Partial<Data>) => {
    const next = { ...form, ...change };
    onChanged(next);
  };
  const field = (key: string, label: string, type = "text") => <label key={key}>{label}<input aria-label={label} type={type} value={form[key] ?? ""}
    min={key === "wavelogStationID" ? 1 : undefined} step={key === "wavelogStationID" ? 1 : undefined}
    onChange={event => update({ [key]: event.target.value })} /></label>;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (saving || blocked) return;
    setMessage("");
    try {
      const rawStationID = String(form.wavelogStationID ?? "");
      if (!/^\d+$/.test(rawStationID) || !Number.isSafeInteger(Number(rawStationID)) || Number(rawStationID) < 0 || Number(rawStationID) > 2_147_483_647)
        throw new Error("Wavelog station ID must be a whole number between 0 and 2147483647.");
      const saved = { ...form, wavelogStationID: Number(rawStationID), ...(form.cwProfile ? { cwProfile: validateCWProfile(form.cwProfile) } : {}) };
      await onSave(saved);
      setMessage("Settings saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save settings. Check the fields and try again."); }
  };
  return <section className="service-settings" aria-label="Station and service settings">
    <div className="service-tabs" role="tablist" aria-label="Settings sections">{visibleTabs.map((name, index) => <button key={name} type="button" role="tab" id={`service-tab-${tabs.indexOf(name)}`} aria-controls="service-settings-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % visibleTabs.length : event.key === "ArrowLeft" ? (index + visibleTabs.length - 1) % visibleTabs.length : null;
      if (next !== null) { event.preventDefault(); const selected = visibleTabs[next]; setTab(selected); document.getElementById(`service-tab-${tabs.indexOf(selected)}`)?.focus(); }
    }}>{name}</button>)}</div>
    <div id="service-settings-panel" role="tabpanel" aria-labelledby={`service-tab-${tabs.indexOf(tab)}`}>
    <p hidden={tab === "Display" || tab === "CW" || tab === "Workspace" || tab === "Sync" || tab === "Integrations"}>URLs and account details are grouped with their credentials. Save settings for non-secret fields; each credential has its own secure Save button.</p>
    {tab === "Sync" && <div>{syncSettings ?? <p>Synchronization tools are unavailable in this view.</p>}</div>}
    <div hidden={tab !== "Workspace"}>{workspaceSettings ?? <p>Workspace arrangements are unavailable in this view.</p>}</div>
    <div hidden={tab !== "Display"}><DisplaySettings /></div>
    <div hidden={tab !== "Rotator"}>{rotorSettings ?? <p>Rotator settings are unavailable in this view.</p>}</div>
    {tab === "Integrations" && <WSJTXPanel request={request} onImported={onExternalContact} />}
    <ReferenceScheduleControl request={request} visible={tab === "Reference data"} />
    {(sessionError || pending || conflict || workspaceChanged) && <div className="service-settings-recovery" role="status">
      {sessionError && <p>{sessionError}</p>}
      {pending && <><button type="button" disabled={saving} onClick={() => void onReconcile?.()}>Check saved Settings</button>
        <button type="button" disabled={saving} onClick={() => void onRetry?.()}>Retry same save</button></>}
      {!pending && (dirty || conflict || workspaceChanged) && <button type="button" disabled={saving} onClick={onUseSaved}>Use saved Settings</button>}
    </div>}
    <form onSubmit={event => void save(event)} noValidate><fieldset disabled={saving || blocked}>
      {visibleTabs.includes("CW") && <div hidden={tab !== "CW"}><CWSettings value={form.cwProfile} saved={(savedValues ?? form).cwProfile} onChange={cwProfile => update({ cwProfile })} context={cwContext} request={request} state={cwState} refresh={refreshCW} radioProvider={cwProvider} /></div>}
      <section hidden={tab !== "Station"}><h2>Station identity</h2><div className="service-fields">{[["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"]].map(([key, label]) => key === "defaultPower" ? <div key={key} className="service-default-power">{field(key, label)}
        <label className="service-enable"><input type="checkbox" aria-describedby="automatic-power-help" checked={form.automaticTransmitPower === true} disabled={typeof (savedValues ?? form).automaticTransmitPower !== "boolean"}
          onChange={event => update({ automaticTransmitPower: event.target.checked })} />Automatic measured power</label>
        <p id="automatic-power-help">{typeof (savedValues ?? form).automaticTransmitPower !== "boolean" ? "Automatic capture is unavailable in this version." : "Capture KPA500 measured output via the remote station. Default power is the fallback; a TX power edit sets a manual override."}</p>
      </div> : field(key, label))}</div></section>
      <div hidden={tab !== "Station"}><EquipmentSettings value={form.stationEquipment} onChange={stationEquipment => update({ stationEquipment })} /></div>
      <section hidden={tab !== "Station"}><h2>Draft behavior</h2>
        <label className="service-enable"><input type="checkbox" aria-describedby="clear-after-qsy-help" checked={form.clearAfterQSY === true} disabled={typeof (savedValues ?? form).clearAfterQSY !== "boolean"}
          onChange={event => update({ clearAfterQSY: event.target.checked })} />Clear unlogged QSO after QSY</label>
        <p id="clear-after-qsy-help">{typeof (savedValues ?? form).clearAfterQSY !== "boolean" ? "Clear after QSY is unavailable in this version." : "After a confirmed receive-frequency change, start a fresh draft at the observed receive frequency. Active edits, selections, commands and stale or reconnected radio observations veto the clear."}</p>
      </section>
      <section hidden={tab !== "Station"}><h2>Logbook mode</h2><label>Use xLog as<select aria-label="Logbook mode" value={form.logbookMode ?? "local"} onChange={event => update({ logbookMode: event.target.value })}>
        <option value="local">Standalone local logbook</option><option value="wavelog">Local logbook + Wavelog sync</option>
      </select></label><p>{(form.logbookMode ?? "local") === "local" ? "Contacts stay in this app. Wavelog synchronization and catalog checks are disabled; logging, awards, QRZ, cluster, radio and rotator remain available." : "Contacts are saved locally. Wavelog synchronization follows your Sync settings."} Save settings to apply. Switching modes keeps contacts, pending changes and saved credentials. Switching back to Wavelog leaves synchronization off until you explicitly synchronize or enable it in Sync. Wait for any running synchronization to finish before changing modes.</p></section>
      <section hidden={tab !== "Wavelog"}><h2>Wavelog synchronization</h2><p>The URL and station ID identify the online logbook; the API v2 token authorizes access. Configure synchronization in Sync.</p><div className="service-fields">{field("wavelogURL", "Wavelog URL", "url")}{field("wavelogStationID", "Wavelog station ID", "number")}</div><Credential account="wavelog-token" label="Wavelog API v2 token" request={request} visible={tab === "Wavelog"} showSavedStatus /></section>
      <section hidden={tab !== "QRZ"}><h2>QRZ callsign lookup</h2><p>Use your QRZ username and password for XML callsign lookup.</p><label className="service-enable"><input type="checkbox" checked={form.qrzEnabled === true} onChange={event => update({ qrzEnabled: event.target.checked })} />Use QRZ XML lookup</label><Credential account="qrz-password" label="QRZ password" request={request} leadingField={field("qrzUsername", "QRZ username")} />
        <h2>QRZ Logbook upload</h2><p>The Logbook API key is separate from your XML lookup password. Saving it securely does not enable uploads. Removing it also disables uploads and cancels pending unsent contacts.</p><Credential account="qrz-logbook-key" label="QRZ Logbook API key" request={request} visible={tab === "QRZ"} showSavedStatus allowRemove savedStatus="Saved securely. Use the enrollment control below." missingStatus="No saved QRZ Logbook API key." onChanged={() => setQRZUploadRevision(value => value + 1)} /><QRZUploadControl request={request} visible={tab === "QRZ"} refreshRevision={qrzUploadRevision} /></section>
      <section hidden={tab !== "Reference data"}><h2>Club Log reference data</h2><p>This connection downloads CTY reference data using an API key. It is not a Club Log QSO uploader and does not use a separate account callsign.</p><Credential account="clublog-api-key" label="Club Log API key" request={request} leadingField={field("clubLogCTYURL", "Club Log CTY URL", "url")} /></section>
      <section hidden={tab !== "Reference data"}><h2>LoTW activity reference</h2><p>This public reference feed does not require your LoTW password.</p><div className="service-fields">{field("lotwActivityURL", "LoTW activity URL", "url")}</div></section>
      <div className="live-actions" hidden={tab === "Backups" || tab === "Display" || tab === "Rotator" || tab === "Workspace" || tab === "Sync" || tab === "Integrations"}><button type="submit" className="primary">{saving ? "Saving settings…" : "Save settings"}</button><span role="status">{message}</span></div>
    </fieldset></form>
    {(visibleTabs.includes("Reference data") || visibleTabs.includes("Backups")) && <div hidden={tab !== "Reference data" && tab !== "Backups"}>{dataRequest ? <DataManagementPanel onRequest={dataRequest} onChanged={onDataChanged ?? (() => {})} visible={tab === "Reference data" || tab === "Backups"} section={tab === "Backups" ? "backups" : "references"} sourceSettings={savedValues ?? form} /> : <p>Reference and backup tools are unavailable in this view.</p>}</div>}
    <p className="service-security-note" hidden={tab === "CW" || tab === "Workspace" || tab === "Sync" || tab === "Integrations"}>Credentials stay in the integrated app’s separate macOS Keychain service. Existing application credentials are not changed. Never paste credentials into a support chat.</p>
    </div>
  </section>;
}
