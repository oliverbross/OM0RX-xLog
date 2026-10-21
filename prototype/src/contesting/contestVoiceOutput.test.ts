import {describe,expect,it,vi} from "vitest";
import {ContestVoiceOutput,type ContestVoiceAction,type ContestVoiceOrigin} from "./contestVoiceOutput";

const origin:ContestVoiceOrigin={sessionID:"10000000-0000-4000-8000-000000000001",workspaceGeneration:"20000000-0000-4000-8000-000000000002",
  draftID:"30000000-0000-4000-8000-000000000003",sourceRevision:"source"};
const action=(index=0):ContestVoiceAction=>({actionID:`40000000-0000-4000-8000-000000000004:${index}`,sessionID:origin.sessionID,
  workspaceGeneration:origin.workspaceGeneration,draftID:origin.draftID,sourceRevision:origin.sourceRevision,kind:"voice_keyer",signal:"phone",mode:"SSB",
  payload:"cq",payloadSHA256:"0".repeat(64)});
const wav=btoa("RIFFtest"),encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
const sha=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes).buffer));
const u32=(value:number)=>{const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value,true);return bytes;};
const u64=(value:number)=>{const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(value),true);return bytes;};
async function prepared(params:any){
  const bytes=encoder.encode("RIFFtest"),name=encoder.encode(params.actionID),digest=await sha(bytes);
  const parts=[u32(1),u32(name.length),name,u64(bytes.length),u64(100),encoder.encode(digest)],length=parts.reduce((sum,item)=>sum+item.length,0);
  const manifest=new Uint8Array(length);let offset=0;for(const part of parts){manifest.set(part,offset);offset+=part.length;}
  return{sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,draftID:params.draftID,actionID:params.actionID,
    payloadSHA256:params.payloadSHA256,manifestSHA256:await sha(manifest),totalDurationMs:100,totalDecodedBytes:bytes.length,
    segments:[{name:params.actionID,wavBase64:wav,durationMs:100,sha256:digest,decodedBytes:bytes.length}]};
}
class FakeAudio{
  src="";preload="";listeners=new Map<string,Set<()=>void>>();pause=vi.fn();setSinkId=vi.fn(async()=>{});
  addEventListener(name:string,listener:EventListenerOrEventListenerObject){const fn=listener as()=>void;this.listeners.set(name,new Set([...(this.listeners.get(name)??[]),fn]));}
  removeEventListener(name:string,listener:EventListenerOrEventListenerObject){this.listeners.get(name)?.delete(listener as()=>void);}
  load(){queueMicrotask(()=>this.emit("canplaythrough"));}
  async play(){queueMicrotask(()=>this.emit("ended"));}
  emit(name:string){for(const listener of this.listeners.get(name)??[])listener();}
}
const harness=(production=true)=>{
  const order:string[]=[],audios:FakeAudio[]=[];
  const request=vi.fn(async(params:any)=>Promise.all(params.requests.map(prepared)));
  const ptt={acquire:vi.fn(async()=>{order.push("ptt-on");return{accepted:true,confirmed:true};}),
    release:vi.fn(async()=>{order.push("ptt-off");return{accepted:true,confirmed:true};})};
  const output=new ContestVoiceOutput(production,request,ptt,()=>{const item=new FakeAudio(),sequence=audios.length;const original=item.play.bind(item);item.play=vi.fn(async()=>{order.push(`play-${sequence}`);await original();});audios.push(item);return item as any;},
    ()=>`blob:${audios.length}`,()=>{});
  return{output,request,ptt,audios,order};
};

describe("ContestVoiceOutput",()=>{
  it("does no I/O in Contesting Test",async()=>{const h=harness(false);await expect(h.output.play([action()],origin,"/profile","radio")).rejects.toThrow("disabled");expect(h.request).not.toHaveBeenCalled();expect(h.ptt.acquire).not.toHaveBeenCalled();});
  it("prepares one bounded batch, routes every device before PTT, then plays in order and releases",async()=>{const h=harness();await h.output.play([action(0),action(1)],origin,"/profile","radio");expect(h.request).toHaveBeenCalledOnce();expect(h.audios.every(audio=>(audio.setSinkId.mock.calls as unknown[][])[0][0]==="radio")).toBe(true);expect(h.order).toEqual(["ptt-on","play-0","play-1","ptt-off"]);});
  it("Stop and playback errors release PTT",async()=>{const h=harness();let resolvePlay:()=>void=()=>{};const pending=new Promise<void>(resolve=>{resolvePlay=resolve;});h.audios.length=0;
    const originalFactory=(h.output as any).makeAudio;(h.output as any).makeAudio=(url:string)=>{const item=originalFactory(url) as FakeAudio;item.play=vi.fn(async()=>{h.order.push("play");await pending;});return item;};
    const playing=h.output.play([action()],origin,"/profile","");await vi.waitFor(()=>expect(h.order).toContain("ptt-on"));await h.output.stop();resolvePlay();await expect(playing).rejects.toThrow("stopped");expect(h.order.at(-1)).toBe("ptt-off");
    const failure=harness();(failure.output as any).makeAudio=()=>{const item=new FakeAudio();item.play=vi.fn(async()=>queueMicrotask(()=>item.emit("error")));return item;};
    await expect(failure.output.play([action()],origin,"/profile","")).rejects.toThrow("stopped playback");expect(failure.order).toEqual(["ptt-on","ptt-off"]);
  });
  it("waits a late PTT-on result during Stop and releases before Stop completes",async()=>{const h=harness();let confirm:((value:{accepted:boolean;confirmed:boolean})=>void)|undefined;
    h.ptt.acquire.mockImplementationOnce(()=>new Promise(resolve=>{confirm=resolve;}));const playing=h.output.play([action()],origin,"/profile","");
    await vi.waitFor(()=>expect(h.ptt.acquire).toHaveBeenCalledOnce());let stopped=false;const stopping=h.output.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
    confirm!({accepted:true,confirmed:true});await stopping;await expect(playing).rejects.toThrow("stopped");expect(h.ptt.release).toHaveBeenCalledOnce();
  });
  it("never plays after acknowledged but unconfirmed PTT-on",async()=>{const h=harness();h.ptt.acquire.mockResolvedValueOnce({accepted:true,confirmed:false});
    await expect(h.output.play([action()],origin,"/profile","")).rejects.toThrow("fresh transmit readiness");expect(h.audios[0].play).not.toHaveBeenCalled();
  });
  it("rejects a mismatched WAV digest or ordered manifest before PTT",async()=>{const h=harness();h.request.mockImplementationOnce(async params=>{
      const values=await Promise.all(params.requests.map(prepared));values[0].segments[0].sha256="f".repeat(64);return values;});
    await expect(h.output.play([action()],origin,"/profile","")).rejects.toThrow("digest");expect(h.ptt.acquire).not.toHaveBeenCalled();
  });
  it("rejects stale and replayed actions before any new I/O",async()=>{const h=harness();const stale={...action(),draftID:"50000000-0000-4000-8000-000000000005"};await expect(h.output.play([stale],origin,"/profile","")).rejects.toThrow("stale");expect(h.request).not.toHaveBeenCalled();await h.output.play([action()],origin,"/profile","");await expect(h.output.play([action()],origin,"/profile","")).rejects.toThrow("replayed");expect(h.request).toHaveBeenCalledTimes(1);});
});
