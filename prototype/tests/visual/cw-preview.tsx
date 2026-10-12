// Development-only fixture. Synthetic state with no worker or hardware access.
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import OperatorDesk from "../../src/live/OperatorDesk";
import ServiceSettings from "../../src/live/ServiceSettings";
import CWDesk from "../../src/live/CWDesk";
import { CWController, type CWRequest } from "../../src/live/cwController";
import { defaultCWProfile } from "../../src/live/cwMacros";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
const profile = structuredClone(defaultCWProfile); profile.showOnDesk = true;
profile.macros.forEach((macro, index) => { macro.shortcut = `F${index + 1}`; });
const context = { MYCALL: "N0CALL", CALL: "W1AW", RST: "599", GRID: "FN31", SERIAL: "007" };
function Fixture() {
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "synthetic", call: "W1AW", start: "2026-10-12T14:00:00Z", frequencyHz: 14025000, band: "20m", mode: "CW", rstSent: "599", rstReceived: "599" });
  const [values, setValues] = useState<Record<string, any>>({ stationCall: "N0CALL", cwProfile: profile });
  const [settings, setSettings] = useState(true);
  const request: CWRequest = async (method, params) => {
    if (method === "settings_save") return { settings: params?.settings };
    if (method === "cluster_history") return { history: { call: draft?.call, matrix: [], previous: [] } };
    if (method === "station_snapshot") return { source: "direct_agent", generation: 1, allow_transmit: true,
      radio: { connected: true, observed: true, mode: "CW", observed_at: Date.now() / 1000 }, capabilities: { supported_commands: ["send_cw", "clear_cw"] } };
    if (method.startsWith("winkeyer_")) return { generation: 0, phase: "disconnected", ports: [] };
    return { accepted: true, cells: [] };
  };
  const [controller] = useState(() => { const c = new CWController(request, () => performance.now(), () => true); c.configure(profile, "direct_agent"); return c; });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <div className="live" style={{ padding: 16 }}><p>CW layout fixture · synthetic data · no worker or hardware connection</p>
    <div className="live-actions"><button onClick={() => { void controller.stop(); setSettings(!settings); }}>{settings ? "Show desk" : "Show settings"}</button></div>
    {settings ? <ServiceSettings values={values} request={request} onSaved={next => { setValues(next); controller.configure(next.cwProfile, "direct_agent"); }} cwContext={context} cwState={state} />
      : <OperatorDesk equipment={{ display: "hidden" }} draft={draft} setDraft={setDraft} save={noop} clear={noop} busy={false} lookup={null} previous={[]} request={request} refresh={0} onEditor={noop} onReadRadio={async () => {}} follow={false} setFollow={noop} rotor={null} autoRotor={false} setAutoRotor={noop} onManualRotor={noop}
        cwControls={<CWDesk profile={values.cwProfile} context={context} controller={controller} state={state} />} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
