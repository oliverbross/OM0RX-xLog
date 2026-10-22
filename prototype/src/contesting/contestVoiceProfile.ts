import { invoke } from "@tauri-apps/api/core";

export type ContestVoiceProfileSlot = { slot:string; present:boolean; durationMs:number|null; decodedBytes:number|null;
  sha256:string|null; error:string|null };
export type ContestVoiceProfileManifest = { slots:ContestVoiceProfileSlot[] };
export type ContestVoiceProfilePreview = { slot:string; wavBase64:string; durationMs:number; decodedBytes:number; sha256:string };
type NativeInvoke = <T>(command:string,args?:Record<string,unknown>)=>Promise<T>;

const native:NativeInvoke=(command,args)=>invoke(command,args);
const MAX_WAV_BYTES=8*1_024*1_024;
const MAX_PCM_SAMPLES=(MAX_WAV_BYTES-44)/2;

export function contestVoiceRecordingLimitMs(sampleRate:number):number{
  if(!Number.isFinite(sampleRate)||sampleRate<=0)return 0;
  return Math.min(60_000,Math.floor(MAX_PCM_SAMPLES/sampleRate*1_000));
}

export const inspectContestVoiceProfile=(profilePath:string,request:NativeInvoke=native):Promise<ContestVoiceProfileManifest>=>
  request("contest_voice_profile_manifest",{params:{profilePath}});
export const pickContestVoiceProfile=(request:NativeInvoke=native):Promise<string|null>=>request("contest_voice_profile_pick");
export const saveContestVoiceSlot=(profilePath:string,slot:string,wav:Uint8Array,overwrite:boolean,request:NativeInvoke=native)=>
  request<ContestVoiceProfilePreview>("contest_voice_profile_write",{params:{profilePath,slot,wavBase64:bytesBase64(wav),overwrite}});
export const loadContestVoiceSlot=(profilePath:string,slot:string,request:NativeInvoke=native)=>
  request<ContestVoiceProfilePreview>("contest_voice_profile_preview",{params:{profilePath,slot}});

export function encodePCM16Mono(chunks:Float32Array[],sampleRate:number):Uint8Array{
  if(!Number.isInteger(sampleRate)||sampleRate<8_000||sampleRate>192_000)throw new Error("Microphone sample rate is outside the supported PCM WAV range.");
  const samples=chunks.reduce((sum,chunk)=>sum+chunk.length,0),bytes=44+samples*2;
  if(!samples||bytes>MAX_WAV_BYTES)throw new Error("Recording must contain audio and remain below the 8 MiB WAV limit.");
  const wav=new Uint8Array(bytes),view=new DataView(wav.buffer),write=(offset:number,value:string)=>{
    for(let index=0;index<value.length;index+=1)wav[offset+index]=value.charCodeAt(index);
  };
  write(0,"RIFF");view.setUint32(4,bytes-8,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,samples*2,true);
  let offset=44;for(const chunk of chunks)for(const value of chunk){const bounded=Math.max(-1,Math.min(1,value));
    view.setInt16(offset,bounded<0?Math.round(bounded*32768):Math.round(bounded*32767),true);offset+=2;}
  return wav;
}

export class ContestVoiceRecorder{
  private chunks:Float32Array[]=[];private context:AudioContext|null=null;private stream:MediaStream|null=null;
  private source:MediaStreamAudioSourceNode|null=null;private processor:ScriptProcessorNode|null=null;private remainingSamples=MAX_PCM_SAMPLES;private cancelled=false;
  async start(deviceID:string):Promise<number>{
    if(this.context)throw new Error("A voice recording is already active.");
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone recording is unavailable in this runtime.");
    const AudioContextClass=globalThis.AudioContext;if(!AudioContextClass)throw new Error("PCM audio capture is unavailable in this runtime.");
    this.cancelled=false;this.stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceID?{exact:deviceID}:undefined,channelCount:1,
      echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    if(this.cancelled){this.stream.getTracks().forEach(track=>track.stop());this.stream=null;throw new Error("Voice recording was cancelled.");}
    this.context=new AudioContextClass();this.source=this.context.createMediaStreamSource(this.stream);
    this.remainingSamples=MAX_PCM_SAMPLES;this.processor=this.context.createScriptProcessor(4096,1,1);this.processor.onaudioprocess=event=>{
      const input=event.inputBuffer.getChannelData(0),length=Math.min(input.length,this.remainingSamples);
      if(length>0){this.chunks.push(Float32Array.from(input.subarray(0,length)));this.remainingSamples-=length;}event.outputBuffer.getChannelData(0).fill(0);
    };
    this.source.connect(this.processor);this.processor.connect(this.context.destination);
    return contestVoiceRecordingLimitMs(this.context.sampleRate);
  }
  async stop():Promise<Uint8Array>{
    if(!this.context)throw new Error("No voice recording is active.");
    const rate=this.context.sampleRate;this.processor?.disconnect();this.source?.disconnect();this.stream?.getTracks().forEach(track=>track.stop());
    await this.context.close();this.context=null;this.stream=null;this.source=null;this.processor=null;
    const chunks=this.chunks;this.chunks=[];return encodePCM16Mono(chunks,rate);
  }
  cancel():void{this.cancelled=true;this.processor?.disconnect();this.source?.disconnect();this.stream?.getTracks().forEach(track=>track.stop());
    void this.context?.close();this.context=null;this.stream=null;this.source=null;this.processor=null;this.chunks=[];this.remainingSamples=MAX_PCM_SAMPLES;}
}

export async function previewContestVoiceSlot(profilePath:string,slot:string,deviceID:string,request:NativeInvoke=native,
  makeAudio=(url:string)=>new Audio(url),createURL=(blob:Blob)=>URL.createObjectURL(blob),revokeURL=(url:string)=>URL.revokeObjectURL(url)):Promise<void>{
  const prepared=await loadContestVoiceSlot(profilePath,slot,request),raw=atob(prepared.wavBase64),bytes=new Uint8Array(raw.length);
  for(let index=0;index<raw.length;index+=1)bytes[index]=raw.charCodeAt(index);
  if(bytes.length!==prepared.decodedBytes)throw new Error("Voice preview WAV identity changed; playback was denied.");
  const url=createURL(new Blob([bytes],{type:"audio/wav"}));
  try{const audio=makeAudio(url);if(deviceID){if(typeof audio.setSinkId!=="function")throw new Error("This runtime cannot route preview audio to the selected output device.");await audio.setSinkId(deviceID);}
    await new Promise<void>((resolve,reject)=>{audio.addEventListener("ended",()=>resolve(),{once:true});audio.addEventListener("error",()=>reject(new Error("Voice preview playback failed.")),{once:true});
      void audio.play().catch(reject);});
  }finally{revokeURL(url);}
}

function bytesBase64(bytes:Uint8Array):string{let value="";const stride=0x8000;for(let offset=0;offset<bytes.length;offset+=stride)
  value+=String.fromCharCode(...bytes.subarray(offset,offset+stride));return btoa(value);}
