// Actual Traditional Desk integration; native IPC/store/device I/O fails closed.
import React from "react";
import {createRoot} from "react-dom/client";
import {mockIPC} from "@tauri-apps/api/mocks";
import OperatorDesk from "../../src/live/OperatorDesk";
import CWDesk from "../../src/live/CWDesk";
import VoiceDesk from "../../src/live/VoiceDesk";
import {defaultCWProfile} from "../../src/live/cwMacros";
import type {SharedCWState} from "../../src/live/sharedCWSession";
import "../../src/style.css";
import "../../src/live/live.css";

mockIPC(()=>{throw new Error("Native I/O is disabled in this visual fixture.");});
const actions:string[]=[];
const route=(deviceId:string)=>({deviceId,channels:[0],sampleRate:48000});
const format={channels:2,minRate:48000,maxRate:48000};
const voiceSnapshot={nativeAvailable:true,revision:1,generation:"fixture-generation",job:null,last:{},
  profile:{version:1,profilePath:"/isolated-fixture/voice",labels:Array.from({length:10},(_,i)=>`Voice ${i+1}`),
    routes:{input:route("fixture-microphone"),monitor:route("fixture-monitor"),transmit:route("fixture-radio")},
    edits:Array.from({length:10},()=>({trimStartMs:0,trimEndMs:null,gainDb:0}))},
  devices:[{id:"fixture-microphone",name:"Fixture microphone",inputs:[format],outputs:[],inputRate:48000,outputRate:null,knownTx:false},
    {id:"fixture-monitor",name:"Fixture headphones",inputs:[],outputs:[format],inputRate:null,outputRate:48000,knownTx:false},
    {id:"fixture-radio",name:"Fixture radio audio",inputs:[],outputs:[format],inputRate:null,outputRate:48000,knownTx:true}]};
const profile={...defaultCWProfile,showOnDesk:true,output:"winkeyer" as const,composition:{mode:"word" as const}};
const initial={id:"isolated-layout-draft",call:"EA8/OM0RX/P",start:new Date().toISOString(),frequencyHz:14250000,band:"20m",mode:"SSB",rstSent:"59",rstReceived:"59",name:"Layout fixture",comment:"Preserve this draft",gridSquare:"IL18",country:"Canary Islands",county:"",potaReference:"",sotaReference:"",iota:"AF-004",wwffReference:"",sigInfo:"",extraFields:{APP_CUSTOM:"retained"}};
function Fixture(){
  const [draft,setDraft]=React.useState<Record<string,any>|null>(initial),[follow,setFollow]=React.useState(false);
  const [state,setState]=React.useState<SharedCWState>({armed:false,pending:false,owner:null,message:"Fixture keyer · disarmed",error:"",revision:1,lease:null,client:"fixture",
    canonical:{profile,context:{MYCALL:"OM0RX",CALL:initial.call,RST:"599"}},
    winkeyer:{phase:"ready",speed_source:"pot",pot_wpm:22,pot_age_ms:300,reported_echo:"CQ",echo_evidence:"uncorrelated-device-report"},
    capabilities:{composition:true,streaming:true,prosigns:true,speedSegments:false}});
  const controller={arm:async()=>{actions.push("cw-arm");setState(s=>({...s,armed:true,lease:"fixture-lease"}));},
    stop:async()=>{actions.push("cw-stop");setState(s=>({...s,armed:false,lease:null}));},acknowledgeStopped:()=>{},
    send:async()=>{throw Error("Output is disabled in this layout fixture.");},compose:async()=>{throw Error("Output is disabled in this layout fixture.");}};
  const cwControls=<><CWDesk profile={profile} context={state.canonical!.context} state={state} controller={controller}/>
    <VoiceDesk request={async params=>{if(params.action==="snapshot")return structuredClone(voiceSnapshot);
      if(params.action==="analyze")return {durationMs:4200,peak:0.72,clippedSamples:0,sampleRate:48000};
      if(params.action==="stop"){actions.push("voice-stop");return {};}
      throw Error("Output/settings writes are disabled in this layout fixture.");}}/></>;
  (window as any).__deskFixture={draft,initial,actions};
  return <div className="app live" style={{display:"block",height:"auto",minHeight:"100vh",overflow:"visible",padding:16,boxSizing:"border-box"}}>
    <main style={{display:"block",width:"100%",minWidth:0,overflow:"visible",boxSizing:"border-box"}}>
      <p role="status">Isolated actual Traditional Desk · native, station and store I/O disabled</p>
      <OperatorDesk draft={draft} setDraft={setDraft} save={()=>actions.push("qso-save")} clear={()=>actions.push("qso-clear")} busy={false}
        automaticStart={false} lookup={{call:initial.call,country:initial.country,gridSquare:initial.gridSquare}} previous={[]}
        request={async()=>({history:{call:initial.call,previous:[],matrix:[]},cells:[]})} refresh={0}
        onEditor={()=>actions.push("full-editor")} onReadRadio={async()=>{actions.push("read-radio");}}
        follow={follow} setFollow={setFollow} rotor={null} autoRotor={false} setAutoRotor={()=>{}} onManualRotor={()=>{}} cwControls={cwControls}/>
      <p>Outer page sentinel: scrolling output controls must use the Active QSO card.</p>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
