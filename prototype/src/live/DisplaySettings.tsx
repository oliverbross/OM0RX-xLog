import { useUiScale } from "./uiScale";
import { uiScales } from "./uiScaleController";
import "./DisplaySettings.css";

export default function DisplaySettings() {
  const display = useUiScale();
  return <section className="display-settings" aria-label="Display settings">
    <h2>Display scale</h2><p>Enlarge the whole interface for a high-resolution display. 100% is the default; operating-system display scaling still applies. This changes layout only, not radio or rotor settings.</p>
    <label>Interface size<select aria-label="Interface display scale" value={display.requestedScale} disabled={!display.available} onChange={event => display.setScale(Number(event.target.value))}>
      {uiScales.map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%{scale === 1 ? " · Default" : ""}</option>)}
    </select></label>
    <div className="display-settings-actions"><button type="button" disabled={!display.available} onClick={display.reset}>Reset to 100%</button><span>⌘/Ctrl+0 works from any view.</span></div>
    <p role="status">{!display.available ? "Display controls are initializing." : display.pending ? `Applying ${Math.round(display.requestedScale * 100)}%…` : `Last applied in this window: ${Math.round(display.scale * 100)}%.`} Main, monitor and undocked views share the preference.</p>
    {display.error && <p role="alert" className="live-station-error">{display.error}</p>}
    <p>Band-map label size remains a separate preference. Higher interface scales need more screen space; Reset stays available by keyboard if controls move out of view.</p>
  </section>;
}
