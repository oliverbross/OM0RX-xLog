import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectConnectionDoctor, type ConnectionDoctorPreview, type DoctorReason } from "./connectionDoctor";
import "./DetachedTaskSurface.css";
import "./DetachedConnectionDoctorSurface.css";

const providers: Record<ConnectionDoctorPreview["provider"], string> = {
  direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", direct_tci: "Direct TCI", hamlib: "Local Hamlib", unknown: "Not selected",
};
const reasons: Record<DoctorReason, string> = {
  providerRecognized: "Selected provider recognized", providerUnknown: "No recognized provider retained",
  configurationRetained: "Configuration status retained", configurationMissing: "Configuration reported missing",
  configurationInvalid: "Configuration reported invalid", configurationUnknown: "Configuration not inspected",
  connected: "Retained transport and radio agree", connectionPending: "Connection was still progressing",
  disconnected: "No retained connection", connectionUnknown: "Connection state unavailable",
  observationFresh: "Observation receipt is current", observationStale: "Observation receipt is stale",
  observationUnavailable: "No authoritative observation retained", observationTimeUnknown: "Observation time unavailable",
  readOnly: "Observation-only provider", capabilitiesAdvertised: "Provider advertised capabilities",
  capabilitiesUnknown: "Capabilities unavailable",
};
const stages = { provider: "Provider", configuration: "Configuration", connection: "Connection", freshness: "Observation", capabilities: "Capabilities" };
const labels = { passed: "OK", attention: "Attention", unknown: "Unknown" };
const capabilities = { observe: "Observe", tune: "Tune", ptt: "PTT", cw: "CW", rfPower: "RF power" };

export function DetachedConnectionDoctorSurface() {
  const [preview, setPreview] = useState<ConnectionDoctorPreview | null>(null), [error, setError] = useState("");
  const [exporting, setExporting] = useState(false), [exportStatus, setExportStatus] = useState("");
  const exportPending = useRef(false);
  useEffect(() => connectConnectionDoctor(value => { setPreview(value); setError(""); }, setError), []);
  const exportRedacted = async () => {
    if (!preview || exportPending.current) return;
    exportPending.current = true; setExporting(true); setExportStatus("");
    try {
      const saved = await invoke<boolean>("connection_doctor_export", { preview });
      setExportStatus(saved ? "Redacted report saved." : "Export cancelled. No report saved.");
    } catch { setExportStatus("Redacted report could not be saved. Try again."); }
    finally { exportPending.current = false; setExporting(false); }
  };
  const attention = preview?.checks.filter(check => check.status === "attention").length ?? 0;
  const unknown = preview?.checks.filter(check => check.status === "unknown").length ?? 0;
  return <div className="app live detached-task-app detached-connection-doctor-app"><main aria-label="Connection Doctor">
    <p className="connection-doctor-summary" role="status">{preview
      ? `${providers[preview.provider]} · ${attention ? `${attention} item${attention === 1 ? "" : "s"} need attention` : unknown ? `${unknown} stage${unknown === 1 ? "" : "s"} unknown` : "Retained checks passed"}`
      : "Reading retained station state…"}</p>
    {error && <p className="live-error" role="alert">{error}</p>}
    {preview && <>
      <section className="connection-doctor-overview" aria-label="Retained connection summary"><dl>
        <div><dt>Provider</dt><dd>{providers[preview.provider]}</dd></div>
        <div><dt>Transport</dt><dd>{preview.transport === "unknown" ? "Unavailable" : preview.transport}</dd></div>
        <div><dt>Observation</dt><dd>{preview.freshness}</dd></div>
        <div><dt>Access</dt><dd>{preview.readOnly === true ? "Read only" : preview.readOnly === false ? "Advertised controls" : "Unavailable"}</dd></div>
      </dl></section>
      <section aria-labelledby="connection-doctor-checks"><h2 id="connection-doctor-checks">Diagnostic stages</h2>
        <ol className="connection-doctor-checks">{preview.checks.map(check => <li key={check.stage} className={`is-${check.status}`}>
          <div><strong>{stages[check.stage]}</strong><span>{reasons[check.reason]}</span></div><b>{labels[check.status]}</b>
        </li>)}</ol>
      </section>
      <section aria-labelledby="connection-doctor-capabilities"><h2 id="connection-doctor-capabilities">Advertised capabilities</h2>
        {preview.advertisedCapabilities.length ? <ul className="connection-doctor-capabilities">{preview.advertisedCapabilities.map(item => <li key={item}>{capabilities[item]}</li>)}</ul>
          : <p className="secondary">No capabilities can be confirmed from the retained projection.</p>}
      </section>
      <p className="secondary connection-doctor-boundary">Retained worker state only. Configuration, credentials, endpoints, radio values, logs and devices are not inspected. This view never reconnects or sends a command.</p>
      <section aria-label="Redacted export">
        <button type="button" disabled={exporting} onClick={() => void exportRedacted()}>{exporting ? "Saving…" : "Export redacted report…"}</button>
        <p className="secondary">Only when you click: save the displayed diagnostic categories as redacted JSON. No secrets, endpoints, identifiers, errors, radio values, timestamps or log contents are included. No new station read occurs.</p>
        {exportStatus && <p role="status">{exportStatus}</p>}
      </section>
    </>}
  </main></div>;
}
