// Development-only visual fixture. Synthetic data, no worker or device access.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import OperatorDesk from "../../src/live/OperatorDesk";
import ServiceSettings from "../../src/live/ServiceSettings";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
const initial = { id: "synthetic", call: "N0CALL", start: "2026-10-12T14:00:00Z", frequencyHz: 14025000, band: "20m", mode: "CW", rstSent: "599", rstReceived: "599" };
function Fixture() {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial);
  const [values, setValues] = useState<Record<string, any>>({ operatorCall: "N0CALL", stationCall: "N0CALL", logbookMode: "local", stationEquipment: { display: "antenna", antenna: "vertical", name: "Garden vertical", bands: ["20m", "17m", "15m", "12m", "10m"] } });
  const [settings, setSettings] = useState(false);
  const request = async (method: string, params?: Record<string, any>) => method === "settings_save" ? { settings: params?.settings } : method === "cluster_history" ? { history: { call: draft?.call, adif: null, matrix: [], previous: [] } } : { cells: [] };
  return <div className="live" style={{ padding: 16 }}><p>Equipment layout fixture · synthetic data · no hardware connection</p><div className="live-actions"><button onClick={() => setSettings(!settings)}>{settings ? "Show desk" : "Show settings"}</button><button onClick={() => setValues(current => ({ ...current, stationEquipment: { ...current.stationEquipment, display: "automatic" } }))}>Unconfigured station</button></div>
    {settings ? <ServiceSettings values={values} request={request} onChanged={setValues} onSave={async next => setValues(next)} /> : <OperatorDesk equipment={values.stationEquipment} draft={draft} setDraft={setDraft} save={noop} clear={noop} busy={false} lookup={null} previous={[]} request={request} refresh={0} onEditor={noop} onReadRadio={async () => {}} follow={false} setFollow={noop} rotor={null} autoRotor={false} setAutoRotor={noop} onManualRotor={noop} />}</div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
