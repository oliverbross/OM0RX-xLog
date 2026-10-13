// Synthetic presentation only: every service request is local and mocked.
// No worker, device connection, persistence, secret access, images or fetches.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ServiceSettings from "../../src/live/ServiceSettings";
import QSOEditor from "../../src/live/QSOEditor";
import type { DraftPowerState } from "../../src/live/operatorDraftSession";
import "../../src/style.css";
import "../../src/live/live.css";

type Data = Record<string, any>;
type Mode = "off" | "fallback" | "manual" | "captured";
const params = new URLSearchParams(location.search);
const modes: Mode[] = ["off", "fallback", "manual", "captured"];
const initialMode: Mode = modes.includes(params.get("mode") as Mode) ? params.get("mode") as Mode : "off";
const noop = () => {};
const contact = { workspaceID: "00000000-0000-4000-8000-000000000001", draftID: "synthetic-power-draft",
  call: "N0CALL", band: "20m", mode: "CW", frequencyHz: 14_025_000 };
const context = { providerID: "synthetic-station", selectionID: "synthetic-radio", sessionID: "00000000-0000-4000-8000-000000000002",
  sessionStartedAt: "2026-10-14T12:00:00Z", source: "direct_agent" as const, meterSource: "kpa500_output" as const };
const initialDraft = (txPower: string): Data => ({ id: contact.draftID, call: contact.call, start: "2026-10-14T12:00:00Z",
  frequencyHz: contact.frequencyHz, band: contact.band, mode: contact.mode, rstSent: "599", rstReceived: "599",
  stationLocation: "Synthetic station", radio: "Synthetic remote station", txPower, operatorCall: "N0CALL",
  name: "Preview operator", country: "Synthetic location", gridSquare: "FM29IK", notes: "Synthetic note. No QSO will be written.", extraFields: {} });
function syntheticPower(mode: Mode, fallback = "100"): DraftPowerState {
  const state: DraftPowerState = { revision: 1, enabled: mode !== "off", fallback, manualOverride: mode === "manual",
    selectedValue: mode === "manual" ? "25" : mode === "captured" ? "550" : fallback, contact: { ...contact } };
  if (mode === "fallback" || mode === "captured") {
    state.activeScope = { id: "00000000-0000-4000-8000-000000000003", contact: { ...contact }, context: { ...context }, armedAt: context.sessionStartedAt };
    state.lastContext = { ...context };
  }
  if (mode === "captured") {
    state.selectedSample = { source: "kpa500_output", unit: "W", watts: 550, sessionID: context.sessionID,
      observedAt: "2026-10-14T12:00:01Z", radioObservedAt: "2026-10-14T12:00:01Z",
      amplifierObservedAt: "2026-10-14T11:59:56Z", receivedAt: "2026-10-14T12:00:01Z" };
    state.selectedContext = { ...context }; state.selectedContact = { ...contact };
    state.sessionPeak = { ...state.selectedSample }; state.lastObservedAt = state.selectedSample.observedAt;
  }
  return state;
}
const request = async (method: string, values: Data = {}): Promise<Data> => {
  if (method === "settings_save") return { settings: structuredClone(values.settings) };
  if (method === "secret_status") return { "wavelog-token": false, "qrz-password": false, "clublog-api-key": false };
  if (method === "secret_save") return { saved: true };
  if (method === "logbook_matrix") return { cells: [] };
  if (method === "cluster_history") return { history: { call: contact.call, adif: null, matrix: [], previous: [] } };
  if (method === "backup_list") return { backups: [] };
  return {};
};

function Fixture() {
  const [view, setView] = useState<"settings" | "editor">(params.get("view") === "editor" ? "editor" : "settings");
  const [settings, setSettings] = useState<Data>({ operatorCall: "N0CALL", stationCall: "N0CALL", gridSquare: "FM29IK",
    stationLocation: "Synthetic station", defaultPower: "100", defaultRadio: "Synthetic remote station",
    automaticTransmitPower: initialMode !== "off", logbookMode: "local", qrzEnabled: false,
    wavelogURL: "", wavelogStationID: 1, qrzUsername: "", clubLogCTYURL: "", lotwActivityURL: "" });
  const [power, setPower] = useState(() => syntheticPower(initialMode));
  const [settingsPreviewRevision, setSettingsPreviewRevision] = useState(0);
  const [draft, setDraft] = useState<Data | null>(() => initialDraft(power.selectedValue));
  const [message, setMessage] = useState("");
  const applyPower = (next: DraftPowerState) => { setPower(next); setDraft(current => current ? { ...current, txPower: next.selectedValue } : current); };
  const chooseMode = (mode: Mode) => {
    setSettings(current => ({ ...current, automaticTransmitPower: mode !== "off" }));
    setSettingsPreviewRevision(current => current + 1);
    applyPower(syntheticPower(mode, String(settings.defaultPower))); setMessage("");
  };
  const saveSettings = (value: Data) => {
    setSettings(value);
    const next = { ...power, revision: power.revision + 1, enabled: value.automaticTransmitPower === true, fallback: String(value.defaultPower),
      activeScope: undefined, sessionPeak: undefined, lastObservedAt: undefined };
    if (!next.manualOverride && !next.selectedSample && next.enabled) next.selectedValue = next.fallback;
    applyPower(next);
  };
  const manualPower = (value: string) => applyPower({ ...power, revision: power.revision + 1, manualOverride: true, selectedValue: value,
    activeScope: undefined, selectedSample: undefined, selectedContext: undefined, selectedContact: undefined, sessionPeak: undefined, lastObservedAt: undefined });
  const automaticPower = () => applyPower({ ...power, revision: power.revision + 1, manualOverride: false, selectedValue: power.fallback,
    activeScope: undefined, selectedSample: undefined, selectedContext: undefined, selectedContact: undefined, sessionPeak: undefined, lastObservedAt: undefined });
  return <main className="live" style={{ padding: 16, maxWidth: 1600, margin: "0 auto" }}>
    <p>Synthetic power capture preview · no station, logbook, accounts or network services</p>
    <div className="live-actions" role="group" aria-label="Preview surface">
      <button type="button" aria-pressed={view === "settings"} onClick={() => setView("settings")}>Station settings</button>
      <button type="button" aria-pressed={view === "editor"} onClick={() => setView("editor")}>QSO editor</button>
    </div>
    <div className="live-actions" role="group" aria-label="Synthetic power state">
      {modes.map(mode => <button key={mode} type="button" onClick={() => chooseMode(mode)}>{mode === "off" ? "Off" : mode === "fallback" ? "Fallback" : mode === "manual" ? "Manual override" : "Captured sample"}</button>)}
    </div>
    {view === "settings" ? <div className="live-settings"><ServiceSettings key={settingsPreviewRevision} values={settings} request={request} onSaved={saveSettings} /></div>
      : <QSOEditor draft={draft} setDraft={setDraft} save={() => setMessage("Synthetic save only. Nothing was persisted.")}
        clear={() => { const next = syntheticPower(settings.automaticTransmitPower ? "fallback" : "off", String(settings.defaultPower)); setPower(next); setDraft(initialDraft(next.selectedValue)); }}
        busy={false} lookup={{ call: contact.call, name: "Preview operator", country: "Synthetic location", source: "Synthetic fixture", gridSquare: "FM29IK" }}
        previous={[]} follow={false} setFollow={noop} radioControls={false} request={request}
        powerState={power} automaticPowerEnabled={settings.automaticTransmitPower} onManualPower={manualPower} onResumeAutomaticPower={automaticPower} />}
    {message && <p role="status">{message}</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
