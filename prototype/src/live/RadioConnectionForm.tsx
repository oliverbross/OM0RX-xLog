import { useEffect, useMemo, useState } from "react";
import { HamlibModelPicker } from "./HamlibModelPicker";
import { hamlibManufacturers, loadHamlibCatalogue, type HamlibModel } from "./hamlibCatalogue";
import { radioConnected, radioLabel, stationSessionRequest, validTCIConfiguration, type FlexConfiguration, type HamlibConfiguration, type RadioID, type RadioProfile, type StationSession, type TCIConfiguration } from "./stationSession";

// Stable cache keys: listing bundled data is passive and never discovers hardware.
const catalogueRequests = {
  radio1: () => stationSessionRequest<{ models: unknown[] }>("radio1", { action: "hamlib_catalogue" }),
  radio2: () => stationSessionRequest<{ models: unknown[] }>("radio2", { action: "hamlib_catalogue" }),
};
const nativeModels: HamlibModel[] = [
  ...["FLEX-6300", "FLEX-6400", "FLEX-6400M", "FLEX-6500", "FLEX-6600", "FLEX-6600M", "FLEX-6700", "FLEX-8400", "FLEX-8400M", "FLEX-8600", "FLEX-8600M"].map((model, index) => ({ id: -100 - index, manufacturer: "FlexRadio", model, maturity: "Native", search: model.toLowerCase() })),
  ...["SunSDR2 DX", "SunSDR2 PRO"].map((model, index) => ({ id: -200 - index, manufacturer: "Expert Electronics", model, maturity: "TCI receive control", search: model.toLowerCase() })),
];
export type RadioSetupAction = "save" | "connect" | "disconnect" | "save_connect" | "save_disconnect";
export type RadioFormProps = {
  radioId: RadioID; state: StationSession | null; profile: RadioProfile; setProfile: (value: RadioProfile, edited?: boolean) => void;
  config: HamlibConfiguration; setConfig: (value: HamlibConfiguration) => void;
  flex: FlexConfiguration; setFlex: (value: FlexConfiguration) => void;
  tci: TCIConfiguration; setTCI: (value: TCIConfiguration) => void;
  url: string; setURL: (value: string) => void; token: string; setToken: (value: string) => void;
  transmit: boolean; setTransmit: (value: boolean) => void;
  dirty: boolean; busy: boolean; pending: string | null; conflict: boolean; message: string; error: string;
  onAction: (action: RadioSetupAction) => void; onRevert: () => void; onCheck: () => void; onReview: () => void;
};

export function RadioConnectionForm(p: RadioFormProps) {
  const [catalogue, setCatalogue] = useState<HamlibModel[]>([]), [loading, setLoading] = useState(true), [catalogueError, setCatalogueError] = useState(false), [attempt, setAttempt] = useState(0);
  const [ports, setPorts] = useState<{ path: string; label: string }[]>([]), [portsError, setPortsError] = useState(false), [portAttempt, setPortAttempt] = useState(0);
  const [network, setNetwork] = useState(() => !!p.config.path && !p.config.path.startsWith("/") && p.config.path.includes(":"));
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  useEffect(() => { if (!p.dirty) setHostDraft(null); }, [p.dirty, p.tci.endpoint]);
  useEffect(() => {
    let active = true; setLoading(true); setCatalogueError(false);
    void loadHamlibCatalogue(catalogueRequests[p.radioId], "radio", attempt > 0).then(models => {
      if (active) { setCatalogue(models); setCatalogueError(!models.length); }
    }, () => { if (active) setCatalogueError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [p.radioId, attempt]);
  useEffect(() => {
    let active = true;
    void stationSessionRequest<{ ports: { path: string; label: string }[] }>(p.radioId, { action: "serial_ports" }).then(value => {
      if (active) { setPorts(value.ports.filter(port => typeof port.path === "string" && typeof port.label === "string")); setPortsError(false); }
    }, () => { if (active) setPortsError(true); });
    return () => { active = false; };
  }, [p.radioId, portAttempt]);
  // Slice-driver entries are not physical radios or implemented native slice binding.
  // Saved IDs remain recoverable through the existing expert fallback.
  const models = useMemo(() => [...nativeModels, ...catalogue.filter(model => !(model.manufacturer.toLowerCase() === "flexradio" && /slice\s+[a-h]\b/i.test(model.model)))], [catalogue]);
  const known = catalogue.find(model => model.id === p.config.model);
  // Hydrate legacy names from the exact saved ID, never from an address or a default.
  useEffect(() => {
    if (p.profile.provider === "hamlib" && !p.profile.manufacturer && known) p.setProfile({ ...p.profile, manufacturer: known.manufacturer, model: known.model }, false);
  }, [known?.id, p.profile.manufacturer, p.profile.provider]);
  useEffect(() => { if (!p.dirty) setNetwork(!!p.config.path && !p.config.path.startsWith("/") && p.config.path.includes(":")); }, [p.config.path, p.dirty]);
  const provider = p.profile.provider, hamlib = provider === "hamlib", flex = provider === "direct_flex_lan", tci = provider === "direct_tci";
  const selected = models.find(model => model.manufacturer === p.profile.manufacturer && model.model === p.profile.model)?.id ?? (hamlib && !p.profile.manufacturer ? p.config.model : undefined);
  const connected = radioConnected(p.state), live = p.state?.radio?.snapshot;
  const sameTCITarget = (() => { try { return !p.state?.reconnect_required && new URL(p.state?.tci?.endpoint ?? "").href === new URL(p.tci.endpoint).href; } catch { return false; } })();
  const confirmedReceivers = connected && sameTCITarget && p.state?.selection.provider === "direct_tci" && Number.isInteger(live?.tci?.trx_count) && live!.tci.trx_count > 0 && live!.tci.trx_count <= 16 ? live!.tci.trx_count as number : 1;
  const configured = !!p.state?.profile || !!p.state?.base_url || !!p.state?.flex || !!p.state?.tci || !!p.state?.hamlib;
  const disabled = !p.state || p.busy || !!p.pending || p.conflict;
  const validPort = (port: number | undefined) => Number.isInteger(port) && port! > 0 && port! <= 65535;
  const networkReady = (() => { try { const value = new URL(`tcp://${p.config.path}`); return !!value.hostname && validPort(Number(value.port)) && value.pathname === "" && !value.username && !value.password && !value.search && !value.hash; } catch { return false; } })();
  const valid = flex ? !!p.flex.host.trim() && validPort(p.flex.port) && !!p.flex.station_name.trim()
    : tci ? validTCIConfiguration(p.tci)
    : hamlib ? p.config.mode === "external" ? ["127.0.0.1", "localhost", "::1"].includes(p.config.host ?? "") && validPort(p.config.port)
      : !!p.config.model && (p.config.model === 1 || !!p.config.path?.trim()) && (!network || networkReady) && (!p.config.baud || p.config.baud >= 300 && p.config.baud <= 921600)
    : /^https:\/\//.test(p.url.trim());
  const needsSave = p.dirty || !p.state?.profile;
  const chooseModel = (id: number) => {
    const model = models.find(item => item.id === id); if (!model) return;
    const recommended = model.id < 0 ? model.manufacturer === "FlexRadio" ? "direct_flex_lan" : "direct_tci" : "hamlib";
    p.setProfile({ ...p.profile, manufacturer: model.manufacturer, model: model.model, provider: recommended });
    if (id > 0) p.setConfig({ ...p.config, mode: "managed", model: id });
  };
  const endpoint = (() => { try { return new URL(p.tci.endpoint); } catch { return null; } })();
  const editTCIHost = (host: string) => {
    setHostDraft(host);
    if (/^wss?:\/\//i.test(host)) { p.setTCI({ ...p.tci, endpoint: host }); return; }
    const suffix = endpoint ? `${endpoint.port ? `:${endpoint.port}` : ""}${endpoint.pathname}${endpoint.search}${endpoint.hash}` : ":50001";
    p.setTCI({ ...p.tci, endpoint: `${endpoint?.protocol ?? "ws:"}//${host}${suffix}` });
  };
  const path = p.config.path ?? "", separator = path.lastIndexOf(":"), networkHost = separator >= 0 ? path.slice(0, separator) : path, networkPort = separator >= 0 ? path.slice(separator + 1) : "";
  const liveRoute = ({ direct_agent: "Remote Station Agent", direct_flex_lan: "FlexRadio network", direct_tci: "ExpertSDR TCI", hamlib: "CAT radio" } as Record<string, string>)[p.state?.selection.provider ?? ""];
  return <div className="radio-operator-form" aria-label={`${radioLabel(p.radioId)} setup`}>
    <div className="radio-settings-summary">
      <div><strong>{radioLabel(p.radioId)} · {p.state?.profile?.nickname || p.state?.profile?.model || "Radio setup"}</strong><small>{p.dirty ? "Unsaved changes" : configured ? p.state?.profile?.enabled === false ? "Disabled" : "Configured" : "Not configured"}</small></div>
      <span className={`live-station-status ${connected ? "is-online" : "is-offline"}`} role="status"><i aria-hidden="true" />{p.busy ? "Working…" : connected ? `Connected${p.state?.selection.provider !== provider && liveRoute ? ` · ${liveRoute}` : ""}` : live?.radio?.connected ? "Connection needs attention" : "Offline"}</span>
    </div>
    <p className="radio-operating-state">{p.state?.active_radio === p.radioId ? "Active for logging" : "Standby for logging"} · {p.state?.tx_owner === p.radioId ? "Has transmit control" : "Transmit control not held"}{connected && typeof live?.radio?.frequency_hz === "number" ? ` · ${(live.radio.frequency_hz / 1e6).toFixed(6)} MHz · ${live.radio.mode ?? ""}` : ""}</p>
    {p.state?.reconnect_required && connected && <p role="status">Saved — reconnect to apply. The previous connection is still live.</p>}
    <fieldset className="radio-form-grid" disabled={!p.state || p.busy}>
      <section aria-label="Transceiver"><h3>Transceiver</h3>
        <label>Manufacturer<input aria-label="Manufacturer" list={`${p.radioId}-manufacturers`} value={p.profile.manufacturer} placeholder="Choose manufacturer" onChange={event => p.setProfile({ ...p.profile, manufacturer: event.target.value, model: "" })} /></label>
        <datalist id={`${p.radioId}-manufacturers`}>{hamlibManufacturers(models).map(group => <option key={group.key} value={group.name} />)}</datalist>
        <HamlibModelPicker device="radio" models={models} loading={loading} selected={selected} manufacturerFilter={p.profile.manufacturer || "__choose_manufacturer__"} plainLabels onSelect={chooseModel} labelPrefix={radioLabel(p.radioId)} />
        {p.profile.model && !selected && <p>Saved model: {p.profile.model}. Choose a listed model to change it.</p>}
        {catalogueError && <p role="alert">CAT model catalogue unavailable. Saved selections are retained. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry catalogue</button></p>}
        <label>Name (optional)<input aria-label="Radio nickname" value={p.profile.nickname} maxLength={64} placeholder="e.g. Home radio" onChange={event => p.setProfile({ ...p.profile, nickname: event.target.value })} /></label>
        <label className="radio-inline-check"><input type="checkbox" checked={p.profile.enabled} onChange={event => p.setProfile({ ...p.profile, enabled: event.target.checked })} />Enable radio</label>
      </section>
      <section aria-label="Connection"><h3>Connection</h3>
        <label>Interface<select aria-label="Interface" value={provider} onChange={event => p.setProfile({ ...p.profile, provider: event.target.value as RadioProfile["provider"] })}>
          {(p.profile.manufacturer === "FlexRadio" || flex) && <option value="direct_flex_lan">FlexRadio network (LAN/VPN)</option>}
          {(p.profile.manufacturer === "Expert Electronics" || tci) && <option value="direct_tci">ExpertSDR TCI</option>}
          {(!["FlexRadio", "Expert Electronics"].includes(p.profile.manufacturer) || hamlib) && <option value="hamlib">{p.config.mode === "external" ? "Local rigctld server" : network ? "Network CAT (TCP bridge)" : "USB / Serial CAT"}</option>}
          <option value="direct_agent">xLog Remote Station Agent</option>
        </select></label>
        {flex && <><label>Radio address<input aria-label="Radio address" value={p.flex.host} placeholder="Private radio IP address" onChange={event => p.setFlex({ ...p.flex, host: event.target.value })} /></label>
          <label>Port<input aria-label="Flex port" type="number" min={1} max={65535} value={p.flex.port || ""} onChange={event => p.setFlex({ ...p.flex, port: Number(event.target.value) })} /></label>
          <p>Enter the radio's LAN or VPN address. This connection uses the provider's current receive target.</p></>}
        {tci && <><label>ExpertSDR computer<input aria-label="TCI host" value={hostDraft ?? endpoint?.hostname ?? p.tci.endpoint} placeholder="Computer running the TCI server" onChange={event => editTCIHost(event.target.value)} /></label>
          <label>Port<input aria-label="TCI port" type="number" min={1} max={65535} value={endpoint?.port ?? ""} onChange={event => { if (endpoint) { const next = new URL(endpoint); next.port = event.target.value; p.setTCI({ ...p.tci, endpoint: next.href }); } }} /></label>
          <label>Receiver<select aria-label="TCI receiver" value={p.tci.trx} onChange={event => p.setTCI({ ...p.tci, trx: Number(event.target.value) })}>{Array.from({ length: confirmedReceivers }, (_, index) => <option key={index} value={index}>Receiver {index + 1}</option>)}{p.tci.trx >= confirmedReceivers && <option value={p.tci.trx}>Saved receiver (index {p.tci.trx})</option>}</select></label>
          <p>Receive frequency/mode control. CW, PTT and audio are unavailable on this connection. Start ExpertSDR and enable its TCI server.</p></>}
        {hamlib && <>{p.config.mode === "external" ? <><label>Local server<select aria-label="Local CAT server" value={p.config.host} onChange={event => p.setConfig({ ...p.config, host: event.target.value })}>{["127.0.0.1", "localhost", "::1"].map(host => <option key={host}>{host}</option>)}</select></label><label>Port<input aria-label="Local CAT port" type="number" min={1} max={65535} value={p.config.port ?? ""} onChange={event => p.setConfig({ ...p.config, port: Number(event.target.value) })} /></label></>
          : network ? <><label>CAT host<input aria-label="Network CAT host" value={networkHost} onChange={event => p.setConfig({ ...p.config, path: `${event.target.value}:${networkPort}` })} /></label><label>Port<input aria-label="Network CAT port" type="number" value={networkPort} onChange={event => p.setConfig({ ...p.config, path: `${networkHost}:${event.target.value}` })} /></label><p>Saved network device route. Use only the CAT protocol supported by this model.</p></>
          : <><label>Serial port<select aria-label="Serial port" value={path} onChange={event => p.setConfig({ ...p.config, path: event.target.value })}><option value="">Choose port…</option>{path && !ports.some(port => port.path === path) && <option value={path}>{path} — not currently connected</option>}{ports.map(port => <option key={port.path} value={port.path}>{port.label} · {port.path}</option>)}</select></label>
            <button type="button" onClick={() => setPortAttempt(value => value + 1)}>Refresh ports</button>{portsError && <p role="alert">Port listing unavailable. Retry or use the manual path under Advanced.</p>}
            <label>Baud rate<input aria-label="Baud rate" type="number" min={300} max={921600} value={p.config.baud ?? ""} placeholder="Model default" onChange={event => p.setConfig({ ...p.config, baud: event.target.value ? Number(event.target.value) : undefined })} /></label></>}</>}
        {provider === "direct_agent" && <><label>Station HTTPS address<input aria-label="Station HTTPS address" type="url" value={p.url} placeholder="https://station.example:8443" onChange={event => p.setURL(event.target.value)} /></label><label>Station token<input aria-label="Station token" type="password" autoComplete="off" value={p.token} placeholder="Leave blank to use saved credential" onChange={event => p.setToken(event.target.value)} /></label><p>Connects through your existing Remote Station Agent.</p></>}
      </section>
    </fieldset>
    {p.conflict && <p role="alert">This radio's saved setup changed in another window. Your edits are retained. Revert to review the saved setup before continuing.</p>}
    {p.error && <p role="alert">{p.error}</p>}{p.message && <p role="status">{p.message}</p>}
    {!!p.pending && <div className="radio-action-row"><p role="alert">The last operation needs checking before another connection request.</p><button type="button" disabled={p.busy} onClick={p.onCheck}>Check operation</button></div>}
    <div className="radio-action-row">
      <button type="button" disabled={!p.state || p.busy} onClick={p.onRevert}>Revert</button>
      <button type="button" disabled={disabled || !valid || !needsSave || !p.profile.enabled && connected} onClick={() => p.onAction("save")}>Save</button>
      <button type="button" className="primary" disabled={disabled || !valid || !p.profile.enabled && !connected} onClick={() => p.onAction(!p.profile.enabled && connected ? "save_disconnect" : needsSave ? "save_connect" : "connect")}>{!p.profile.enabled && connected ? `Save & Disconnect ${radioLabel(p.radioId)}` : needsSave ? "Save & Connect" : connected ? "Reconnect" : "Connect"}</button>
      {connected && <button type="button" disabled={disabled} onClick={() => p.onAction("disconnect")}>Disconnect</button>}
    </div>
    <details className="radio-settings-disclosure"><summary>Advanced connection options</summary><fieldset disabled={!p.state || p.busy}>
      {flex && <label>Client / station name<input value={p.flex.station_name} maxLength={64} onChange={event => p.setFlex({ ...p.flex, station_name: event.target.value })} /></label>}
      {tci && <><label>Full TCI WebSocket URL<input aria-label="Full TCI URL" value={p.tci.endpoint} onChange={event => p.setTCI({ ...p.tci, endpoint: event.target.value })} /></label><label>Channel index<input aria-label="TCI channel index" type="number" min={0} max={15} value={p.tci.channel} onChange={event => p.setTCI({ ...p.tci, channel: Number(event.target.value) })} /></label><p>Receiver index {p.tci.trx}. Additional receivers are offered only when confirmed; existing saved indices are retained.</p></>}
      {hamlib && <><label>CAT service<select aria-label="CAT service" value={p.config.mode} onChange={event => p.setConfig(event.target.value === "external" ? { mode: "external", host: "127.0.0.1", port: 4532 } : p.state?.hamlib?.mode === "managed" ? p.state.hamlib : { mode: "managed", model: p.config.model, path: "" })}><option value="managed">Built-in CAT service</option><option value="external">Existing local rigctld server</option></select></label>
        {p.config.mode === "managed" && <><label>Device transport<select aria-label="CAT device transport" value={network ? "tcp" : "serial"} onChange={event => { const tcp = event.target.value === "tcp"; setNetwork(tcp); p.setConfig({ ...p.config, path: tcp ? ":" : p.state?.hamlib?.path?.startsWith("/") ? p.state.hamlib.path : "" }); }}><option value="serial">USB / serial device</option><option value="tcp">TCP CAT bridge</option></select></label><p>A TCP bridge must provide this model's supported CAT protocol. This does not add Icom LAN-server authentication or a new radio driver.</p><label>Saved model ID / expert fallback<input aria-label="CAT model ID" type="number" min={1} value={p.config.model ?? ""} onChange={event => { p.setConfig({ ...p.config, model: Number(event.target.value) }); p.setProfile({ ...p.profile, manufacturer: "", model: "" }); }} /></label><label>Manual device path<input aria-label="Manual serial path" value={p.config.path ?? ""} onChange={event => p.setConfig({ ...p.config, path: event.target.value })} /></label>
          {!network && [["data_bits", "Data bits", [7, 8]], ["stop_bits", "Stop bits", [1, 2]], ["parity", "Parity", ["None", "Even", "Odd", "Mark", "Space"]], ["handshake", "Handshake", ["None", "XONXOFF", "Hardware"]], ["dtr_state", "DTR", ["Unset", "OFF", "ON"]], ["rts_state", "RTS", ["Unset", "OFF", "ON"]]].map(([key, label, choices]) => <label key={String(key)}>{String(label)}<select value={p.config.serial?.[String(key)] ?? ""} onChange={event => { const serial = { ...p.config.serial }; if (!event.target.value) delete serial[String(key)]; else serial[String(key)] = ["data_bits", "stop_bits"].includes(String(key)) ? Number(event.target.value) : event.target.value; p.setConfig({ ...p.config, serial }); }}><option value="">Model default</option>{(choices as (string | number)[]).map(value => <option key={value}>{value}</option>)}</select></label>)}</>}
        <p>Serial ports are listed without opening them. If a port is busy, release it in the other CAT app or use a supported shared server. CI-V overrides are not supported by this setup.</p></>}
    </fieldset></details>
    <details className="radio-settings-disclosure"><summary>CW / PTT / audio routing</summary>{tci ? <p>TCI receive control has no CW, PTT or audio path in xLog.</p> : <label className="radio-inline-check"><input type="checkbox" checked={p.transmit} disabled={p.busy} onChange={event => p.setTransmit(event.target.checked)} />Allow supported transmit controls on the next connection</label>}<p>Transmit control requires this radio to be active for logging. A control lease does not indicate physical transmission. CW and audio settings remain in their existing settings tabs.</p></details>
    <details className="radio-settings-disclosure"><summary>Diagnostics</summary>
      <dl><dt>Live provider</dt><dd>{p.state?.selection.provider ?? "None"}</dd><dt>Desired provider</dt><dd>{provider}</dd><dt>Model ID</dt><dd>{hamlib ? p.config.model ?? "None" : "Native"}</dd><dt>Selection identity</dt><dd>{p.state?.selection.selection_id ?? "Unavailable"}</dd><dt>Last operation</dt><dd>{p.state?.last_receipt ? `${p.state.last_receipt.request.action} · ${p.state.last_receipt.status}` : "None"}</dd><dt>Physical transmit state</dt><dd>{connected && typeof live?.radio?.transmitting === "boolean" ? live.radio.transmitting ? "Transmitting (observed)" : "Receiving (observed)" : "Unknown"}</dd></dl>
      <p>Discovery, SmartLink and selectable Flex slice/client binding are unavailable in this provider. A saved model name is a label until the device identity is observed.</p>
      <button type="button" disabled={p.busy} onClick={p.onCheck}>Check connection status</button>
      {p.pending && <button type="button" disabled={p.busy} onClick={p.onReview}>I have reviewed the uncertain outcome</button>}
    </details>
  </div>;
}
