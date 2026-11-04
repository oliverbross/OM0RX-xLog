import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Mic, Play, Square } from "lucide-react";
import "./VoiceDesk.css";

type Route={deviceId:string;channels:number[];sampleRate:number};
type Edit={trimStartMs:number;trimEndMs:number|null;gainDb:number};
type Profile={version:1;profilePath:string;labels:string[];routes:{input:Route|null;monitor:Route|null;transmit:Route|null};edits:Edit[]};
type Device={id:string;name:string;inputs:{channels:number;minRate:number;maxRate:number}[];outputs:{channels:number;minRate:number;maxRate:number}[];inputRate:number|null;outputRate:number|null;knownTx:boolean};
type Snapshot={profile:Profile;revision:number;generation:string;devices:Device[];nativeAvailable:boolean;job:null|{actionID:string;kind:string;phase:string;consumedFrames:number;totalFrames:number};last:{status?:string;error?:string}};
type AudioIdentity={sourceSHA256:string;editedPCMSHA256:string;outputPCMSHA256:string};
type Analysis={durationMs:number;peak:number;clippedSamples:number;sampleRate:number;audioIdentity?:AudioIdentity};
type Request=(params:Record<string,unknown>)=>Promise<any>;
const native:Request=params=>invoke("voice_request",{params});
const defaultProfile=():Profile=>({version:1,profilePath:"",labels:Array.from({length:10},(_,i)=>`Voice ${i+1}`),routes:{input:null,monitor:null,transmit:null},edits:Array.from({length:10},()=>({trimStartMs:0,trimEndMs:null,gainDb:0}))});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export default function VoiceDesk({request=native}:{request?:Request}){
  const root=useRef<HTMLDivElement>(null),mounted=useRef(true),running=useRef(false),dirty=useRef(false),editVersion=useRef(0),snapshotRef=useRef<Snapshot|null>(null),editBase=useRef<{revision:number;generation:string}|null>(null);
  const activeRequest=useRef(request),refreshFlight=useRef<{request:Request;promise:Promise<void>}|null>(null);activeRequest.current=request;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[profile,setProfile]=useState<Profile>(defaultProfile),[selected,setSelected]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState("Load a shared WAV folder and review native audio routes before sending."),[error,setError]=useState(""),[analysis,setAnalysis]=useState<Analysis|null>(null),[replace,setReplace]=useState(false);
  const refresh=useCallback(()=>{
    if(activeRequest.current!==request)return Promise.resolve();
    if(refreshFlight.current?.request===request)return refreshFlight.current.promise;
    const promise:Promise<void>=(async()=>{
      const value=await request({action:"snapshot"}) as Snapshot;
      if(!mounted.current||activeRequest.current!==request)return;
      if(!value?.profile||!Array.isArray(value.profile.labels)||value.profile.labels.length!==10||!Array.isArray(value.profile.edits)||value.profile.edits.length!==10||!value.profile.routes||typeof value.profile.profilePath!=="string"||!Array.isArray(value.devices)||typeof value.nativeAvailable!=="boolean")throw Error("Native voice state is unavailable. Reload the desk before preparing audio.");
      snapshotRef.current=value;setSnapshot(value);if(!dirty.current)setProfile(value.profile);
    })().catch(cause=>{if(mounted.current&&activeRequest.current===request)throw cause;})
      .finally(()=>{if(refreshFlight.current?.promise===promise)refreshFlight.current=null;});
    refreshFlight.current={request,promise};return promise;
  },[request]);
  useEffect(()=>{mounted.current=true;void refresh().catch(cause=>setError(String(cause)));const timer=window.setInterval(()=>{if(running.current||snapshotRef.current?.job)void refresh().catch(cause=>setError(String(cause)));},250);
    return()=>{mounted.current=false;window.clearInterval(timer);};},[refresh]);
  const run=async(action:()=>Promise<void>)=>{if(running.current)return;running.current=true;setBusy(true);setError("");try{await action();}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{running.current=false;if(mounted.current){setBusy(false);await refresh().catch(cause=>setError(String(cause)));}}};
  const edit=(next:Profile)=>{if(!dirty.current&&snapshotRef.current)editBase.current={revision:snapshotRef.current.revision,generation:snapshotRef.current.generation};editVersion.current++;dirty.current=true;setProfile(next);setAnalysis(null);};
  const stop=useCallback(async()=>{try{await request({action:"stop"});if(mounted.current){setMessage("Stop requested. The native owner cancels remaining audio and retains any uncertain PTT release.");await refresh();}}catch(cause){if(mounted.current)setError(String(cause));}},[request,refresh]);
  const reviewedScope=()=>{if(!snapshot)throw Error("Reload and review native voice settings first.");return{expectedRevision:snapshot.revision,generation:snapshot.generation};};
  const send=async()=>{
    if(dirty.current){setError("Save or reload voice settings before sending.");return;}
    const reviewedSettings=snapshot;
    if(!reviewedSettings){setError("Reload and review native voice settings before sending.");return;}
    await run(async()=>{const reviewed=analysis?.audioIdentity;const prepared=await request({action:"prepare",slot:selected,intentID:crypto.randomUUID(),expectedRevision:reviewedSettings.revision,generation:reviewedSettings.generation});setAnalysis(prepared);
      if(reviewed&&prepared.audioIdentity&&(reviewed.sourceSHA256!==prepared.audioIdentity.sourceSHA256||reviewed.editedPCMSHA256!==prepared.audioIdentity.editedPCMSHA256))throw Error("The memory changed since its preview. Review the refreshed audio before a new Send.");
      setMessage(`Sending ${profile.labels[selected-1]} through the reviewed native TX route…`);await request({action:"send",actionID:prepared.actionID});setMessage("Voice job ended. Inspect native audio and PTT status; this is not RF confirmation.");});
  };
  const sendRef=useRef(send);sendRef.current=send;
  useEffect(()=>{const sendEvent=()=>{if(root.current?.contains(document.activeElement))void sendRef.current();};const stopEvent=()=>void stop();
    window.addEventListener("xlog:voice-send",sendEvent);window.addEventListener("xlog:voice-stop",stopEvent);return()=>{window.removeEventListener("xlog:voice-send",sendEvent);window.removeEventListener("xlog:voice-stop",stopEvent);};},[stop]);
  useEffect(()=>{let current=true;setAnalysis(null);if(!dirty.current&&snapshot?.profile.profilePath)void request({action:"analyze",slot:selected}).then(value=>{if(mounted.current&&current)setAnalysis(value);}).catch(()=>{});return()=>{current=false;};},[selected,snapshot?.revision,request]);
  const save=()=>run(async()=>{const base=editBase.current,version=editVersion.current;if(!base)throw Error("Load current workspace settings first.");
    const result=await request({action:"save",profile,expectedRevision:base.revision,generation:base.generation,operationID:crypto.randomUUID()});
    if(result.status!=="applied")throw Error("Voice settings changed in another window. Reload and review your retained edits.");
    if(version!==editVersion.current){
      if(editBase.current===base&&result.generation===base.generation&&Number.isSafeInteger(result.revision)&&result.revision>=base.revision)
        editBase.current={revision:result.revision,generation:base.generation};
      setMessage("Earlier voice settings saved. Newer edits remain unsaved.");return;
    }
    dirty.current=false;editBase.current=null;setMessage("Voice library and route intent saved. Saving starts no audio or PTT.");});
  const changeRoute=(role:keyof Profile["routes"],patch:Partial<Route>|null)=>{
    const current=profile.routes[role];const next=patch===null?null:{deviceId:"",channels:[0],sampleRate:48000,...current,...patch};edit({...profile,routes:{...profile.routes,[role]:next}});
  };
  const routeEditor=(role:keyof Profile["routes"],label:string)=>{
    const route=profile.routes[role],input=role==="input",devices=(snapshot?.devices??[]).filter(d=>(input?d.inputs:d.outputs).length>0),chosen=devices.find(d=>d.id===route?.deviceId);
    return <fieldset className="voice-route"><legend>{label}</legend><label>Native device<select value={route?.deviceId??""} onChange={e=>{const d=devices.find(d=>d.id===e.target.value);changeRoute(role,d?{deviceId:d.id,channels:[0],sampleRate:(input?d.inputRate:d.outputRate)??48000}:null);}}><option value="">Choose device…</option>{route&&!chosen&&<option value={route.deviceId}>Missing selected device</option>}{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Channels (1-based)<input disabled={!route} value={route?.channels.map(c=>c+1).join(",")??""} placeholder="1 or 1,2" onChange={e=>{const text=e.target.value;const values=text.split(",").map(v=>Number(v.trim())-1);changeRoute(role,{channels:values});}}/></label>
      <label>Sample rate<input disabled={!route} type="number" min="8000" max="192000" step="1" value={route?.sampleRate??48000} onChange={e=>changeRoute(role,{sampleRate:Number(e.target.value)})}/></label>
      {route&&!chosen&&<small role="status">The saved device is unavailable; no default device will be substituted.</small>}
    </fieldset>;
  };
  const currentEdit=profile.edits[selected-1];const updateEdit=(patch:Partial<Edit>)=>edit({...profile,edits:profile.edits.map((value,i)=>i===selected-1?{...value,...patch}:value)});
  const hasJob=!!snapshot?.job;const enabled=!!snapshot?.nativeAvailable;
  return <div className="voice-desk" ref={root}>
    <details><summary>Voice memories · normal SSB</summary>
      <div className="voice-controls" role="group" aria-label="Voice memory controls">
        <label>Memory<select value={selected} disabled={busy||hasJob} onChange={e=>setSelected(Number(e.target.value))}>{profile.labels.map((label,i)=><option key={i} value={i+1}>{i+1} · {label}</option>)}</select></label>
        <button type="button" disabled={!enabled||busy||hasJob||dirty.current||!profile.routes.transmit} onClick={()=>void send()}><Play size={13}/>Send memory</button>
        <button type="button" className="voice-stop" onClick={()=>void stop()}><Square size={13}/>Stop voice</button>
        <button type="button" disabled={!enabled||busy||hasJob||dirty.current||!profile.routes.monitor} onClick={()=>void run(async()=>{await request({action:"preview",slot:selected,...reviewedScope()});setMessage("Monitor preview completed without PTT.");})}>Preview on monitor</button>
      </div>
      <p className={error?"voice-error":"voice-state"} role="status">{error||(!enabled&&snapshot?"Native voice routes are available on macOS in this release. Existing contest playback on other platforms is unchanged.":hasJob?`${snapshot.job!.kind} · ${snapshot.job!.phase} · ${snapshot.job!.consumedFrames}/${snapshot.job!.totalFrames} local frames consumed`:snapshot?.last?.error||message)}</p>
      {analysis&&<p className={analysis.clippedSamples?"voice-warning":"voice-state"}>{(analysis.durationMs/1000).toFixed(2)} s · peak {(analysis.peak*100).toFixed(1)}%{analysis.clippedSamples?` · ${analysis.clippedSamples} clipped samples — lower gain to avoid clipping`:" · no clipping"}</p>}
      <details className="voice-settings"><summary>Library, recording and audio routes</summary>
        <p className="voice-state">Shared F1–F10 WAVs are Voice 1–10 here; contest mappings and F11/F12 remain intact. WAVs stay in the selected external folder; keep that folder with your backups.</p>
        <label className="voice-folder">Shared WAV folder<input value={profile.profilePath} onChange={e=>edit({...profile,profilePath:e.target.value})}/><button type="button" disabled={busy} onClick={()=>void run(async()=>{const path=await invoke<string|null>("contest_voice_profile_pick");if(path)edit({...profile,profilePath:path});})}><FolderOpen size={13}/>Choose folder</button></label>
        <div className="voice-routes">{routeEditor("input","Microphone")}{routeEditor("monitor","Monitor only")}{routeEditor("transmit","Transmitter audio")}</div>
        <p className="voice-state">Review the physical cabling and selected channels. Monitor and transmitter channels must be separate. Legacy browser device IDs are retained in contest settings and are never guessed as native routes.</p>
        <div className="voice-edit-fields"><label>Memory label<input maxLength={40} value={profile.labels[selected-1]} onChange={e=>edit({...profile,labels:profile.labels.map((label,i)=>i===selected-1?e.target.value:label)})}/></label>
          <label>Trim start (ms)<input type="number" min="0" max="59999" value={currentEdit.trimStartMs} onChange={e=>updateEdit({trimStartMs:Number(e.target.value)})}/></label>
          <label>Trim end (ms, blank = end)<input type="number" min="1" max="60000" value={currentEdit.trimEndMs??""} onChange={e=>updateEdit({trimEndMs:e.target.value===""?null:Number(e.target.value)})}/></label>
          <label>Gain (dB)<input type="number" min="-24" max="12" step="0.5" value={currentEdit.gainDb} onChange={e=>updateEdit({gainDb:Number(e.target.value)})}/></label>
        </div>
        <div className="voice-controls"><button type="button" disabled={busy||!snapshot||!dirty.current} onClick={()=>void save()}>Save voice settings</button><button type="button" disabled={busy} onClick={()=>{dirty.current=false;editBase.current=null;void refresh().then(()=>setMessage("Saved voice settings loaded.")).catch(cause=>setError(String(cause)));}}>Reload saved</button>
          <label className="voice-replace"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Replace selected slot</label>
          <button type="button" disabled={!enabled||busy||hasJob||dirty.current||!profile.routes.input||!profile.profilePath} onClick={()=>void run(async()=>{setMessage("Recording the selected microphone. Use Finish recording to save, or Stop voice to cancel.");await request({action:"record_start",slot:selected,overwrite:replace,...reviewedScope()});setMessage("Voice recording saved; original editing source retained by nondestructive trim/gain.");})}><Mic size={13}/>Record microphone</button>
          <button type="button" disabled={snapshot?.job?.kind!=="recording"} onClick={()=>void request({action:"record_stop",actionID:snapshot?.job?.actionID}).catch(cause=>setError(String(cause)))}>Finish recording</button>
          <label className="voice-import">Import PCM WAV<input type="file" accept=".wav,audio/wav" disabled={busy||hasJob||dirty.current||!profile.profilePath} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void run(async()=>{const scope=reviewedScope();if(file.size>8*1024*1024)throw Error("Voice WAV must remain below 8 MiB.");const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));await request({action:"import",slot:selected,wavBase64:btoa(binary),overwrite:replace,...scope});setMessage("Voice WAV imported after native PCM validation.");});}}/></label>
        </div>
      </details>
    </details>
  </div>;
}
