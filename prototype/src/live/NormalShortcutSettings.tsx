import {useEffect,useRef,useState} from "react";
import {workerRequest} from "../worker";
import {normalActions,checkedBindings,bindingFor,bindingConflict,chordForEvent,defaultNormalBindings,displayChord,setNormalBindings,type NormalAction,type NormalBindings} from "./normalCommands";
import {invoke} from "@tauri-apps/api/core";
type Snapshot={normalCommandBindingsWarning?:string|null;generation:string;revision:number;preferences:{normalCommandBindings?:NormalBindings}};
async function load(){const response=await workerRequest("workspace_preferences_load");if(!response.ok)throw new Error("Shortcuts unavailable");return response.result as Snapshot;}
export function NormalShortcutSettings(){
  const [base,setBase]=useState<Snapshot|null>(null),[draft,setDraft]=useState<NormalBindings>(defaultNormalBindings),[search,setSearch]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const capturing=useRef<NormalAction|null>(null),captureEpoch=useRef(0),captureQueue=useRef<Promise<unknown>>(Promise.resolve());
  const mounted=useRef(true),captureTarget=useRef<NormalAction|null>(null),captureInputs=useRef(new Map<NormalAction,HTMLInputElement>());
  const [captureState,setCaptureState]=useState<{id:NormalAction;phase:"pending"|"ready"}|null>(null);
  const nativeCapture=(active:boolean)=>{
    const requestId=crypto.randomUUID();
    const operation=captureQueue.current.catch(()=>{}).then(()=>invoke<{active:boolean;requestId:string}>("normal_shortcut_capture",{active,requestId}));
    captureQueue.current=operation;
    return operation.then(reply=>{
      if(reply?.active!==active||reply.requestId!==requestId)throw new Error("Native shortcut capture acknowledgement could not be verified.");
    });
  };
  const stopCapture=(id?:NormalAction)=>{
    if(id&&captureTarget.current!==id)return;
    captureEpoch.current++;captureTarget.current=null;capturing.current=null;
    document.documentElement.removeAttribute("data-shortcut-capture");
    if(mounted.current)setCaptureState(null);
    void nativeCapture(false).catch(cause=>{if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));});
  };
  const startCapture=async(id:NormalAction)=>{
    const epoch=++captureEpoch.current;captureTarget.current=id;capturing.current=null;
    setCaptureState({id,phase:"pending"});setError("");setMessage("");
    document.documentElement.dataset.shortcutCapture="true";
    try{
      await nativeCapture(true);
      if(!mounted.current||captureEpoch.current!==epoch||captureTarget.current!==id)return;
      capturing.current=id;setCaptureState({id,phase:"ready"});
    }catch(cause){
      if(!mounted.current||captureEpoch.current!==epoch)return;
      captureTarget.current=null;capturing.current=null;setCaptureState(null);
      document.documentElement.removeAttribute("data-shortcut-capture");
      setError(cause instanceof Error?cause.message:String(cause));
      void nativeCapture(false).catch(()=>{});
    }
  };
  useEffect(()=>{if(captureState?.phase==="ready")captureInputs.current.get(captureState.id)?.focus();},[captureState]);
  useEffect(()=>{mounted.current=true;let active=true;void load().then(value=>{if(!active)return;setBase(value);const checked=checkedBindings(value.preferences.normalCommandBindings);setDraft(checked.bindings);setError([value.normalCommandBindingsWarning,...checked.warnings].filter(Boolean).join(" "));}).catch(cause=>{if(active)setError(String(cause));});
    return()=>{active=false;mounted.current=false;captureEpoch.current++;captureTarget.current=null;capturing.current=null;
      document.documentElement.removeAttribute("data-shortcut-capture");void nativeCapture(false).catch(()=>{});};},[]);
  const assign=(id:NormalAction,chord:string)=>{const conflict=bindingConflict(id,chord,draft);if(conflict){setError(conflict);return;}setError("");setMessage("");setDraft({...draft,overrides:{...draft.overrides,[id]:chord}});};
  const save=async()=>{if(!base||busy)return;setBusy(true);setError("");try{
    for(const action of normalActions){const conflict=bindingConflict(action.id,bindingFor(action.id,draft),draft);if(conflict)throw new Error(conflict);}
    const response=await workerRequest("workspace_commands_apply",{generation:base.generation,expectedRevision:base.revision,bindings:draft});
    if(!response.ok)throw new Error("Shortcuts could not be saved.");
    const next=response.result as Snapshot&{status:string};
    if(next.status!=="applied"){setBase(next);throw new Error("Another window changed workspace preferences. Your attempted shortcuts are retained; review and Save again.");}
    setBase(next);setNormalBindings(draft,{generation:next.generation,revision:next.revision});setMessage("Shortcuts saved. Other windows reload on focus.");
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  const unknown=Object.keys(draft.overrides).filter(id=>!normalActions.some(action=>action.id===id));
  return <section aria-label="Normal Logging shortcuts"><h2>Normal Logging shortcuts</h2>
    <p>Application shortcuts act only in Normal Logging. Save and callsign actions require the focused live QSO editor. Fixed native navigation (Command/Ctrl + 1–4, L), Escape/Stop, function keys, CW macros and contest keys retain their owners.</p>
    <label>Find command<input value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <table><thead><tr><th>Command / context</th><th>Effective binding</th><th>Default</th><th>Capture / reset</th></tr></thead><tbody>
      {normalActions.filter(action=>action.label.toLowerCase().includes(search.toLowerCase())).map(action=><tr key={action.id}><th scope="row">{action.label}<small> · {action.context}</small></th><td>{displayChord(bindingFor(action.id,draft))}</td><td>{displayChord(action.defaultBinding)}</td><td>
        <button type="button" onClick={()=>void startCapture(action.id)} onBlur={()=>{if(captureTarget.current===action.id&&capturing.current===null)stopCapture(action.id);}}>Start capture {action.label}</button>
        <input readOnly ref={node=>{if(node)captureInputs.current.set(action.id,node);else captureInputs.current.delete(action.id);}}
          disabled={captureState?.id!==action.id||captureState?.phase!=="ready"} aria-label={`Capture ${action.label}`} placeholder="Start capture, then press chord" onBlur={()=>stopCapture(action.id)}
          onKeyDown={event=>{if(capturing.current!==action.id||event.key==="Escape"||event.key==="Tab")return;event.preventDefault();event.stopPropagation();const chord=chordForEvent(event.nativeEvent);if(chord)assign(action.id,chord);else setError("This key is reserved or cannot form a normal command shortcut.");}}/>
        <button type="button" onClick={()=>assign(action.id,"")}>Unbind</button><button type="button" onClick={()=>{const overrides={...draft.overrides};delete overrides[action.id];setDraft({...draft,overrides});}}>Reset</button>
      </td></tr>)}
    </tbody></table>
    {!!unknown.length&&<p>Unavailable actions preserved from another version: {unknown.join(", ")}</p>}
    <button type="button" onClick={()=>setDraft({version:1,overrides:Object.fromEntries(unknown.map(id=>[id,draft.overrides[id]]))})}>Reset all supported actions</button>
    <button type="button" disabled={!base||busy} onClick={()=>void save()}>Save shortcuts</button>
    {captureState&&<p role="status">{captureState.phase==="pending"?"Preparing native capture — wait for confirmation.":"Recording shortcut. Press a supported chord; Tab leaves capture."}</p>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
