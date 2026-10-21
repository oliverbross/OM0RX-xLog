import {describe,expect,it,vi} from "vitest";
import {ContestVoiceOutput,type ContestVoiceAction,type ContestVoiceOrigin} from "./contestVoiceOutput";

const origin:ContestVoiceOrigin={sessionID:"10000000-0000-4000-8000-000000000001",workspaceGeneration:"20000000-0000-4000-8000-000000000002",
  draftID:"30000000-0000-4000-8000-000000000003",sourceRevision:"source"};
const action=(index=0):ContestVoiceAction=>({actionID:`40000000-0000-4000-8000-000000000004:${index}`,sessionID:origin.sessionID,
  workspaceGeneration:origin.workspaceGeneration,draftID:origin.draftID,sourceRevision:origin.sourceRevision,kind:"voice_keyer",signal:"phone",mode:"SSB",
  payload:"cq",payloadSHA256:"0".repeat(64)});
const wav=btoa("RIFFtest");
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
  const request=vi.fn(async(params:any)=>({sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,draftID:params.draftID,
    actionID:params.actionID,payloadSHA256:params.payloadSHA256,totalDurationMs:100,segments:[{name:params.actionID,wavBase64:wav,durationMs:100}]}));
  const ptt={set:vi.fn(async(enabled:boolean)=>{order.push(enabled?"ptt-on":"ptt-off");return{accepted:true,confirmed:true};})};
  const output=new ContestVoiceOutput(production,request,ptt,()=>{const item=new FakeAudio(),sequence=audios.length;const original=item.play.bind(item);item.play=vi.fn(async()=>{order.push(`play-${sequence}`);await original();});audios.push(item);return item as any;},
    ()=>`blob:${audios.length}`,()=>{});
  return{output,request,ptt,audios,order};
};

describe("ContestVoiceOutput",()=>{
  it("does no I/O in Contesting Test",async()=>{const h=harness(false);await expect(h.output.play([action()],origin,"/profile","radio")).rejects.toThrow("disabled");expect(h.request).not.toHaveBeenCalled();expect(h.ptt.set).not.toHaveBeenCalled();});
  it("prepares every WAV and routes the device before PTT, then plays in order and releases",async()=>{const h=harness();await h.output.play([action(0),action(1)],origin,"/profile","radio");expect(h.request).toHaveBeenCalledTimes(2);expect(h.audios.every(audio=>(audio.setSinkId.mock.calls as unknown[][])[0][0]==="radio")).toBe(true);expect(h.order).toEqual(["ptt-on","play-0","play-1","ptt-off"]);});
  it("Stop and playback errors release PTT",async()=>{const h=harness();let resolvePlay:()=>void=()=>{};const pending=new Promise<void>(resolve=>{resolvePlay=resolve;});h.audios.length=0;
    const originalFactory=(h.output as any).makeAudio;(h.output as any).makeAudio=(url:string)=>{const item=originalFactory(url) as FakeAudio;item.play=vi.fn(async()=>{h.order.push("play");await pending;});return item;};
    const playing=h.output.play([action()],origin,"/profile","");await vi.waitFor(()=>expect(h.order).toContain("ptt-on"));await h.output.stop();resolvePlay();await expect(playing).rejects.toThrow("stopped");expect(h.order.at(-1)).toBe("ptt-off");
    const failure=harness();(failure.output as any).makeAudio=(url:string)=>{const item=new FakeAudio();item.play=vi.fn(async()=>queueMicrotask(()=>item.emit("error")));return item;};
    await expect(failure.output.play([action()],origin,"/profile","")).rejects.toThrow("stopped playback");expect(failure.order).toEqual(["ptt-on","ptt-off"]);
  });
  it("reconciles an uncertain PTT-on result and releases any retained native owner",async()=>{let duty=false;const calls:boolean[]=[];
    const ptt={set:vi.fn(async(enabled:boolean)=>{calls.push(enabled);if(enabled){duty=true;throw new Error("PTT outcome unknown");}duty=false;return{accepted:true,confirmed:true};}),
      refresh:vi.fn(async()=>{}),getSnapshot:()=>({releaseRequired:duty?{}:null})};
    const base=harness(),output=new ContestVoiceOutput(true,base.request,ptt,()=>{const item=new FakeAudio();return item as any;},()=>"blob:voice",()=>{});
    await expect(output.play([action()],origin,"/profile","")).rejects.toThrow("PTT outcome unknown");expect(calls).toEqual([true,false]);expect(ptt.refresh).toHaveBeenCalledOnce();
  });
  it("rejects stale and replayed actions before any new I/O",async()=>{const h=harness();const stale={...action(),draftID:"50000000-0000-4000-8000-000000000005"};await expect(h.output.play([stale],origin,"/profile","")).rejects.toThrow("stale");expect(h.request).not.toHaveBeenCalled();await h.output.play([action()],origin,"/profile","");await expect(h.output.play([action()],origin,"/profile","")).rejects.toThrow("replayed");expect(h.request).toHaveBeenCalledTimes(1);});
});
