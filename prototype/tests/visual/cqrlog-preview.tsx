// Isolated visual fixture: native IPC fails closed; no worker/store/device I/O.
import React from "react";
import {createRoot} from "react-dom/client";
import {mockIPC} from "@tauri-apps/api/mocks";
import CWDesk from "../../src/live/CWDesk";
import CWSettings from "../../src/live/CWSettings";
import VoiceDesk from "../../src/live/VoiceDesk";
import CountryReferenceControl from "../../src/live/CountryReferenceControl";
import {defaultCWProfile} from "../../src/live/cwMacros";
import type {SharedCWState} from "../../src/live/sharedCWSession";
import "../../src/style.css";
import "../../src/live/live.css";

mockIPC(()=>{throw new Error("Native I/O is disabled in this visual fixture.");});
const requests:unknown[]=[];
const route=(deviceId:string)=>({deviceId,channels:[0],sampleRate:48000});
const voiceProfile={version:1,profilePath:"/isolated-fixture/voice",labels:Array.from({length:10},(_,i)=>`Voice ${i+1}`),
  routes:{input:route("fixture-microphone"),monitor:route("fixture-monitor"),transmit:route("fixture-radio")},
  edits:Array.from({length:10},()=>({trimStartMs:0,trimEndMs:null,gainDb:0}))};
const format={channels:2,minRate:48000,maxRate:48000};
const voiceSnapshot={nativeAvailable:true,profile:voiceProfile,revision:1,generation:crypto.randomUUID(),job:null,last:{},
  devices:[{id:"fixture-microphone",name:"Fixture microphone",inputs:[format],outputs:[],inputRate:48000,outputRate:null,knownTx:false},
    {id:"fixture-monitor",name:"Fixture headphones",inputs:[],outputs:[format],inputRate:null,outputRate:48000,knownTx:false},
    {id:"fixture-radio",name:"Fixture radio audio",inputs:[],outputs:[format],inputRate:null,outputRate:48000,knownTx:true}]};
const profile={...defaultCWProfile,showOnDesk:true,output:"winkeyer" as const,composition:{mode:"word" as const}};
function Fixture(){
  const [state,setState]=React.useState<SharedCWState>({armed:false,pending:false,owner:null,message:"Fixture keyer · disarmed",error:"",revision:1,lease:null,client:"fixture",canonical:{profile,context:{MYCALL:"OM0RX",CALL:"EA8/OM0RX/P",RST:"599"}},
    winkeyer:{phase:"ready",speed_source:"pot",pot_wpm:22,pot_age_ms:300,reported_echo:"CQ",echo_evidence:"uncorrelated-device-report"},
    capabilities:{composition:true,streaming:true,prosigns:true,speedSegments:false}});
  const controller={arm:async()=>setState(s=>({...s,armed:true,lease:"fixture-lease",message:"Fixture arm only · no native I/O"})),
    stop:async()=>setState(s=>({...s,armed:false,lease:null,message:"Fixture stopped · no native I/O"})),acknowledgeStopped:()=>{},
    send:async()=>{requests.push("fixture-macro");},compose:async(request:unknown)=>{requests.push(request);return true;}};
  return <div className="app live" style={{display:"block",height:"auto",minHeight:"100vh",overflow:"visible",padding:16,boxSizing:"border-box"}}><main style={{display:"grid",gap:24,maxWidth:1100,width:"100%",margin:"0 auto",overflow:"visible",boxSizing:"border-box"}}>
    <p role="status">Isolated visual fixture · native, station and production-store I/O disabled</p>
    <section><h2>CW operating desk</h2><CWDesk profile={profile} context={state.canonical!.context} state={state} controller={controller}/></section>
    <section><VoiceDesk request={async params=>{requests.push(params);if(params.action==="snapshot")return structuredClone(voiceSnapshot);if(params.action==="analyze")return {durationMs:4200,peak:0.72,clippedSamples:0,sampleRate:48000};return {status:"fixture-only"};}}/></section>
    <CountryReferenceControl visible request={async(method,params)=>{requests.push({method,params});return {reference_revision:"fixture-revision",provider:"OK1RR normalized derivative",source_revision:"fixture-source",source_version:null,record_count:21335,excluded_count:302,coverage:["current and deleted entities","dated exceptions","declared ambiguity"],rollback_available:true};}}/>
    <CWSettings value={profile} onChange={()=>{}} context={state.canonical!.context}/>
  </main></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
