import { useMemo, useState } from "react";
import { ExternalLink, Play, RefreshCw, Settings2, Square, X } from "lucide-react";
import { cwSourceName, requestCWDecode, type CWCapability, type CWDecodeConfiguration, type CWDecodeSnapshot, type CWIQSource } from "./cwDecode";
import { useCWDecode } from "./useCWDecode";
import "./CWDecodePanel.css";

const stateName = (state: string) => ({ stopped: "Stopped", preparing: "Preparing", acquiring: "Acquiring IQ", running: "Decoding", quarantined: "Waiting for fresh IQ",
  muted: "Muted", recovering: "Recovering", blocked: "Needs attention", stopping: "Stopping", off: "Off", starting: "Starting", listening: "Listening", occupied: "Port occupied", failed: "Unavailable", loop_blocked: "Self-loop blocked" }[state] ?? state);
const mhz = (hz: number) => `${(hz / 1e6).toFixed(6)} MHz`;
const offset = (hz: number) => `${hz >= 0 ? "+" : ""}${(hz / 1000).toFixed(3)} kHz`;

export function CWDecodePanel({ detached = false, onUndock, request = requestCWDecode }: {
  detached?: boolean; onUndock?: () => void; request?: typeof requestCWDecode;
}) {
  const { snapshot, error, busy, refresh, command } = useCWDecode(request);
  const [editor, setEditor] = useState<CWDecodeConfiguration | null>(null), [selected, setSelected] = useState<string | null>(null), [sourceFilter, setSourceFilter] = useState("all");
  const tracks = useMemo(() => [...(snapshot?.tracks ?? [])].filter(track => sourceFilter === "all" || track.sourceID === sourceFilter)
    .sort((a, b) => a.descriptor.radioID.localeCompare(b.descriptor.radioID) || a.sourceID.localeCompare(b.sourceID) || a.offsetHz - b.offsetHz), [snapshot?.tracks, sourceFilter]);
  const signal = snapshot?.tracks.find(track => track.trackID === selected);
  const edit = () => { if (snapshot) setEditor(structuredClone(snapshot.configuration)); };
  const save = async () => {
    if (!editor) return;
    const next = { ...editor, revision: crypto.randomUUID() };
    if (await command("cw_decode_configuration_save", { expected_revision: editor.revision, configuration: next })) setEditor(null);
  };
  const configured = snapshot?.configuration.sources ?? [], active = snapshot?.state !== "stopped";
  const serverActive = snapshot && ["starting", "listening"].includes(snapshot.listener.state);
  return <section className={`cw-decode${detached ? " cw-decode-detached" : ""}`} aria-label="CW Decode">
    <header className="cw-decode-header"><div><h2>CW Decode</h2><p>Local IQ decoding · up to two monitoring spans</p></div>
      <div className="cw-decode-actions">
        <span className={`cw-decode-state state-${snapshot?.state ?? "stopped"}`}>{snapshot ? stateName(snapshot.state) : "Unavailable"}</span>
        <button type="button" className="cw-decode-start" disabled={!snapshot || snapshot.featureEnabled === false || busy || active || !configured.length || !snapshot.resourcesAvailable}
          onClick={() => snapshot && void command("cw_decode_start", { expected_revision: snapshot.configuration.revision })}><Play size={14} />Start decoding</button>
        <button type="button" disabled={!snapshot || !active && !busy} onClick={() => void command("cw_decode_stop")}><Square size={14} />Stop</button>
        <button type="button" disabled={!snapshot || busy} aria-expanded={editor !== null} onClick={edit}><Settings2 size={14} />Sources & server</button>
        {onUndock && <button type="button" onClick={onUndock}><ExternalLink size={14} />Open window</button>}
      </div>
    </header>
    {error && <div className="cw-decode-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}><RefreshCw size={14} />Read state</button></div>}
    {!snapshot ? <div className="cw-decode-empty"><h3>Waiting for the native CW service</h3><p>Open the main xLog window, then read the decoder state. Opening this view does not start capture.</p></div> : <>
      {!snapshot.resourcesAvailable && <p className="cw-decode-notice">The offline decoder is unavailable in this build. Install a complete CW Decode build before starting capture.</p>}
      {snapshot.featureEnabled === false && <p className="cw-decode-notice">CW Decode is disabled in this build while input and release qualification are incomplete.</p>}
      {snapshot.failure && <p className="cw-decode-notice" role="alert">The decoder process is unavailable. Stop decoding, check the offline installation, then start again.</p>}
      {!snapshot.automaticSpotsQualified && <p className="cw-decode-quality">Automatic spots are off while live decoding quality and RF mapping await qualification.</p>}
      {snapshot.spotOutputFailure && <p className="cw-decode-notice" role="alert">A Local CW spot could not be delivered. Check the local cluster history and server state. IQ decoding continues.</p>}
      <div className="cw-decode-sources" aria-label="Monitoring spans">{configured.length ? configured.map(source => {
        const live = snapshot.sources.find(row => row.configuration.id === source.id), capability = snapshot.capabilities.find(row => row.radioID === source.radioID && row.provider === source.provider);
        return <div key={source.id}><strong>{cwSourceName(source)}</strong><span>{live ? stateName(live.state) : "Stopped"}</span>
          <span>{live?.descriptor ? mhz(live.descriptor.centreHz) : "IQ centre unavailable"} · {source.sampleRate / 1000} kHz</span>
          {!capability?.ready && snapshot.featureEnabled !== false && <small>Connect this radio in Radio Settings to receive IQ.</small>}
          {source.provider === "flex_dax_iq" && <FlexHandoff source={source} capability={capability} revision={snapshot.configuration.revision}
            disabled={snapshot.featureEnabled === false || busy || active} command={command} />}
          {live?.failure && <small>{live.retryCount >= 3 ? "Retry limit reached. Stop, check the source, then start again." : `Source interrupted · retry ${live.retryCount} of 3`}</small>}
        </div>;
      }) : <div><strong>No monitoring spans selected</strong><span>Choose one or two IQ sources to begin.</span><button type="button" onClick={edit}>Choose sources</button></div>}</div>
      {editor && <CWDecodeSettings value={editor} snapshot={snapshot} busy={busy} change={setEditor} save={save} close={() => setEditor(null)} />}
      <div className="cw-decode-workspace">
        <div className="cw-decode-signals"><div className="cw-decode-table-bar"><h3>Signals <span>{tracks.length}</span></h3>
          <label>Source<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">All spans</option>
            {configured.map(source => <option key={source.id} value={source.id}>{cwSourceName(source)}</option>)}</select></label></div>
          <div className="cw-decode-table-scroll"><table><thead><tr><th>Source</th><th>RF / offset</th><th>Decoded text</th><th>WPM</th><th>SNR</th><th>State</th></tr></thead>
            <tbody>{tracks.map(track => <tr key={track.trackID} aria-selected={selected === track.trackID}>
              <td><button type="button" onClick={() => setSelected(track.trackID)} aria-label={`Inspect signal ${offset(track.offsetHz)} on ${cwSourceName(track.descriptor)}`}>{cwSourceName(track.descriptor)}</button></td>
              <td className="cw-decode-frequency">{track.frequencyHz === undefined ? offset(track.offsetHz) : mhz(track.frequencyHz)}{track.frequencyHz === undefined && <small>RF unqualified</small>}</td>
              <td className="cw-decode-copy"><span>{track.committed}</span><span className="cw-decode-provisional" aria-label="Provisional text">{track.provisional}</span>{!track.committed && !track.provisional && <span className="cw-decode-placeholder">Waiting for copy</span>}</td>
              <td title="Speed has not been measured">—</td><td title="Signal-to-noise ratio has not been measured">—</td>
              <td>{track.ambiguous ? "Ambiguous" : track.committed ? "Committed + live tail" : "Provisional"}</td>
            </tr>)}</tbody></table></div>
          {!tracks.length && <div className="cw-decode-empty"><h3>{active ? "Listening for CW signals" : "No live signals"}</h3>
            <p>{active ? "Signals appear after clean, continuous IQ and CW keying are detected. Retunes and transmit periods clear old copy." : "Select connected IQ sources and start decoding. The radio's tuning and transmit controls stay with its existing owner."}</p></div>}
        </div>
        {signal && <aside className="cw-decode-detail" aria-label="Selected CW signal"><div className="cw-decode-detail-heading"><h3>Signal detail</h3><button type="button" aria-label="Close signal detail" onClick={() => setSelected(null)}><X size={16} /></button></div>
          <strong className="cw-decode-frequency">{signal.frequencyHz === undefined ? offset(signal.offsetHz) : mhz(signal.frequencyHz)}</strong>
          <p>{cwSourceName(signal.descriptor)}</p><dl><div><dt>IQ centre</dt><dd>{mhz(signal.descriptor.centreHz)}</dd></div><div><dt>Capture epoch</dt><dd>{signal.descriptor.epoch}</dd></div>
            <div><dt>RF mapping</dt><dd>{signal.descriptor.mappingQualified ? "Qualified" : "Unqualified"}</dd></div><div><dt>Model time</dt><dd>{signal.inferenceMilliseconds === undefined ? "Unavailable" : `${signal.inferenceMilliseconds.toFixed(0)} ms`}</dd></div></dl>
          <label>Committed text<textarea readOnly value={signal.committed} rows={5} /></label>
          <label>Provisional tail<textarea readOnly value={signal.provisional} rows={3} /></label>
          <p className="cw-decode-quality">Provisional text can change. Automatic spots require committed station identification and qualified live evidence.</p>
          {signal.spotRejection && <small>Spot withheld: {signal.spotRejection.replaceAll("_", " ")}</small>}
        </aside>}
      </div>
      <footer className="cw-decode-server"><div><strong>Local CW server · {stateName(snapshot.listener.state)}</strong><span>{snapshot.listener.address}:{snapshot.listener.port ?? snapshot.configuration.listenerPort} · {snapshot.listener.authenticatedClients}/{snapshot.listener.clients} clients logged in · {snapshot.listener.retainedSpots} retained spots</span></div>
        <div className="cw-decode-actions"><button type="button" disabled={snapshot.featureEnabled === false || busy || serverActive || !snapshot.configuration.listenerEnabled} onClick={() => void command("cw_decode_listener_start", { expected_revision: snapshot.configuration.revision })}>Start server</button>
          <button type="button" disabled={!serverActive && !busy} onClick={() => void command("cw_decode_listener_stop")}>Stop server</button></div>
      </footer>
    </>}
  </section>;
}

function FlexHandoff({ source, capability, revision, disabled, command }: { source: CWIQSource; capability?: CWCapability; revision: string;
  disabled: boolean; command: ReturnType<typeof useCWDecode>["command"] }) {
  const [acknowledged, setAcknowledged] = useState("");
  const pan = capability?.panadapters?.find(row => row.id === source.receiverID), key = `${revision}:${capability?.inventoryRevision}:${source.id}`;
  if (!capability?.ready) return <small>FLEX IQ requires the direct local radio connection and its acknowledged SmartSDR Station binding.</small>;
  if (!pan || !pan.channel || pan.clientHandle === undefined || pan.clientHandle !== capability.stationHandle || !pan.receiveAntenna || !pan.centreHz)
    return <small>Choose an existing panadapter owned by this Station with an assigned DAX IQ channel, centre and receive antenna.</small>;
  if (capability.handoffPanadapters?.includes(pan.id)) return <small>Handoff ready. Start decoding within 30 seconds.</small>;
  return <div className="cw-decode-handoff"><small>DAX IQ {pan.channel} · {pan.receiveAntenna} · {mhz(pan.centreHz)}{capability.identity ? ` · ${capability.identity.model} ${capability.identity.serial}` : " · radio identity awaits local discovery"}</small>
    <label className="cw-decode-check"><input type="checkbox" disabled={disabled} checked={acknowledged === key}
      onChange={event => setAcknowledged(event.target.checked ? key : "")} />I released DAX IQ {pan.channel} in other apps for this Station.</label>
    <button type="button" disabled={disabled || acknowledged !== key || !capability.inventoryRevision || !capability.transmitStateKnownOff}
      onClick={() => { setAcknowledged(""); void command("cw_decode_flex_handoff", { expected_revision: revision, radio_id: source.radioID,
        panadapter_id: pan.id, inventory_revision: capability.inventoryRevision }); }}>Allow xLog to acquire DAX IQ {pan.channel}</button>
    <small>A known active competitor still blocks acquisition. Stop clears this temporary handoff.</small></div>;
}

function CWDecodeSettings({ value, snapshot, busy, change, save, close }: { value: CWDecodeConfiguration; snapshot: CWDecodeSnapshot; busy: boolean;
  change: (value: CWDecodeConfiguration) => void; save: () => Promise<void>; close: () => void }) {
  const update = (index: number, patch: Partial<CWIQSource>) => change({ ...value, sources: value.sources.map((source, position) => position === index ? { ...source, ...patch } : source) });
  const sourceLocked = snapshot.state !== "stopped", endpointLocked = ["starting", "listening"].includes(snapshot.listener.state), conflict = value.revision !== snapshot.configuration.revision;
  return <section className="cw-decode-settings" aria-label="CW Decode sources and server"><div className="cw-decode-detail-heading"><h3>Sources & server</h3><button type="button" aria-label="Close CW Decode settings" onClick={close}><X size={16} /></button></div>
    {conflict && <p className="cw-decode-notice" role="alert">Settings changed in another window. Close and reopen these settings before saving.</p>}
    {sourceLocked && <p>Stop decoding to change monitoring spans.</p>}
    <fieldset disabled={busy || sourceLocked}><legend>Monitoring spans</legend>{value.sources.map((source, index) => <div className="cw-decode-source-editor" key={source.id}>
      <label>Radio<select value={source.radioID} onChange={event => update(index, { radioID: event.target.value as CWIQSource["radioID"] })}><option value="radio1">Radio 1</option><option value="radio2">Radio 2</option></select></label>
      <label>IQ provider<select value={source.provider} onChange={event => update(index, { provider: event.target.value as CWIQSource["provider"], receiverID: event.target.value === "tci_iq" ? "0" : snapshot.capabilities.find(row => row.radioID === source.radioID && row.provider === "flex_dax_iq")?.panadapters?.[0]?.id ?? "" })}><option value="tci_iq">SunSDR · TCI IQ</option><option value="flex_dax_iq">FLEX · DAX IQ</option></select></label>
      {source.provider === "tci_iq" ? <label>Receiver<select value={source.receiverID} onChange={event => update(index, { receiverID: event.target.value })}><option value="0">RX 1</option><option value="1">RX 2</option></select></label>
        : <label>Existing panadapter<select value={source.receiverID} onChange={event => update(index, { receiverID: event.target.value })}>
          <option value="">Choose an observed panadapter</option>{snapshot.capabilities.find(row => row.radioID === source.radioID && row.provider === "flex_dax_iq")?.panadapters?.map(pan =>
            <option key={pan.id} value={pan.id}>{pan.id} · DAX IQ {pan.channel ?? "unassigned"} · {pan.centreHz ? mhz(pan.centreHz) : "centre unknown"}</option>)}
        </select></label>}
      <label>Sample rate<select value={source.sampleRate} onChange={event => update(index, { sampleRate: Number(event.target.value) })}>{[48000, 96000, 192000].map(rate => <option key={rate} value={rate}>{rate / 1000} kHz</option>)}</select></label>
      <button type="button" onClick={() => change({ ...value, sources: value.sources.filter(item => item.id !== source.id) })}>Remove span {index + 1}</button>
    </div>)}<button type="button" disabled={value.sources.length >= 2} onClick={() => change({ ...value, sources: [...value.sources,
      { id: crypto.randomUUID(), radioID: "radio1", provider: "tci_iq", receiverID: value.sources.some(source => source.radioID === "radio1" && source.receiverID === "0") ? "1" : "0", sampleRate: value.sources.find(source => source.radioID === "radio1" && source.provider === "tci_iq")?.sampleRate ?? 96000 }] })}>Add monitoring span</button>
      <p>TCI receivers on the same radio share one sample rate.</p></fieldset>
    <fieldset disabled={busy || endpointLocked}><legend>Local CW server</legend><label className="cw-decode-check"><input type="checkbox" checked={value.listenerEnabled} onChange={event => change({ ...value, listenerEnabled: event.target.checked })} />Enable the local server</label>
      <label>Loopback port<input type="number" min={1024} max={65535} step={1} value={value.listenerPort} onChange={event => change({ ...value, listenerPort: Number(event.target.value) })} /></label>
      <p>127.0.0.1 only. Accepted Local CW spots are sent to logged-in clients; history is sent on request.</p></fieldset>
    <label className="cw-decode-check"><input type="checkbox" disabled={busy || sourceLocked || !snapshot.automaticSpotsQualified} checked={value.automaticSpots} onChange={event => change({ ...value, automaticSpots: event.target.checked })} />Automatic Local CW spots</label>
    <div className="cw-decode-actions"><button type="button" disabled={busy || conflict} onClick={() => void save()}>Save CW Decode settings</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div>
  </section>;
}
