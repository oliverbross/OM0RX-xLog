// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VoiceDesk from "./VoiceDesk";
afterEach(cleanup);
function fixture(){
  const profile={version:1,profilePath:"/operator/voice",labels:Array.from({length:10},(_,i)=>`Voice ${i+1}`),routes:{input:{deviceId:"native-mic",channels:[0],sampleRate:48000},monitor:{deviceId:"native-monitor",channels:[0,1],sampleRate:48000},transmit:{deviceId:"native-tx",channels:[0],sampleRate:48000}},edits:Array.from({length:10},()=>({trimStartMs:0,trimEndMs:null,gainDb:0}))};
  let revision=4;const calls:Record<string,unknown>[]=[];let complete:(()=>void)|undefined;
  const request=vi.fn(async(params:Record<string,unknown>):Promise<any>=>{calls.push(params);
    switch(params.action){case "snapshot":return {profile:structuredClone(profile),revision,generation:"10000000-0000-4000-8000-000000000001",devices:[],nativeAvailable:true,job:null,last:{}};
      case "analyze":return {durationMs:200,peak:0.5,clippedSamples:0,sampleRate:48000};
      case "prepare":return {actionID:"native-issued-action",durationMs:200,peak:0.5,clippedSamples:0};
      case "send":return new Promise<void>(resolve=>{complete=resolve;});
      case "preview":case "stop":return {};
      case "save":return {status:params.expectedRevision===revision?"applied":"conflict"};
      default:throw Error("Unexpected voice request");}
  });return{request,calls,advance:()=>{revision++;},complete:()=>complete?.()};
}
describe("normal voice controls retain native admission",()=>{
  it.each(["record_start","import"])("binds %s to the displayed library revision and workspace",async action=>{
    const f=fixture(),request=vi.fn(async(params:Record<string,unknown>)=>params.action===action?{}:f.request(params));
    render(<VoiceDesk request={request}/>);await screen.findByText(/0.20 s/);
    fireEvent.click(screen.getByText("Voice memories · normal SSB"));fireEvent.click(screen.getByText("Library, recording and audio routes"));
    if(action==="record_start")fireEvent.click(screen.getByRole("button",{name:"Record microphone"}));
    else{
      const file=new File([new Uint8Array([1,2])],"memory.wav",{type:"audio/wav"});
      Object.defineProperty(file,"arrayBuffer",{value:async()=>new Uint8Array([1,2]).buffer});
      fireEvent.change(screen.getByLabelText("Import PCM WAV"),{target:{files:[file]}});
    }
    await waitFor(()=>expect(request.mock.calls.some(([params])=>params.action===action)).toBe(true));
    expect(request.mock.calls.find(([params])=>params.action===action)?.[0]).toMatchObject({slot:1,overwrite:false,expectedRevision:4,generation:"10000000-0000-4000-8000-000000000001"});
  });
  it("retains the desk and disables preparation when native state is unavailable",async()=>{
    const request=vi.fn(async()=>({}));render(<VoiceDesk request={request}/>);
    await screen.findByText(/Native voice state is unavailable/);fireEvent.click(screen.getByText("Voice memories · normal SSB"));
    expect((screen.getByRole("button",{name:"Send memory"}) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls).toHaveLength(1);
  });
  it("an externally changed memory refreshes its digest review and emits no Send",async()=>{
    const f=fixture();const request=vi.fn(async(params:Record<string,unknown>):Promise<any>=>{
      if(params.action==="analyze")return{durationMs:200,peak:0.5,clippedSamples:0,sampleRate:48000,audioIdentity:{sourceSHA256:"reviewed-source",editedPCMSHA256:"reviewed-edit",outputPCMSHA256:"reviewed-output"}};
      if(params.action==="prepare")return{actionID:"new-native-token",durationMs:200,peak:0.5,clippedSamples:0,audioIdentity:{sourceSHA256:"changed-source",editedPCMSHA256:"changed-edit",outputPCMSHA256:"changed-output"}};
      return f.request(params);
    });render(<VoiceDesk request={request}/>);await screen.findByText(/0.20 s/);fireEvent.click(screen.getByText("Voice memories · normal SSB"));
    fireEvent.click(screen.getByRole("button",{name:"Send memory"}));await screen.findByText(/The memory changed since its preview/);
    expect(request.mock.calls.some(([params])=>params.action==="prepare")).toBe(true);
    expect(request.mock.calls.some(([params])=>params.action==="send")).toBe(false);
  });
  it("typing, route edits and saving never prepare or send audio; stale edits retain their original revision",async()=>{
    const f=fixture();render(<VoiceDesk request={f.request}/>);await screen.findByText(/0.20 s/);
    fireEvent.click(screen.getByText("Voice memories · normal SSB"));fireEvent.click(screen.getByText("Library, recording and audio routes"));
    fireEvent.change(screen.getByLabelText("Memory label"),{target:{value:"Evening CQ"}});f.advance();
    fireEvent.click(screen.getByRole("button",{name:"Save voice settings"}));
    await screen.findByText(/Voice settings changed in another window/);
    expect(f.calls.find(c=>c.action==="save")?.expectedRevision).toBe(4);
    expect(f.calls.some(c=>["prepare","send","preview","record_start"].includes(String(c.action)))).toBe(false);
    expect((screen.getByLabelText("Memory label") as HTMLInputElement).value).toBe("Evening CQ");
  });
  it("one double click prepares one native token, sends once and leaves Stop available",async()=>{
    const f=fixture();render(<VoiceDesk request={f.request}/>);await screen.findByText(/0.20 s/);fireEvent.click(screen.getByText("Voice memories · normal SSB"));
    const send=screen.getByRole("button",{name:"Send memory"});fireEvent.click(send);fireEvent.click(send);
    await waitFor(()=>expect(f.calls.filter(c=>c.action==="send")).toHaveLength(1));
    expect(f.calls.filter(c=>c.action==="prepare")).toHaveLength(1);
    expect(f.calls.find(c=>c.action==="prepare")).toMatchObject({slot:1,expectedRevision:4,generation:"10000000-0000-4000-8000-000000000001"});
    expect(f.calls.find(c=>c.action==="send")).toEqual({action:"send",actionID:"native-issued-action"});
    fireEvent.click(screen.getByRole("button",{name:"Stop voice"}));await waitFor(()=>expect(f.calls.some(c=>c.action==="stop")).toBe(true));f.complete();
    expect(f.calls.some(c=>"profilePath" in c&&c.action==="send")).toBe(false);
  });
  it("monitor preview uses the native preview path without a send token and global send requires desk focus",async()=>{
    const f=fixture();render(<VoiceDesk request={f.request}/>);await screen.findByText(/0.20 s/);fireEvent.click(screen.getByText("Voice memories · normal SSB"));
    window.dispatchEvent(new Event("xlog:voice-send"));expect(f.calls.some(c=>c.action==="prepare")).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:"Preview on monitor"}));await screen.findByText("Monitor preview completed without PTT.");
    expect(f.calls.some(c=>c.action==="prepare"||c.action==="send")).toBe(false);
    expect(f.calls.filter(c=>c.action==="preview")).toEqual([{action:"preview",slot:1,expectedRevision:4,generation:"10000000-0000-4000-8000-000000000001"}]);
  });
});
