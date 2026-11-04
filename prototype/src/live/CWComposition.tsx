import { useEffect, useRef, useState } from "react";
import { compileCWMessage, compositionBoundary, describeCWPlan, type CompositionMode } from "./cwMessagePlan";
import type { CWContext } from "./cwMacros";
import type { CWComposeRequest, SharedCWState } from "./sharedCWSession";
import "./CW.css";

type Props = {context: CWContext; state: Partial<SharedCWState>; mode?: CompositionMode; disabled?: boolean;
  compose: (request: CWComposeRequest) => Promise<boolean>; stop: () => Promise<void>};

/** Deliberate local input only. Reopening, paste, IME and changed context never call drain. */
export default function CWComposition({context, state, mode: initialMode = "word", disabled = false, compose, stop}: Props) {
  const [mode, setMode] = useState<CompositionMode>(initialMode), [enabled, setEnabled] = useState(false);
  const [text, setText] = useState(""), [pendingText, setPendingText] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState("");
  const [composing,setComposing]=useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const control = useRef({text:"", enabled:false, staged:false, composing:false, firstWord:true, sending:false, job:crypto.randomUUID(), append:0, epoch:0, alive:true});
  const current = useRef({state,disabled,mode,compose,context}); current.current={state,disabled,mode,compose,context};
  let preview = "";
  try { if (text.trim()) preview = describeCWPlan(compileCWMessage(text, context)); } catch (cause) { preview = cause instanceof Error ? cause.message : String(cause); }
  useEffect(() => { control.current.alive = true; return () => { control.current.alive=false; control.current.epoch++; }; }, []);
  useEffect(() => {
    if (!state.armed || disabled) { control.current.enabled=false; setEnabled(false); control.current.epoch++; }
  }, [state.armed, disabled]);
  useEffect(() => {
    const focus = () => input.current?.focus();
    const flush = () => { if (document.activeElement === input.current) void drain(true); };
    const preview = () => { if (input.current?.closest("details")) input.current.closest("details")!.open=true; input.current?.focus(); };
    window.addEventListener("xlog:cw-compose-focus",focus); window.addEventListener("xlog:cw-compose-send",flush); window.addEventListener("xlog:cw-compose-preview",preview);
    return () => {window.removeEventListener("xlog:cw-compose-focus",focus);window.removeEventListener("xlog:cw-compose-send",flush);window.removeEventListener("xlog:cw-compose-preview",preview);};
  }, []);
  const update = (value:string) => { control.current.text=value; setText(value); };
  const resetJob = () => {control.current.job=crypto.randomUUID();control.current.append=0;control.current.firstWord=true;};
  async function drain(explicit:boolean) {
    const c=control.current, active=current.current;
    if(c.sending || c.composing || active.disabled || !active.state.armed || active.state.pending) return;
    if(!explicit && (!c.enabled || c.staged || active.state.capabilities?.composition!==true))return;
    const live=c.append>0 || !explicit;
    const boundary=explicit?c.text.length:compositionBoundary(c.text,active.mode,c.firstWord);
    if(!boundary && !(explicit && c.append>0))return;
    const source=c.text.slice(0,boundary);
    try {if(source) compileCWMessage(source,active.context,128,live);} catch(cause){setError(String(cause));return;}
    c.sending=true; setBusy(true); setError(""); setPendingText(source); update(c.text.slice(boundary));
    const epoch=c.epoch, job=c.job, append=c.append+1;
    const accepted=await active.compose({jobID:job,appendSequence:append,template:source,live,finish:explicit,inputOrigin:explicit?"explicit-send":"typing"});
    c.sending=false;
    if(!c.alive)return;
    setBusy(false); setPendingText("");
    if(!accepted || epoch!==c.epoch){
      c.enabled=false; c.staged=true; setEnabled(false); setUncertain(source);
      setError("Composition outcome is uncertain. Use Stop and review the accepted text before sending again.");return;
    }
    c.append=append;
    if(source.includes(" "))c.firstWord=false;
    if(explicit){c.staged=false; c.enabled=false;setEnabled(false);resetJob();}
    // Only text committed during this deliberate typing request may continue.
    else if(c.text && c.enabled && !c.staged)void drain(false);
  }
  const halt = async () => {
    const c=control.current; c.epoch++;c.enabled=false;c.staged=true;setEnabled(false);
    await stop(); if(c.alive)resetJob();
  };
  const changeMode = (value:CompositionMode) => {setMode(value);control.current.enabled=false;setEnabled(false);control.current.staged=!!control.current.text;};
  return <details className="cw-composition"><summary>CW workbench</summary>
    <div className="cw-compose-options">
      <label>Typing mode<select value={mode} disabled={busy || control.current.append>0} onChange={e=>changeMode(e.target.value as CompositionMode)}>
        <option value="character">Character</option><option value="word">Word</option><option value="hybrid">First word live, then words</option>
      </select></label>
      <label className="cw-compose-enable"><input type="checkbox" checked={enabled} disabled={disabled || !state.armed || state.capabilities?.composition!==true || busy || control.current.staged}
        onChange={e=>{control.current.enabled=e.target.checked;setEnabled(e.target.checked);}}/>Enable live typing</label>
    </div>
    <label className="cw-compose-entry">Editable text<textarea ref={input} value={text} maxLength={512} rows={2} spellCheck={false} autoCapitalize="characters"
      onPaste={()=>{control.current.staged=true;control.current.enabled=false;setEnabled(false);}}
      onCompositionStart={()=>{control.current.composing=true;setComposing(true);control.current.staged=true;control.current.enabled=false;setEnabled(false);}}
      onCompositionEnd={()=>{control.current.composing=false;setComposing(false);control.current.staged=true;}}
      onChange={event=>{
        const native=event.nativeEvent as InputEvent;
        const value=event.target.value.replace(/\r\n?|\n/g," ");
        const previous=control.current.text;
        update(value);
        const direct=!native.isComposing && ["insertText","insertLineBreak","insertParagraph"].includes(native.inputType) && value.startsWith(previous) && /^[a-zA-Z0-9 /?=+.,-]*$/.test(value);
        if(!direct){control.current.staged=true;return;}
        void drain(false);
      }}/></label>
    <div className="cw-compose-actions"><button type="button" disabled={disabled || !state.armed || !!state.pending || busy || composing || (!text.trim() && control.current.append===0)} onClick={()=>void drain(true)}>Send / finish</button>
      <button type="button" className="cw-stop" onClick={()=>void halt()}>Stop CW</button>
      <button type="button" disabled={busy} onClick={()=>{update("");control.current.staged=false;setError("");}}>Clear compose</button></div>
    {text && <div className="cw-compose-preview"><span>Preview</span><output>{preview}</output></div>}
    {pendingText && <p role="status">Awaiting backend: <samp>{pendingText}</samp></p>}
    {state.composition?.accepted && <p>Backend accepted: <samp>{state.composition.accepted}</samp></p>}
    {uncertain && <p className="cw-error">Uncertain append: <samp>{uncertain}</samp></p>}
    {error && <p className="cw-error" role="alert">{error}</p>}
    <small>{state.capabilities?.composition ? "Only new committed typing streams. Paste, IME and tokens stay staged for Send. Hybrid resets for each new job." : "This output supports staged Send. Live typing needs a qualified append adapter."} Backend acceptance and keyer echo do not prove RF.</small>
  </details>;
}
