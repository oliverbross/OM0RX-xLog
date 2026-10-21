import { invoke } from "@tauri-apps/api/core";
import { pttSession } from "../live/pttSession";

export type ContestVoiceOrigin = { sessionID:string; workspaceGeneration:string; draftID:string; sourceRevision:string };
export type ContestVoiceAction = { actionID:string; sessionID:string; workspaceGeneration?:string; draftID:string; sourceRevision?:string;
  kind:string; signal:string; mode:string; payload:string; payloadSHA256:string };
type PreparedSegment = { name:string; wavBase64:string; durationMs:number };
type PreparedVoice = { sessionID:string; workspaceGeneration:string; draftID:string; actionID:string; payloadSHA256:string;
  segments:PreparedSegment[]; totalDurationMs:number };
type VoiceNative = (params:Record<string,unknown>)=>Promise<PreparedVoice>;
type VoicePTT = { set:(enabled:boolean,provider?:"direct_agent"|"direct_flex_lan")=>Promise<{accepted:boolean;confirmed:boolean}>;
  refresh?:()=>Promise<void>; getSnapshot?:()=>{releaseRequired:unknown} };
type VoiceAudio = Pick<HTMLAudioElement,"addEventListener"|"removeEventListener"|"load"|"pause"|"play"> & {
  src:string; preload:string; setSinkId?:(deviceID:string)=>Promise<void> };
type AudioFactory = (url:string)=>VoiceAudio;

const native:VoiceNative=params=>invoke("contest_voice_prepare",{params});
const audioFactory:AudioFactory=url=>new Audio(url);
const uuidIndex=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:[0-9]|1[01])$/i;

export class ContestVoiceStopped extends Error {
  constructor(){super("Contest phone output was stopped.");this.name="ContestVoiceStopped";}
}

function abortError(signal:AbortSignal){return signal.aborted?new ContestVoiceStopped():new Error("The selected voice audio device stopped playback.");}

function waitFor(audio:VoiceAudio,event:string,signal:AbortSignal,timeoutMs?:number):Promise<void>{
  if(signal.aborted)return Promise.reject(new ContestVoiceStopped());
  return new Promise((resolve,reject)=>{
    let timer=0;
    const cleanup=()=>{audio.removeEventListener(event,success);audio.removeEventListener("error",failure);signal.removeEventListener("abort",failure);if(timer)globalThis.clearTimeout(timer);};
    const success=()=>{cleanup();resolve();};
    const failure=()=>{cleanup();reject(abortError(signal));};
    audio.addEventListener(event,success,{once:true});audio.addEventListener("error",failure,{once:true});signal.addEventListener("abort",failure,{once:true});
    if(timeoutMs)timer=globalThis.setTimeout(()=>{cleanup();reject(new Error("The selected voice audio device did not become ready."));},timeoutMs) as unknown as number;
  });
}

function wavURL(base64:string,create:(blob:Blob)=>string):string{
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error("Native voice WAV data is invalid.");
  const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let index=0;index<raw.length;index+=1)bytes[index]=raw.charCodeAt(index);
  return create(new Blob([bytes],{type:"audio/wav"}));
}

export class ContestVoiceOutput {
  private controller:AbortController|null=null;
  private activeAudio:VoiceAudio|null=null;
  private release:Promise<void>|null=null;
  private pttActive=false;
  private consumed:string[]=[];
  constructor(private readonly production:boolean,private readonly request:VoiceNative=native,private readonly ptt:VoicePTT=pttSession(),
    private readonly makeAudio:AudioFactory=audioFactory,private readonly createURL=(blob:Blob)=>URL.createObjectURL(blob),
    private readonly revokeURL=(url:string)=>URL.revokeObjectURL(url)){}

  async play(actions:ContestVoiceAction[],origin:ContestVoiceOrigin,profilePath:string,deviceID:string,external?:AbortSignal):Promise<void>{
    if(!this.production)throw new Error("Contest phone audio and PTT are disabled in the Contesting Test profile.");
    if(this.controller)throw new Error("Contest phone output is already active. Use Stop before sending another message.");
    if(!profilePath.trim())throw new Error("Choose a voice WAV profile folder in Contest Sound settings before arming phone output.");
    if(!actions.length||actions.length>12)throw new Error("Invalid contest voice action batch.");
    const ids=new Set<string>();
    for(const action of actions){
      if(!uuidIndex.test(action.actionID)||ids.has(action.actionID)||this.consumed.includes(action.actionID)||action.sessionID!==origin.sessionID||
        action.workspaceGeneration!==origin.workspaceGeneration||action.draftID!==origin.draftID||action.sourceRevision!==origin.sourceRevision||
        action.kind!=="voice_keyer"||action.signal!=="phone"||action.mode!=="SSB"||typeof action.payload!=="string"||
        !/^[0-9a-f]{64}$/.test(action.payloadSHA256))throw new Error("The contest voice action is stale, replayed, or invalid; no audio or PTT action was taken.");
      ids.add(action.actionID);
    }
    const controller=new AbortController();this.controller=controller;
    const stopped=()=>controller.abort();external?.addEventListener("abort",stopped,{once:true});
    const urls:string[]=[];const audio:VoiceAudio[]=[];
    try{
      const prepared=await Promise.all(actions.map(action=>this.request({schemaVersion:1,sessionID:origin.sessionID,
        workspaceGeneration:origin.workspaceGeneration,draftID:origin.draftID,actionID:action.actionID,payload:action.payload,
        payloadSHA256:action.payloadSHA256,profilePath})));
      let durationMs=0;
      for(let index=0;index<prepared.length;index+=1){
        const value=prepared[index],action=actions[index];
        if(value.sessionID!==origin.sessionID||value.workspaceGeneration!==origin.workspaceGeneration||value.draftID!==origin.draftID||
          value.actionID!==action.actionID||value.payloadSHA256!==action.payloadSHA256||!Array.isArray(value.segments)||!value.segments.length||
          !Number.isSafeInteger(value.totalDurationMs)||value.totalDurationMs<1)throw new Error("Native voice preparation identity was lost; no PTT action was taken.");
        durationMs+=value.totalDurationMs;
        for(const segment of value.segments){
          const url=wavURL(segment.wavBase64,this.createURL);urls.push(url);const item=this.makeAudio(url);item.preload="auto";
          if(deviceID){if(typeof item.setSinkId!=="function")throw new Error("This runtime cannot route voice audio to the selected output device.");await item.setSinkId(deviceID);}
          const ready=waitFor(item,"canplaythrough",controller.signal,10_000);item.src=url;item.load();await ready;audio.push(item);
        }
      }
      this.consumed=[...this.consumed,...ids].slice(-256);
      if(controller.signal.aborted)throw new ContestVoiceStopped();
      let keyed:{accepted:boolean;confirmed:boolean};
      try{keyed=await this.ptt.set(true);}
      catch(cause){
        try{await this.ptt.refresh?.();if(this.ptt.getSnapshot?.().releaseRequired)this.pttActive=true;}catch{/* retained receipt remains authoritative */}
        throw cause;
      }
      if(!keyed.accepted)throw new Error("Native PTT did not admit contest phone output.");this.pttActive=true;
      const watchdog=globalThis.setTimeout(()=>controller.abort(),Math.min(125_000,durationMs+5_000));
      try{
        for(const item of audio){
          if(controller.signal.aborted)throw new ContestVoiceStopped();this.activeAudio=item;
          const ended=waitFor(item,"ended",controller.signal);await item.play();await ended;
        }
      }finally{globalThis.clearTimeout(watchdog);}
    }finally{
      external?.removeEventListener("abort",stopped);this.activeAudio?.pause();this.activeAudio=null;
      const releaseError=await this.releasePTT();
      for(const url of urls)this.revokeURL(url);if(this.controller===controller)this.controller=null;
      if(releaseError)throw releaseError;
    }
  }

  async stop():Promise<void>{this.controller?.abort();this.activeAudio?.pause();const error=await this.releasePTT();if(error)throw error;}

  private async releasePTT():Promise<Error|null>{
    if(!this.pttActive)return null;
    if(!this.release)this.release=(async()=>{try{const released=await this.ptt.set(false);if(!released.accepted||!released.confirmed)throw new Error("Native PTT off lacks fresh RX confirmation; inspect the retained PTT receipt.");this.pttActive=false;}finally{this.release=null;}})();
    try{await this.release;return null;}catch(cause){return cause instanceof Error?cause:new Error("Native PTT release failed; inspect the retained PTT receipt.");}
  }
}
