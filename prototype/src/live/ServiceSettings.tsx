import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import DisplaySettings from "./DisplaySettings";
import { EquipmentSettings } from "./StationEquipment";
import CWSettings from "./CWSettings";
import { validateCWProfile, type CWContext } from "./cwMacros";
import type { CWState } from "./cwController";
import ReferenceScheduleControl from "./ReferenceScheduleControl";
import { useSettingsSaveToast } from "./SettingsSaveToast";
import "./ServiceSettings.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
const QRZLookupTest = lazy(() => import("./QRZLookupTest"));
const RadioSpotSettings = lazy(() => import("./RadioSpotSettings"));
const SpotBridgePanel = lazy(() => import("./SpotBridgePanel"));
const WSJTXPanel = lazy(() => import("./WSJTXPanel"));
const DataManagementPanel = lazy(() => import("./DataManagementPanel"));
export type ServiceSettingsProps = { values: Data; savedValues?: Data; request: Request; onChanged: (value: Data) => void; onSave: (value: Data) => Promise<void>;
  saving?: boolean; pending?: boolean; conflict?: boolean; workspaceChanged?: boolean; dirty?: boolean; sessionError?: string;
  onReconcile?: () => Promise<void>; onRetry?: () => Promise<void>; onUseSaved?: () => void;
  dataRequest?: Request; dataWorkspaceGeneration?: string; onDataChanged?: () => void; radioSettings?: ReactNode; rotorSettings?: ReactNode; clusterSettings?: ReactNode; workspaceSettings?: ReactNode; syncSettings?: ReactNode;
  onExternalContact?: () => void;
  availableTabs?: readonly Tab[]; requestedTab?: Tab; requestedTabRevision?: number; cwContext?: CWContext; cwState?: CWState;
  refreshCW?: () => Promise<void>; cwProvider?: string };
const tabs = ["Station", "Radio", "Logbook", "Wavelog", "Sync", "Integrations", "Radio spots", "Cluster", "QRZ", "Online logs", "Reference data", "Rotator", "CW", "Display", "Workspace", "Backups"] as const;
type Tab = typeof tabs[number];
const tabLabels: Partial<Record<Tab, string>> = { Station: "General", Integrations: "WSJT-X", QRZ: "Callsign lookup" };
const settingsGroups: { label: string; tabs: readonly Tab[] }[] = [
  { label: "Station", tabs: ["Station", "Radio", "Rotator", "CW"] },
  { label: "Logbook", tabs: ["Logbook", "Wavelog", "Sync"] },
  { label: "Connections", tabs: ["Integrations", "Radio spots", "Cluster"] },
  { label: "Services", tabs: ["QRZ", "Online logs", "Reference data"] },
  { label: "Application", tabs: ["Display", "Workspace", "Backups"] },
];

function Credential({ account, label, request, leadingField, visible = false, showSavedStatus = false, savedStatus, missingStatus, allowRemove = false, inputType = "password", onChanged }: { account: string; label: string; request: Request; leadingField?: ReactNode; visible?: boolean; showSavedStatus?: boolean; savedStatus?: string; missingStatus?: string; allowRemove?: boolean; inputType?: "password" | "text"; onChanged?: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const saveToast = useSettingsSaveToast();
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
    setBusy(true); statusRevision.current++;
    try {
      await request("secret_save", { account, value });
      setValue(""); setStored("saved"); saveToast.show(`${label} saved securely.`); onChanged?.();
    } catch {
      setStored(current => current === "checking" ? "unavailable" : current);
      saveToast.show(`Could not save ${label}. Check the app’s Keychain access and try again.`, "error");
    }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy || stored !== "saved") return;
    setBusy(true); statusRevision.current++;
    try {
      await request("secret_save", { account, value: "" });
      setValue(""); setStored("missing"); saveToast.show(`${label} removed securely.`); onChanged?.();
    } catch { saveToast.show(`Could not remove ${label}. Check the app’s Keychain access and try again.`, "error"); }
    finally { setBusy(false); }
  };
  const status = stored === "saved" ? (savedStatus ?? "Saved securely. Not verified for this Wavelog URL and station ID.") : stored === "missing" ? (missingStatus ?? "No saved token. Enter your API v2 token.") : stored === "checking" ? "Checking saved credential…" : stored === "unavailable" ? "Saved credential status unavailable. Keychain access may need attention." : "";
  return <div className={`service-credential${leadingField ? " service-account-row" : ""}`}>{leadingField}<label>{label}<input type={inputType} aria-label={label} autoComplete="off" value={value} disabled={busy} maxLength={8192} placeholder={showSavedStatus && stored === "saved" ? (inputType === "password" ? "•••••••• — saved" : "Saved securely") : undefined}
    onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }} /></label>
    <button type="button" disabled={busy || !value} onClick={() => void save()}>{busy ? "Saving…" : `Save ${label}`}</button>
    {allowRemove && stored === "saved" && <button type="button" disabled={busy} onClick={() => void remove()}>{`Remove ${label}`}</button>}
    {saveToast.toast}{showSavedStatus && status && <p className="service-credential-state" role="status">{status}</p>}</div>;
}

type OnlineLogStatus = { enabled: boolean; enabled_at?: string | null; pending_new_contacts: number;
  states: Record<string, number>; latest_state?: string | null; latest_attempt_at?: string | null; latest_error_code?: string | null;
  provider_issue_code?: string | null;
  generation?: string | null;
  attention?: Array<{ contact_id: string; contact_revision: number; current_revision: boolean; call: string; started_at: string;
    band: string; mode: string; state: "rejected" | "uncertain"; last_attempt_at: string; safe_error_code?: string | null;
    review_method: "logbook_follow_up"; available_actions: Array<"inspect" | "confirm_delivered"> }> };

function OnlineLogUploadControl({ request, visible, refreshRevision, service, provider }: { request: Request; visible: boolean; refreshRevision: number; service: "qrz" | "club_log"; provider: "QRZ" | "Club Log" }) {
  const [status, setStatus] = useState<OnlineLogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saveToast = useSettingsSaveToast();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reconcileKey, setReconcileKey] = useState("");
  const [reconcileConfirmed, setReconcileConfirmed] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let current = true; setBusy(true); setMessage("");
    void request("online_log_status", { service }).then(value => { if (current) setStatus(value as OnlineLogStatus); }, () => {
      if (current) setMessage(`${provider} upload status is unavailable. No upload setting was changed.`);
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [provider, request, service, visible, refreshRevision, reloadRevision]);
  const configure = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const next = await request("online_log_configure", { service, enabled, confirm_new_contacts_only: enabled });
      setStatus(next as OnlineLogStatus); setConfirming(false); setConfirmed(false);
      saveToast.show(enabled ? `${provider} upload enabled for contacts logged from now on.` : `${provider} upload disabled. Pending unsent contacts were cancelled.`);
    } catch {
      saveToast.show(enabled ? `Could not enable ${provider} upload. Save every required credential and try again.` : `Could not disable ${provider} upload. No change was confirmed.`, "error");
    } finally { setBusy(false); }
  };
  const states = status?.states ?? {};
  const attention = (states.rejected ?? 0) + (states.uncertain ?? 0);
  const helpID = `${service}-upload-help`;
  const reconcile = async (item: NonNullable<OnlineLogStatus["attention"]>[number]) => {
    if (busy || !status?.generation || !reconcileConfirmed) return;
    setBusy(true); setMessage("");
    try {
      const next = await request("online_log_reconcile", { service, contact_id: item.contact_id,
        contact_revision: item.contact_revision, generation: status.generation,
        action: "confirm_delivered", confirm_remote_state: true });
      setStatus(next as OnlineLogStatus); setReconcileKey(""); setReconcileConfirmed(false);
      saveToast.show(`${provider} outcome for ${item.call} reconciled as delivered.`);
    } catch {
      setMessage(`Could not reconcile ${item.call}. Refresh and review the current contact again.`);
    } finally { setBusy(false); }
  };
  return <div className="service-online-log" aria-label={`${provider} upload`}>
    <label className="service-enable"><input type="checkbox" aria-describedby={helpID} checked={status?.enabled === true}
      disabled={busy || !status} onChange={event => event.target.checked ? setConfirming(true) : void configure(false)} />Upload new contacts to {provider}</label>
    <p id={helpID}>Only contacts logged manually or received through WSJT-X Logged ADIF after you enable this are eligible. Existing contacts, file imports, Wavelog pulls, confirmations and edits are never backfilled.</p>
    {provider === "Club Log" && <p>Any known HTTP refusal immediately switches Club Log upload off and cancels its remaining queue, preventing repeated bad requests from triggering Club Log’s firewall.</p>}
    {confirming && status?.enabled !== true && <div className="service-settings-recovery" role="group" aria-label={`Confirm ${provider} upload enrollment`}>
      <p>This starts automatic, one-record INSERT uploads for future contacts. Ambiguous outcomes are held for review and never replayed automatically.</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand and want to enroll new contacts from now on</label>
      <button type="button" disabled={busy || !confirmed} onClick={() => void configure(true)}>Enable {provider} uploads</button>
      <button type="button" disabled={busy} onClick={() => { setConfirming(false); setConfirmed(false); }}>Cancel</button>
    </div>}
    {status && <p role="status">Upload is {status.enabled ? "ON" : "OFF"}. {status.pending_new_contacts ?? 0} new contacts pending; {states.delivered ?? 0} delivered; {states.deferred ?? 0} deferred; {attention} require review.</p>}
    {status?.latest_state && <p>Latest outcome: {status.latest_state.replace(/_/g, " ")}{status.latest_error_code ? ` (${status.latest_error_code.replace(/_/g, " ")})` : ""}.</p>}
    {status?.provider_issue_code && <p role="status">Provider setup needs attention: {status.provider_issue_code.replace(/_/g, " ")}.</p>}
    {(status?.attention?.length ?? 0) > 0 && <div className="service-settings-recovery" aria-label={`${provider} contacts requiring review`}>
      <p><strong>Contacts requiring review</strong></p>
      <p>These are historical outcomes. Verify each contact on {provider}; the app will not retry or change it automatically.</p>
      <ul>{status?.attention?.map(item => <li key={`${item.contact_id}:${item.contact_revision}`}>
        <strong>{item.call}</strong> · {item.started_at} · {item.band} {item.mode} · {item.state.replace(/_/g, " ")}
        {item.safe_error_code ? ` (${item.safe_error_code.replace(/_/g, " ")})` : ""}
        {!item.current_revision && " · contact edited since this attempt"}
        {item.available_actions.includes("confirm_delivered") && <>
          <button type="button" disabled={busy} onClick={() => { setReconcileKey(item.contact_id); setReconcileConfirmed(false); }}>
            Mark {item.call} verified delivered
          </button>
          {reconcileKey === item.contact_id && <div role="group" aria-label={`Confirm ${item.call} reconciliation`}>
            <p>Only continue after verifying this exact contact exists in {provider}. This records the outcome locally and sends no upload.</p>
            <label><input type="checkbox" checked={reconcileConfirmed} onChange={event => setReconcileConfirmed(event.target.checked)} />I verified this contact at {provider}</label>
            <button type="button" disabled={busy || !reconcileConfirmed} onClick={() => void reconcile(item)}>Confirm delivered</button>
            <button type="button" disabled={busy} onClick={() => { setReconcileKey(""); setReconcileConfirmed(false); }}>Cancel</button>
          </div>}
        </>}
      </li>)}</ul>
    </div>}
    <button type="button" disabled={busy} onClick={() => { setStatus(null); setMessage(""); setReloadRevision(value => value + 1); }}>Refresh upload status</button>
    {message && <p role="status">{message}</p>}{saveToast.toast}
  </div>;
}

export default function ServiceSettings({ values, savedValues, request, onChanged, onSave, saving = false, pending = false,
  conflict = false, workspaceChanged = false, dirty = false, sessionError = "", onReconcile, onRetry, onUseSaved, dataRequest, dataWorkspaceGeneration, onDataChanged,
  radioSettings, rotorSettings, clusterSettings, workspaceSettings, syncSettings, onExternalContact, availableTabs, requestedTab, requestedTabRevision, cwContext, cwState, refreshCW, cwProvider }: ServiceSettingsProps) {
  const visibleTabs = useMemo(() => availableTabs?.filter((value, index, values) => tabs.includes(value) && values.indexOf(value) === index) ?? tabs, [availableTabs]);
  const initialTab = requestedTab && visibleTabs.includes(requestedTab) ? requestedTab : visibleTabs[0] ?? "Station";
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => { if (requestedTab && visibleTabs.includes(requestedTab)) setTab(requestedTab); }, [requestedTab, requestedTabRevision, visibleTabs]);
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] ?? "Station"); }, [tab, visibleTabs]);
  const showAccountHelp = ["Station", "Wavelog", "QRZ", "Reference data", "Rotator", "Backups"].includes(tab);
  const showFormSave = ["Station", "Logbook", "Wavelog", "QRZ", "Reference data", "CW"].includes(tab);
  const form = values;
  const lookupProvider = form.qrzEnabled === true ? String(form.callsignLookupProvider ?? "qrz") : "disabled";
  const savedForm = savedValues ?? form;
  const savedLookupProvider = savedForm.qrzEnabled === true ? String(savedForm.callsignLookupProvider ?? "qrz") : "disabled";
  const lookupConfigurationApplied = lookupProvider === savedLookupProvider &&
    (lookupProvider !== "qrz" || String(form.qrzUsername ?? "") === String(savedForm.qrzUsername ?? "")) &&
    (lookupProvider !== "hamqth" || String(form.hamqthUsername ?? "") === String(savedForm.hamqthUsername ?? ""));
  const ftpBackup = { protocol: "disabled", endpoint: "", directory: "/OM0RX-xLog", username: "", plainFTPConfirmed: false,
    ...(form.ftpBackup ?? {}) };
  const saveToast = useSettingsSaveToast();
  const [onlineLogRevision, setOnlineLogRevision] = useState(0);
  const blocked = pending || conflict || workspaceChanged;
  const update = (change: Partial<Data>) => {
    const next = { ...form, ...change };
    onChanged(next);
  };
  const updateFTPBackup = (change: Partial<Data>) => update({ ftpBackup: { ...ftpBackup, ...change } });
  const field = (key: string, label: string, type = "text") => <label key={key}>{label}<input aria-label={label} type={type} value={form[key] ?? ""}
    min={key === "wavelogStationID" ? 1 : undefined} step={key === "wavelogStationID" ? 1 : undefined}
    onChange={event => update({ [key]: event.target.value })} /></label>;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (saving || blocked) return;
    try {
      const rawStationID = String(form.wavelogStationID ?? "");
      if (!/^\d+$/.test(rawStationID) || !Number.isSafeInteger(Number(rawStationID)) || Number(rawStationID) < 0 || Number(rawStationID) > 2_147_483_647)
        throw new Error("Wavelog station ID must be a whole number between 0 and 2147483647.");
      const saved = { ...form, wavelogStationID: Number(rawStationID), ...(form.cwProfile ? { cwProfile: validateCWProfile(form.cwProfile) } : {}) };
      await onSave(saved);
      saveToast.show(tab === "Backups" ? "Backup settings saved" : "Settings saved");
    } catch (error) { saveToast.show(error instanceof Error ? error.message : "Could not save settings. Check the fields and try again.", "error"); }
  };
  return <section className="service-settings" aria-label="Station and service settings">
    <nav className="service-tabs" aria-label="Settings sections"><div role="tablist" aria-orientation="vertical">{settingsGroups.map(group => {
      const groupTabs = group.tabs.filter(name => visibleTabs.includes(name));
      return groupTabs.length ? <div className="service-tab-group" key={group.label} role="presentation"><span>{group.label}</span>{groupTabs.map(name => {
        const index = visibleTabs.indexOf(name);
        return <button key={name} type="button" role="tab" id={`service-tab-${tabs.indexOf(name)}`} aria-controls="service-settings-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % visibleTabs.length : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index + visibleTabs.length - 1) % visibleTabs.length : null;
          if (next !== null) { event.preventDefault(); const selected = visibleTabs[next]; setTab(selected); document.getElementById(`service-tab-${tabs.indexOf(selected)}`)?.focus(); }
        }}>{tabLabels[name] ?? name}</button>;
      })}</div> : null;
    })}</div></nav>
    <div className="service-settings-content"><div id="service-settings-panel" role="tabpanel" aria-labelledby={`service-tab-${tabs.indexOf(tab)}`}>
    <p hidden={!showAccountHelp}>URLs and account details are grouped with their credentials. Save settings for non-secret fields; each credential has its own secure Save button.</p>
    {tab === "Sync" && <div>{syncSettings ?? <p>Synchronization tools are unavailable in this view.</p>}</div>}
    <div hidden={tab !== "Workspace"}>{workspaceSettings ?? <p>Workspace arrangements are unavailable in this view.</p>}</div>
    <div hidden={tab !== "Display"}><DisplaySettings /></div>
    <div hidden={tab !== "Radio"}>{radioSettings ?? <p>Radio setup is available in the main Settings window.</p>}</div>
    <div hidden={tab !== "Rotator"}>{rotorSettings ?? <p>Rotator settings are unavailable in this view.</p>}</div>
    {tab === "Cluster" && (clusterSettings ?? <p>Cluster settings unavailable.</p>)}
    {tab === "Radio spots" && <Suspense fallback={<p role="status">Loading radio spot settings…</p>}>
      <RadioSpotSettings request={request} visible />
      <SpotBridgePanel request={request} configurationOnly />
    </Suspense>}
    {tab === "Integrations" && <Suspense fallback={<p role="status">Loading WSJT-X settings…</p>}><WSJTXPanel request={request} onImported={onExternalContact} /></Suspense>}
    <ReferenceScheduleControl request={request} visible={tab === "Reference data"} />
    {(sessionError || pending || conflict || workspaceChanged) && <div className="service-settings-recovery" role="status">
      {sessionError && <p>{sessionError}</p>}
      {pending && <><button type="button" disabled={saving} onClick={() => void onReconcile?.()}>Check saved Settings</button>
        <button type="button" disabled={saving} onClick={() => void onRetry?.()}>Retry same save</button></>}
      {!pending && (dirty || conflict || workspaceChanged) && <button type="button" disabled={saving} onClick={onUseSaved}>Use saved Settings</button>}
    </div>}
    <form onSubmit={event => void save(event)} noValidate><fieldset disabled={saving || blocked}>
      {visibleTabs.includes("CW") && <div hidden={tab !== "CW"}><CWSettings value={form.cwProfile} saved={(savedValues ?? form).cwProfile} onChange={cwProfile => update({ cwProfile })} context={cwContext} request={request} state={cwState} refresh={refreshCW} radioProvider={cwProvider} /></div>}
      <section hidden={tab !== "Station"}><h2>Station identity</h2><div className="service-fields service-station-identity-fields">{[["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"]].map(([key, label]) => key === "defaultPower" ? <div key={key} className="service-default-power">{field(key, label)}
        <label className="service-enable"><input type="checkbox" aria-describedby="automatic-power-help" checked={form.automaticTransmitPower === true} disabled={typeof (savedValues ?? form).automaticTransmitPower !== "boolean"}
          onChange={event => update({ automaticTransmitPower: event.target.checked })} />Automatic measured power</label>
        <p id="automatic-power-help">{typeof (savedValues ?? form).automaticTransmitPower !== "boolean" ? "Automatic capture is unavailable in this version." : "Capture measured output from the active radio or amplifier when its provider reports a trustworthy watt reading. Default power is the fallback; a TX power edit sets a manual override."}</p>
      </div> : field(key, label))}</div></section>
      <div hidden={tab !== "Station"}><EquipmentSettings value={form.stationEquipment} onChange={stationEquipment => update({ stationEquipment })} /></div>
      <section hidden={tab !== "Station"}><h2>Draft behavior</h2>
        <label className="service-enable"><input type="checkbox" aria-describedby="clear-after-qsy-help" checked={form.clearAfterQSY === true} disabled={typeof (savedValues ?? form).clearAfterQSY !== "boolean"}
          onChange={event => update({ clearAfterQSY: event.target.checked })} />Clear unlogged QSO after QSY</label>
        <p id="clear-after-qsy-help">{typeof (savedValues ?? form).clearAfterQSY !== "boolean" ? "Clear after QSY is unavailable in this version." : "After a confirmed receive-frequency change, start a fresh draft at the observed receive frequency. Active edits, selections, commands and stale or reconnected radio observations veto the clear."}</p>
      </section>
      <section hidden={tab !== "Logbook"} className="service-logbook-mode"><h2>Integrated logbook</h2>
        <p>Every contact is stored in xLog’s integrated local database. Wavelog is an optional synchronization destination, not a replacement for the local logbook.</p>
        <label>Logbook mode<select aria-label="Logbook mode" value={form.logbookMode ?? "local"} onChange={event => update({ logbookMode: event.target.value })}>
          <option value="local">Integrated logbook only</option><option value="wavelog">Integrated logbook + Wavelog synchronization</option>
        </select></label>
        <p role="status"><strong>Selected mode (save to apply): {(form.logbookMode ?? "local") === "local" ? "Integrated only" : "Integrated + Wavelog"}</strong> · {(form.logbookMode ?? "local") === "local" ? "Wavelog synchronization and catalog checks are disabled; logging, awards, QRZ, cluster, radio and rotator remain available." : "Contacts are saved locally first. Wavelog synchronization follows your Sync settings."}</p>
        <p>Save settings to apply. Switching modes keeps contacts, pending changes and saved credentials. Switching back to Wavelog leaves synchronization off until you explicitly synchronize or enable it in Sync. Wait for any running synchronization to finish before changing modes.</p>
      </section>
      <section hidden={tab !== "Wavelog"}><h2>Wavelog synchronization</h2><p>The URL and station ID identify the online logbook; the API v2 token authorizes access. Configure synchronization in Sync.</p><div className="service-fields">{field("wavelogURL", "Wavelog URL", "url")}{field("wavelogStationID", "Wavelog station ID", "number")}</div><Credential account="wavelog-token" label="Wavelog API v2 token" request={request} visible={tab === "Wavelog"} showSavedStatus /></section>
      <section hidden={tab !== "QRZ"}><h2>Callsign lookup</h2><p>Select the online callsign service used by normal logging and the contest details window. Offline CTY data remains available when online lookup is disabled or unavailable.</p>
        <label>Lookup provider<select aria-label="Lookup provider" value={lookupProvider} onChange={event => update(event.target.value === "disabled"
          ? { qrzEnabled: false } : { qrzEnabled: true, callsignLookupProvider: event.target.value })}>
          <option value="disabled">Offline CTY only</option><option value="qrz">QRZ XML</option><option value="hamqth">HamQTH</option>
        </select></label>
        {lookupProvider === "qrz" && <Credential account="qrz-password" label="QRZ password" request={request} leadingField={field("qrzUsername", "QRZ username")}
          visible={tab === "QRZ"} showSavedStatus allowRemove savedStatus="QRZ password saved securely." missingStatus="No saved QRZ password." />}
        {lookupProvider === "hamqth" && <Credential account="hamqth-password" label="HamQTH password" request={request} leadingField={field("hamqthUsername", "HamQTH username")}
          visible={tab === "QRZ"} showSavedStatus allowRemove savedStatus="HamQTH password saved securely." missingStatus="No saved HamQTH password." />}
        {lookupProvider !== "disabled" && <Suspense fallback={<p role="status">Loading callsign lookup test…</p>}><QRZLookupTest request={request}
          provider={lookupProvider === "hamqth" ? "HamQTH" : "QRZ"} applied={lookupConfigurationApplied}
          defaultCall={String(form.operatorCall || (lookupProvider === "hamqth" ? form.hamqthUsername : form.qrzUsername) || "")} /></Suspense>}
      </section>
      <section hidden={tab !== "Online logs"}><h2>QRZ Logbook upload</h2><p>The Logbook API key is separate from your XML lookup password. Saving it securely does not enable uploads. Removing it also disables uploads and cancels pending unsent contacts.</p><Credential account="qrz-logbook-key" label="QRZ Logbook API key" request={request} visible={tab === "Online logs"} showSavedStatus allowRemove savedStatus="Saved securely. Use the enrollment control below." missingStatus="No saved QRZ Logbook API key." onChanged={() => setOnlineLogRevision(value => value + 1)} /><OnlineLogUploadControl request={request} visible={tab === "Online logs"} refreshRevision={onlineLogRevision} service="qrz" provider="QRZ" />
        <h2>Club Log real-time upload</h2><p>Use your Club Log account email, an Application Password and the callsign owned by that account. The Club Log API key is shared with the CTY download in Reference data. Saving credentials never enables uploads.</p>
        <Credential account="clublog-email" label="Club Log account email" inputType="text" request={request} visible={tab === "Online logs"} showSavedStatus allowRemove savedStatus="Saved securely." missingStatus="No saved Club Log account email." onChanged={() => setOnlineLogRevision(value => value + 1)} />
        <Credential account="clublog-application-password" label="Club Log Application Password" request={request} visible={tab === "Online logs"} showSavedStatus allowRemove savedStatus="Saved securely." missingStatus="No saved Club Log Application Password." onChanged={() => setOnlineLogRevision(value => value + 1)} />
        <Credential account="clublog-callsign" label="Club Log callsign" inputType="text" request={request} visible={tab === "Online logs"} showSavedStatus allowRemove savedStatus="Saved securely." missingStatus="No saved Club Log callsign." onChanged={() => setOnlineLogRevision(value => value + 1)} />
        <OnlineLogUploadControl request={request} visible={tab === "Online logs"} refreshRevision={onlineLogRevision} service="club_log" provider="Club Log" /></section>
      <section hidden={tab !== "Reference data"}><h2>Club Log reference data</h2><p>The API key authorizes CTY downloads and can also support the separately enrolled real-time uploader. Saving it here never enables uploads; removing it disables Club Log uploads and cancels their pending queue.</p><Credential account="clublog-api-key" label="Club Log API key" request={request} leadingField={field("clubLogCTYURL", "Club Log CTY URL", "url")} visible={tab === "Reference data"} showSavedStatus allowRemove savedStatus="Saved securely for Club Log services." missingStatus="No saved Club Log API key." onChanged={() => setOnlineLogRevision(value => value + 1)} /></section>
      <section hidden={tab !== "Reference data"}><h2>LoTW activity reference</h2><p>This public reference feed does not require your LoTW password.</p><div className="service-fields">{field("lotwActivityURL", "LoTW activity URL", "url")}</div></section>
      <section hidden={tab !== "Backups"}><h2>FTP / FTPS remote backup</h2>
        <p>Optional remote backup uses plain FTP only with explicit insecure consent, or implicit FTPS with certificate and hostname validation. SFTP is not available until a separately host-key-pinned transport is implemented.</p>
        <div className="service-fields">
          <label>Remote backup protocol<select aria-label="Remote backup protocol" value={ftpBackup.protocol}
            onChange={event => updateFTPBackup({ protocol: event.target.value,
              plainFTPConfirmed: event.target.value === "ftp" ? ftpBackup.plainFTPConfirmed : false })}>
            <option value="disabled">Disabled</option><option value="ftps">Implicit FTPS</option><option value="ftp">Plain FTP</option>
          </select></label>
          <label>FTP server endpoint<input aria-label="FTP server endpoint" type="url" value={ftpBackup.endpoint} maxLength={2048}
            placeholder={ftpBackup.protocol === "ftps" ? "ftps://backup.example.net:990" : "ftp://backup.example.net:21"}
            onChange={event => updateFTPBackup({ endpoint: event.target.value })} /></label>
          <label>Remote directory<input aria-label="Remote directory" value={ftpBackup.directory} maxLength={4096}
            onChange={event => updateFTPBackup({ directory: event.target.value })} /></label>
          <label>FTP username<input aria-label="FTP username" autoComplete="off" value={ftpBackup.username} maxLength={512}
            onChange={event => updateFTPBackup({ username: event.target.value })} /></label>
        </div>
        {ftpBackup.protocol === "ftp" && <label className="service-enable"><input type="checkbox" checked={ftpBackup.plainFTPConfirmed === true}
          onChange={event => updateFTPBackup({ plainFTPConfirmed: event.target.checked })} />I understand plain FTP sends the username, password and backup without encryption.</label>}
        <Credential account="ftp-backup-password" label="FTP / FTPS password" request={request} visible={tab === "Backups"}
          showSavedStatus allowRemove savedStatus="Saved securely. It has not been sent to the server."
          missingStatus="No saved FTP / FTPS password." />
        <div className="live-actions"><button type="submit" className="primary">{saving ? "Saving settings…" : "Save backup settings"}</button></div>
      </section>
      <div className="live-actions" hidden={!showFormSave}><button type="submit" className="primary">{saving ? "Saving settings…" : "Save settings"}</button></div>
    </fieldset></form>
    {(visibleTabs.includes("Reference data") || visibleTabs.includes("Backups")) && <div hidden={tab !== "Reference data" && tab !== "Backups"}>{dataRequest ? <Suspense fallback={<p>Loading data tools…</p>}><DataManagementPanel onRequest={dataRequest} onChanged={onDataChanged ?? (() => {})} workspaceGeneration={dataWorkspaceGeneration} visible={tab === "Reference data" || tab === "Backups"} section={tab === "Backups" ? "backups" : "references"} sourceSettings={savedValues ?? form} /></Suspense> : <p>Reference and backup tools are unavailable in this view.</p>}</div>}
    <p className="service-security-note" hidden={!showAccountHelp && tab !== "Online logs" && tab !== "Display"}>Credentials stay in the integrated app’s separate macOS Keychain service. Existing application credentials are not changed. Never paste credentials into a support chat.</p>
    {saveToast.toast}
    </div></div>
  </section>;
}
