import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { cwOutputLimit, defaultCWProfile, expandCWMacro, type CWContext, type CWMacro, type CWProfile } from "./cwMacros";
import type { CWController, CWState } from "./cwController";
import "./CW.css";

export default function CWDesk({ profile = defaultCWProfile, context, controller, state, radioProvider = "direct_agent" }: { profile?: CWProfile; context: CWContext; controller: CWController; state: CWState; radioProvider?: string }) {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setConfirmed(false); }, [state.owner, state.error]);
  useEffect(() => { if (!ref.current) return; const resize = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); resize.observe(ref.current); return () => resize.disconnect(); }, []);
  const chosen = profile.showOnDesk ? profile.macros.filter(item => item.enabled && item.onDesk) : [];
  const visible = Math.max(0, Math.min(chosen.length, Math.floor((width - 290) / 140)));
  const blocked = !state.armed || state.pending || profile.output === "winkeyer" && !!state.owner;
  const preview = (macro: CWMacro) => { try { return expandCWMacro(macro.text, context, cwOutputLimit(profile.output, radioProvider)); } catch (error) { return error instanceof Error ? error.message : "Preview unavailable"; } };
  return <div className="cw-desk" ref={ref}>
    <div className="cw-desk-row" role="group" aria-label="CW macro controls">
      <button type="button" className={state.armed ? "cw-armed" : ""} disabled={state.pending || !!state.owner && !state.armed} aria-pressed={state.armed} onClick={() => state.armed ? void controller.stop() : void controller.arm()}>{state.armed ? "Disarm CW" : "Arm CW"}</button>
      <button type="button" className="cw-stop" disabled={!state.armed && !state.owner && !state.pending} onClick={() => void controller.stop()}><Square size={12} />Stop</button>
      {chosen.slice(0, visible).map(macro => <button type="button" className={`cw-macro cw-color-${macro.color}`} key={macro.id} disabled={blocked} title={`${macro.label}: ${preview(macro)}`} onClick={() => void controller.send(macro, context)}><span>{macro.label}</span>{macro.shortcut && <kbd>{macro.shortcut}</kbd>}</button>)}
      {chosen.length > visible && <select aria-label="More CW macros — select to send" value="" disabled={blocked} onChange={event => { const macro = chosen.find(item => item.id === Number(event.target.value)); if (macro) void controller.send(macro, context); }}><option value="">More macros · {chosen.length - visible}</option>{chosen.slice(visible).map(macro => <option key={macro.id} value={macro.id}>{macro.label}{macro.shortcut ? ` · ${macro.shortcut}` : ""}</option>)}</select>}
      {!chosen.length && <span className="cw-key-only">CW shortcuts</span>}
    </div>
    <p className={state.error ? "cw-error" : "cw-state"} role="status">{state.error || state.message}</p>
    {state.error && state.owner && <div className="cw-recovery"><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I physically checked that CW has stopped</label><button type="button" disabled={!confirmed || state.pending} onClick={() => { controller.acknowledgeStopped(); setConfirmed(false); }}>Release CW guard</button></div>}
  </div>;
}
