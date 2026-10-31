import { useEffect, useRef, useState, type FormEvent } from "react";
import { HamlibModelPicker } from "./HamlibModelPicker";
import { loadHamlibCatalogue, type HamlibModel } from "./hamlibCatalogue";
import { stationSessionRequest } from "./stationSession";
import { firstRunDirectServicesAvailable, firstRunError, firstRunValues, type FirstRunValues } from "./firstRunSetupState";
import "./FirstRunSetup.css";

type Props = { initialSettings?: Record<string, any> | null; onFinish: (values: FirstRunValues) => Promise<void>;
  loadModels?: (device: "radio" | "rotor") => Promise<HamlibModel[]>; loadCapabilities?: () => Promise<unknown> };
const catalogueRequest = (_method: string, params: Record<string, unknown>) => params.device === "radio"
  ? stationSessionRequest<{ models: unknown[] }>("radio1", { action: "hamlib_catalogue" })
  : import("../worker").then(({ workerRequest }) => workerRequest("hamlib_models", { device: "rotor" }));
const titles = ["Station identity", "Radio (optional)", "Rotator (optional)", "Logbook"];
const nativeCapabilities = () => import("../worker").then(async ({ workerRequest }) => (await workerRequest("health")).result);

export default function FirstRunSetup({ initialSettings, onFinish, loadModels = device => loadHamlibCatalogue(catalogueRequest, device), loadCapabilities = nativeCapabilities }: Props) {
  const [values, setValues] = useState(() => firstRunValues(initialSettings));
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [models, setModels] = useState<Partial<Record<"radio" | "rotor", HamlibModel[]>>>({});
  const [loading, setLoading] = useState<"radio" | "rotor" | null>(null);
  const [directServices, setDirectServices] = useState(false);
  const [capabilitiesReady, setCapabilitiesReady] = useState(false);
  const capabilityLoader = useRef(loadCapabilities);
  useEffect(() => {
    let active = true;
    void capabilityLoader.current().then(health => { if (active) setDirectServices(firstRunDirectServicesAvailable(health)); }, () => {})
      .finally(() => { if (active) setCapabilitiesReady(true); });
    return () => { active = false; };
  }, []);
  const heading = useRef<HTMLHeadingElement>(null), inFlight = useRef(false);
  const update = (change: Partial<FirstRunValues>) => { setValues(previous => ({ ...previous, ...change })); setError(""); };
  const go = (next: number) => { setError(""); setStep(next); queueMicrotask(() => heading.current?.focus()); };
  const load = async (device: "radio" | "rotor") => {
    setLoading(device); setError("");
    try { const loaded = await loadModels(device); setModels(previous => ({ ...previous, [device]: loaded })); if (!loaded.length) setError("The bundled model catalogue is unavailable. Retry, enter a known model ID, or skip this connection for now."); }
    catch { setError("The bundled model catalogue could not load. Retry or skip this connection for now."); }
    finally { setLoading(null); }
  };
  const field = (key: keyof FirstRunValues, label: string, type = "text", extra: Record<string, any> = {}) => <label>{label}<input aria-label={label} type={type}
    value={values[key] ?? ""} maxLength={key === "stationLocation" ? 512 : 2048} {...extra}
    onChange={event => update({ [key]: type === "number" && !["wavelogStationID", "defaultPower"].includes(key) ? Number(event.target.value) : event.target.value })} /></label>;
  const modelPicker = (device: "radio" | "rotor") => <>
    <button type="button" disabled={!!loading} onClick={() => void load(device)}>{loading === device ? "Loading models…" : `Browse ${device === "radio" ? "radio" : "rotator"} models`}</button>
    {models[device]?.length ? <HamlibModelPicker device={device} models={models[device]!} loading={loading === device}
      selected={device === "radio" ? values.radioModel : values.rotorModel} labelPrefix={`Setup ${device}`} onSelect={id => update(device === "radio" ? { radioModel: id } : { rotorModel: id })} />
      : field(device === "radio" ? "radioModel" : "rotorModel", `${device === "radio" ? "Radio" : "Rotator"} model ID`, "number", { min: 1, step: 1 })}
  </>;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    const problem = firstRunError(values, step); if (problem) { setError(problem); return; }
    if (step < 3) { go(step + 1); return; }
    inFlight.current = true; setBusy(true); setError("");
    try { await onFinish(values); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Setup could not be saved. Your entered details are retained; try Finish setup again."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="first-run-setup" aria-label="First-run station setup" aria-busy={busy}>
    <header><h1>Welcome to OM0RX-xLog</h1><p>Set up your station and local logbook. Radio and rotator connections can wait.</p></header>
    <ol aria-label="Setup progress">{titles.map((title, index) => <li key={title} aria-current={step === index ? "step" : undefined}>{index + 1}. {title}</li>)}</ol>
    <form onSubmit={event => void submit(event)} noValidate>
      <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2>
      <fieldset disabled={busy}>
        {step === 0 && <><p>These details fill the station fields in new contacts. You can change them later in Settings.</p><div className="setup-fields">
          {field("operatorCall", "Operator call", "text", { required: true, autoCapitalize: "characters", autoFocus: true, maxLength: 32 })}
          {field("stationCall", "Station call", "text", { required: true, autoCapitalize: "characters", maxLength: 32 })}
          {field("gridSquare", "Station grid (optional)", "text", { autoCapitalize: "characters", maxLength: 10, placeholder: "Maidenhead locator" })}
          {field("stationLocation", "Station location (optional)")}{field("defaultPower", "Default power W", "number", { min: 0, max: 100000, step: "any" })}
        </div></>}
        {step === 1 && <><p>Save a connection now, or use xLog without a connected radio. Setup never connects or enables transmit.</p>
          <label>Radio connection<select aria-label="Setup radio connection" value={values.radio} onChange={event => update({ radio: event.target.value as FirstRunValues["radio"] })}>
            <option value="skip">No radio for now</option><option value="hamlib">USB / Serial or network CAT · Hamlib</option>{directServices && <><option value="direct_flex_lan">Direct FLEX · LAN / VPN</option><option value="direct_tci">ExpertSDR TCI</option><option value="direct_agent">Remote Station Agent</option></>}
          </select></label>
          {!directServices && <p role="status">{capabilitiesReady ? "Direct station services are unavailable in this runtime. Hamlib remains available, or skip radio setup for now." : "Checking available radio providers. Hamlib and Skip remain available."}</p>}
          {values.radio !== "skip" && <div className="setup-fields">{field("radioName", "Radio name (optional)", "text", { maxLength: 64 })}
            {values.radio === "hamlib" && <>{modelPicker("radio")}{field("radioPath", "Radio serial device or host:port")}{field("radioBaud", "Radio baud rate", "number", { min: 300, max: 921600 })}</>}
            {values.radio === "direct_flex_lan" && <>{field("radioHost", "FLEX radio address")}{field("radioPort", "FLEX port", "number", { min: 1, max: 65535 })}</>}
            {values.radio === "direct_tci" && field("tciEndpoint", "TCI WebSocket URL", "url", { placeholder: "ws://computer:50001" })}
            {values.radio === "direct_agent" && <>{field("agentURL", "Remote Station Agent URL", "url", { placeholder: "https://station:port" })}<p>Add the agent credential when you explicitly connect in Radio Settings.</p></>}
          </div>}
        </>}
        {step === 2 && <><p>A rotator is optional. Saved connection details do not connect, arm automatic rotation or move an antenna.</p>
          <label>Rotator connection<select aria-label="Setup rotator connection" value={values.rotor} onChange={event => update({ rotor: event.target.value as FirstRunValues["rotor"] })}>
            <option value="skip">No rotator for now</option>{directServices && <option value="native_dcu1">DCU-1 network rotator</option>}<option value="hamlib">USB / Serial or network rotator · Hamlib</option>
          </select></label>
          {values.rotor === "native_dcu1" && <div className="setup-fields">{field("rotorHost", "Rotator address")}{field("rotorPort", "Rotator port", "number", { min: 1, max: 65535 })}</div>}
          {values.rotor === "hamlib" && <div className="setup-fields">{modelPicker("rotor")}{field("rotorPath", "Rotator serial device or host:port")}{field("rotorBaud", "Rotator baud rate", "number", { min: 300, max: 921600 })}</div>}
        </>}
        {step === 3 && <><p>Every QSO is saved in xLog’s integrated local logbook. Optional Wavelog synchronization keeps a local working copy, so you can keep logging offline.</p>
          <label>Logbook mode<select aria-label="Setup logbook mode" value={values.logbookMode} onChange={event => update({ logbookMode: event.target.value as "local" | "wavelog" })}>
            <option value="local">Integrated logbook only</option><option value="wavelog">Integrated logbook + Wavelog synchronization</option>
          </select></label>
          {values.logbookMode === "wavelog" && <><div className="setup-fields">{field("wavelogURL", "Wavelog URL", "url")}{field("wavelogStationID", "Wavelog station ID", "number", { min: 1, max: 2147483647, step: 1 })}
            {field("wavelogToken", "Wavelog API v2 token (optional)", "password", { autoComplete: "new-password", maxLength: 8192 })}</div>
            <p>The token is saved in the system credential vault. You can also add it later. Synchronization stays off until you explicitly start or enable it in Settings → Sync.</p></>}
          <p>Finish setup saves these choices. Connect hardware explicitly from Settings when you are ready.</p>
        </>}
      </fieldset>
      {error && <p role="alert" className="live-error">{error}</p>}
      <footer>{step > 0 && <button type="button" disabled={busy} onClick={() => go(step - 1)}>Back</button>}
        {(step === 1 || step === 2) && <button type="button" disabled={busy} onClick={() => { update(step === 1 ? { radio: "skip" } : { rotor: "skip" }); go(step + 1); }}>Skip {step === 1 ? "radio" : "rotator"}</button>}
        <button className="primary" disabled={busy} type="submit">{busy ? "Saving setup…" : step === 3 ? "Finish setup" : "Continue"}</button>
      </footer>
    </form>
  </section>;
}
