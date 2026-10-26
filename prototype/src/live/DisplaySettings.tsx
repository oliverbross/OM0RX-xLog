import { useUiScale } from "./uiScale";
import { uiScales } from "./uiScaleController";
import { qsoDetailFieldKeys, qsoDetailFieldSections } from "./qsoFields";
import { useQSOFieldPreferences } from "./useQSOFieldPreferences";
import { propagationRefreshMinutes, usePropagationRefreshPreference } from "./propagationPreferences";
import { useClusterAppearancePreference } from "./clusterAppearance";
import "./DisplaySettings.css";

export default function DisplaySettings() {
  const display = useUiScale();
  const qso = useQSOFieldPreferences();
  const propagation = usePropagationRefreshPreference();
  const clusterAppearance = useClusterAppearancePreference();
  const selected = new Set(qso.preference.fields);
  const choose = (field: string, visible: boolean) => qso.save(visible ? [...selected, field] : qso.preference.fields.filter(candidate => candidate !== field));
  return <section className="display-settings" aria-label="Display settings">
    <h2>Display scale</h2><p>Enlarge the whole interface for a high-resolution display. 100% is the default; operating-system display scaling still applies. This changes layout only, not radio or rotor settings.</p>
    <label>Interface size<select aria-label="Interface display scale" value={display.requestedScale} disabled={!display.available} onChange={event => display.setScale(Number(event.target.value))}>
      {uiScales.map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%{scale === 1 ? " · Default" : ""}</option>)}
    </select></label>
    <div className="display-settings-actions"><button type="button" disabled={!display.available} onClick={display.reset}>Reset to 100%</button><span>⌘/Ctrl+0 works from any view.</span></div>
    <p role="status">{!display.available ? "Display controls are initializing." : display.pending ? `Applying ${Math.round(display.requestedScale * 100)}%…` : `Last applied in this window: ${Math.round(display.scale * 100)}%.`} Main, monitor and undocked views share the preference.</p>
    {display.error && <p role="alert" className="live-station-error">{display.error}</p>}
    <p>Band-map label size remains a separate preference. Higher interface scales need more screen space; Reset stays available by keyboard if controls move out of view.</p>
    <div className="display-qso-fields">
      <h2>Cluster appearance</h2>
      <label>Spot table style<select aria-label="Cluster appearance" value={clusterAppearance.appearance}
        onChange={event => clusterAppearance.save(event.target.value as "modern" | "classic")}>
        <option value="modern">Modern · coloured</option><option value="classic">Classic · compact</option>
      </select></label>
      <p>Classic uses compact rows with coloured text. Modern uses coloured rows and badges. Saved automatically for the DX Cluster window and Operator Desk. The Contest Cluster keeps its contest layout.</p>
      {clusterAppearance.error && <p role="alert" className="live-station-error">{clusterAppearance.error}</p>}
    </div>
    <div className="display-qso-fields">
      <h2>HF propagation</h2>
      <label>Automatic refresh<select aria-label="Propagation refresh interval" value={propagation.minutes} onChange={event => propagation.save(Number(event.target.value))}>
        {propagationRefreshMinutes.map(minutes => <option key={minutes} value={minutes}>Every {minutes} minutes{minutes === 10 ? " · Default" : ""}</option>)}
      </select></label>
      <p>Saved automatically. The Desk and Propagation window share the latest conditions and refresh on this interval while open.</p>
      {propagation.error && <p role="alert" className="live-station-error">{propagation.error}</p>}
    </div>
    <div className="display-qso-fields">
      <h2>QSO details</h2>
      <p>Choose which optional fields appear in the QSO details panel. Active-contact fields such as callsign, frequency, band, mode, reports and UTC always remain visible. Hiding a field never removes its saved value.</p>
      <div className="display-qso-field-actions"><button type="button" onClick={() => qso.save(qsoDetailFieldKeys)}>Show all</button><button type="button" onClick={() => qso.save([])}>Hide all optional fields</button><span>{selected.size} of {qsoDetailFieldKeys.length} shown</span></div>
      <div className="display-qso-field-groups">{qsoDetailFieldSections.map(section => <fieldset key={section.id}><legend>{section.label}</legend>{section.fields.map(field => <label key={field.key}><input type="checkbox" checked={selected.has(field.key)} onChange={event => choose(field.key, event.target.checked)} />{field.label}</label>)}</fieldset>)}</div>
      {qso.error && <p role="alert" className="live-station-error">{qso.error}</p>}
    </div>
  </section>;
}
