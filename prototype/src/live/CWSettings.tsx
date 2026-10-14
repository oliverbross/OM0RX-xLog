import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cwColors, cwOutputLimit, cwShortcuts, cwTokens, defaultCWProfile, expandCWMacro, type CWContext, type CWMacro, type CWProfile } from "./cwMacros";
import type { CWRequest, CWState } from "./cwController";
import "./CW.css";

type Props = { value?: CWProfile | null; saved?: CWProfile | null; onChange: (value: CWProfile) => void; context?: CWContext; request?: CWRequest; state?: CWState; refresh?: () => Promise<void>; radioProvider?: string };
export default function CWSettings({ value, saved, onChange, context = {}, request, state, refresh, radioProvider = "direct_agent" }: Props) {
  const profile = value ?? defaultCWProfile;
  const [selected, setSelected] = useState(profile.macros[0]?.id ?? 1);
  const [consent, setConsent] = useState(false), [checkedStopped, setCheckedStopped] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [ports, setPorts] = useState<string[]>([]);
  const macro = profile.macros.find(item => item.id === selected) ?? profile.macros[0];
  const keyer = profile.winkeyer ?? { port: "", wpm: 20 };
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved ?? defaultCWProfile);
  const live = state?.winkeyer, ownsConnection = Number(live?.generation) > 0;
  useEffect(() => { setConsent(false); }, [keyer.port]);
  useEffect(() => { setCheckedStopped(false); }, [live?.generation, live?.phase, live?.owns_output]);
  const update = (patch: Partial<CWProfile>) => onChange({ ...profile, ...patch });
  const edit = (patch: Partial<CWMacro>) => update({ macros: profile.macros.map(item => item.id === macro?.id ? { ...item, ...patch } : item) });
  let preview = "", previewError = "";
  if (macro) { try { preview = expandCWMacro(macro.text, context, cwOutputLimit(profile.output, radioProvider)); } catch (error) { previewError = error instanceof Error ? error.message : "Preview unavailable."; } }
  const act = async (method: string, params: Record<string, unknown> = {}) => {
    if (!request || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await request(method, params);
      if (method === "winkeyer_ports") setPorts(Array.isArray(result.ports) ? result.ports : []);
      setMessage(method === "winkeyer_connect" ? "Connecting without sending CW. Watch connection status below." : method === "winkeyer_disconnect" ? result.phase === "closing" ? "Stopping and closing. When finished, release the closed session." : "WinKeyer session released." : method === "winkeyer_speed" ? "Speed command accepted; no text sent." : "Port list refreshed; no port was opened.");
      await refresh?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "WinKeyer operation failed."); }
    finally { setBusy(false); }
  };
  return <section className="cw-settings" aria-label="CW macros and output">
    <h2>CW macros</h2><p>Prepare up to 20 messages. Preview and Save never transmit; arm from the Operator Desk when ready.</p>
    <div className="service-fields"><label>CW output<select aria-label="CW output" value={profile.output} onChange={event => update({ output: event.target.value as CWProfile["output"] })}><option value="radio">Active radio · supported CW command</option><option value="winkeyer">Independent WinKeyer</option></select></label>
      <label className="cw-check"><input type="checkbox" checked={profile.showOnDesk} onChange={event => update({ showOnDesk: event.target.checked })} />Show selected macro buttons on Operator Desk</label></div>
    {profile.output === "radio" && <p>Uses only the active radio, with its existing transmit permission and CW capability. No automatic fallback to WinKeyer. Hamlib messages are limited to 80 characters; other supported radios allow 128.</p>}
    {profile.output === "winkeyer" && <div className="cw-connection">
      <div className="service-fields"><label>WinKeyer serial port<input aria-label="WinKeyer serial port" list="cw-ports" value={keyer.port} onChange={event => update({ winkeyer: { ...keyer, port: event.target.value } })} placeholder="/dev/cu.usbserial… or COM3" /><datalist id="cw-ports">{ports.map(port => <option key={port} value={port} />)}</datalist></label>
        <label>WinKeyer speed · WPM<input aria-label="WinKeyer speed WPM" type="number" min={5} max={99} value={keyer.wpm} onChange={event => update({ winkeyer: { ...keyer, wpm: Number(event.target.value) } })} /></label></div>
      <p>WK2 revision 23 / WK3 revisions 30–31 · 1200 baud, 8N2. Connect asserts DTR and clears RTS; driver line changes can affect attached equipment. Original WK1 and other firmware are not enabled.</p>
      <label className="cw-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I have checked the port and understand the control-line changes</label>
      <div className="cw-actions"><button type="button" disabled={busy || !request} onClick={() => void act("winkeyer_ports")}>List ports</button><button type="button" disabled={busy || dirty || !consent || !keyer.port.trim() || ownsConnection || !request} onClick={() => void act("winkeyer_connect", { port: keyer.port, confirm_serial_control: true })}>Connect WinKeyer</button>
        <button type="button" disabled={busy || !ownsConnection || !request} onClick={() => void act("winkeyer_disconnect", { generation: live?.generation, confirm_output_stopped: checkedStopped })}>{live?.phase === "disconnected" || live?.phase === "uncertain" ? "Release closed session" : "Disconnect WinKeyer"}</button>
        <button type="button" disabled={busy || dirty || live?.phase !== "ready" || !request} onClick={() => void act("winkeyer_speed", { generation: live?.generation, wpm: keyer.wpm })}>Apply saved speed</button>
      </div>
      {dirty && <p>Save settings before connecting or applying speed.</p>}
      <p role="status">WinKeyer: {live?.phase ?? "disconnected"}{live?.firmware ? ` · firmware ${live.firmware}` : ""}{live?.error ? ` · ${live.error}` : ""}</p>
      {live?.phase === "uncertain" && live?.owns_output && <label className="cw-check"><input type="checkbox" checked={checkedStopped} onChange={event => setCheckedStopped(event.target.checked)} />I physically checked that the keyer output has stopped</label>}
      {message && <p role="status">{message}</p>}
    </div>}
    <div className="cw-editor">
      <div className="cw-list"><div className="cw-list-heading"><strong>Messages · {profile.macros.length}/20</strong><button type="button" aria-label="Add CW macro" disabled={profile.macros.length >= 20} onClick={() => {
        const id = Array.from({ length: 20 }, (_, i) => i + 1).find(id => !profile.macros.some(item => item.id === id))!;
        update({ macros: [...profile.macros, { id, label: `Macro ${id}`, text: "TU", color: "neutral", shortcut: "", enabled: false, onDesk: false }] }); setSelected(id);
      }}><Plus size={14} /></button></div>
        <div role="tablist" aria-label="CW messages" aria-orientation="vertical">{profile.macros.map((item, index) => <button type="button" role="tab" id={`cw-macro-${item.id}`} aria-selected={item.id === macro?.id} tabIndex={item.id === macro?.id ? 0 : -1} aria-controls="cw-macro-editor" key={item.id} className={`cw-color-${item.color}`} onClick={() => setSelected(item.id)} onKeyDown={event => {
          const next = event.key === "ArrowDown" ? (index + 1) % profile.macros.length : event.key === "ArrowUp" ? (index + profile.macros.length - 1) % profile.macros.length : event.key === "Home" ? 0 : event.key === "End" ? profile.macros.length - 1 : null;
          if (next !== null) { event.preventDefault(); setSelected(profile.macros[next].id); document.getElementById(`cw-macro-${profile.macros[next].id}`)?.focus(); }
        }}><span>{item.label || `Macro ${item.id}`}</span><small>{item.shortcut || (item.enabled ? "No key" : "Disabled")}</small></button>)}</div>
      </div>
      {macro ? <div className="cw-edit-fields" id="cw-macro-editor" role="tabpanel" aria-labelledby={`cw-macro-${macro.id}`}>
        <div className="service-fields"><label>Button label<input aria-label="CW button label" maxLength={24} value={macro.label} onChange={event => edit({ label: event.target.value })} /></label><label>Shortcut<select aria-label="CW shortcut" value={macro.shortcut} onChange={event => edit({ shortcut: event.target.value })}><option value="">Not assigned</option>{cwShortcuts.map(key => <option key={key}>{key}</option>)}</select></label></div>
        <label>Message template<textarea aria-label="CW message template" rows={3} maxLength={512} value={macro.text} onChange={event => edit({ text: event.target.value })} spellCheck={false} /></label>
        <div className="cw-tokens" aria-label="Insert CW placeholder">{cwTokens.map(token => <button type="button" key={token} onClick={() => edit({ text: `${macro.text}${macro.text && !macro.text.endsWith(" ") ? " " : ""}{${token}}` })}>{`{${token}}`}</button>)}</div>
        <div className="cw-options"><label>Colour<select aria-label="CW button colour" value={macro.color} onChange={event => edit({ color: event.target.value as CWMacro["color"] })}>{cwColors.map(color => <option key={color}>{color}</option>)}</select></label><label className="cw-check"><input type="checkbox" checked={macro.enabled} onChange={event => edit({ enabled: event.target.checked })} />Enabled</label><label className="cw-check"><input type="checkbox" checked={macro.onDesk} onChange={event => edit({ onDesk: event.target.checked })} />Desk button</label><button type="button" aria-label={`Remove ${macro.label} macro`} onClick={() => update({ macros: profile.macros.filter(item => item.id !== macro.id) })}><Trash2 size={13} />Remove</button></div>
        <div className="cw-preview"><strong>Preview · no transmission</strong><output aria-label="Expanded CW preview">{previewError || preview}</output><small>Uses the shared new-QSO draft and saved station fields. SERIAL requires the QSO’s sent serial number. Shortcuts pause while typing, in dialogs or outside this window.</small></div>
      </div> : <p>Add a macro to create your first message. Nothing sends until it is saved, enabled and explicitly armed.</p>}
    </div>
  </section>;
}
