import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import ServiceSettings from "./ServiceSettings";
import SyncPanel from "./SyncPanel";
import WorkspaceSettings from "./WorkspaceSettings";
import { readSettingsJournal, SettingsSession, settingsDraftIsDirty } from "./settingsSession";
import { connectSettingsChanges, requestSettings } from "./settingsTransport";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { clearLegacyRotorConfiguration, legacyRotorConfiguration, readRotorConfigurationJournal,
  RotorConfigurationSession, rotorConfigurationDirty } from "./rotorConfigurationSession";
import { connectRotorConfigurationChanges } from "./rotorConfigurationTransport";

const journalKey = "xlog.integration.settings.detached.v1";
const rotorJournalKey = "xlog.integration.rotorConfiguration.detached.v1";
const RotorPanel = lazy(() => import("./RotorPanel"));
const availableTabs = ["Station", "Wavelog", "Sync", "Integrations", "QRZ", "Online logs", "Reference data", "Rotator", "Display", "Workspace", "Backups"] as const;
export const detachedSettingsMethods = [
  "settings_load", "settings_receipt", "settings_save", "secret_status", "secret_save",
  "online_log_status", "online_log_configure",
  "workspace_rotor_configuration_load", "workspace_rotor_configuration_receipt", "workspace_rotor_configuration_save", "hamlib_models",
  "sync_status", "sync_summary", "sync_mutation", "sync_receipt",
  "reference_status", "reference_resolve", "reference_refresh", "reference_schedule", "reference_configure",
  "backup_create", "backup_list", "backup_inspect", "backup_import", "backup_restore",
  "remote_backup_request",
  "wsjtx_snapshot", "wsjtx_configure", "wsjtx_start", "wsjtx_stop",
] as const;

function storedJournal() {
  try { return readSettingsJournal(localStorage.getItem(journalKey)); } catch { return null; }
}
function storedRotorJournal() {
  try { return readRotorConfigurationJournal(localStorage.getItem(rotorJournalKey)); } catch { return null; }
}

export async function requestDetachedSettings(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!detachedSettingsMethods.includes(method as typeof detachedSettingsMethods[number]))
    throw new Error("This operation is unavailable in the Settings window.");
  return requestSettings(method, params);
}

export function DetachedSettingsSurface() {
  const [message, setMessage] = useState("");
  const [settingsSession] = useState(() => new SettingsSession(requestDetachedSettings,
    journal => journal ? localStorage.setItem(journalKey, JSON.stringify(journal)) : localStorage.removeItem(journalKey), storedJournal()));
  const state = useSyncExternalStore(settingsSession.subscribe, settingsSession.getSnapshot);
  const [rotorSession] = useState(() => new RotorConfigurationSession(requestDetachedSettings,
    journal => journal ? localStorage.setItem(rotorJournalKey, JSON.stringify(journal)) : localStorage.removeItem(rotorJournalKey),
    storedRotorJournal()));
  const rotorState = useSyncExternalStore(rotorSession.subscribe, rotorSession.getSnapshot);
  const layout = useWorkspaceLayout(true);
  const settingsDirty = settingsDraftIsDirty(state.base, state.draft);
  const rotorDirty = rotorConfigurationDirty(rotorState.base, rotorState.draft);
  const dirty = settingsDirty || rotorDirty;
  const reload = useCallback(() => {
    void Promise.all([settingsSession.load(), rotorSession.load(legacyRotorConfiguration(localStorage))])
      .then(() => clearLegacyRotorConfiguration(localStorage))
      .catch(cause => setMessage(cause instanceof Error ? cause.message : "Settings could not be loaded."));
  }, [settingsSession, rotorSession]);
  useEffect(() => { reload(); return connectSettingsChanges(reload, setMessage); }, [reload]);
  useEffect(() => connectRotorConfigurationChanges(() => { void rotorSession.load(); }, setMessage), [rotorSession]);
  const recover = (action: () => Promise<void> | void, fallback: string) => Promise.resolve().then(action)
    .catch(cause => setMessage(cause instanceof Error ? cause.message : fallback));

  return <div className="app live monitor-app detached-settings-app"><main aria-label="Detached Settings">
    {message && <p className="live-error" role="alert">{message}</p>}
    {!state.draft ? <p role="status">Loading Settings…</p> : <ServiceSettings
      values={state.draft} savedValues={state.base?.settings} request={requestDetachedSettings}
      availableTabs={availableTabs} dirty={dirty} saving={state.saving} pending={!!state.pending}
      conflict={!!state.conflict} workspaceChanged={state.workspaceChanged} sessionError={state.error}
      onChanged={values => settingsSession.edit(values)} onSave={values => settingsSession.save(values)}
      onReconcile={() => recover(() => settingsSession.reconcile(), "Settings receipt could not be checked.")}
      onRetry={() => recover(() => settingsSession.retry(), "Settings save could not be retried.")}
      onUseSaved={() => { try { settingsSession.useSaved(); setMessage(""); } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Saved Settings could not be restored.");
      } }}
      syncSettings={state.draft.logbookMode === "local" ? <p>Standalone local logbook. Wavelog synchronization is disabled in Settings.</p>
      : <SyncPanel request={requestDetachedSettings} onChanged={reload} journalKey="xlog.sync.mutation.settings.v1" />}
      rotorSettings={<Suspense fallback={<p role="status">Loading Rotator settings…</p>}>
        <RotorPanel snapshot={null} request={requestDetachedSettings} configurationSession={rotorSession} configurationOnly />
      </Suspense>}
      workspaceSettings={<WorkspaceSettings {...layout}
        available={["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster", "logbook", "awards", "chaser-dx", "spot-history"]} />}
      dataRequest={requestDetachedSettings} onDataChanged={() => { reload(); void layout.session.refresh(); }} />}
  </main></div>;
}
