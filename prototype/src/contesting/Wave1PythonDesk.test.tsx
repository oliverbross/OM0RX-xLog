// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";

const owner=vi.hoisted(()=>({current:null as any,native:vi.fn(async(command:string)=>{
  if(command==="monitor_context_snapshot")return null;throw Error(`Native service prohibited: ${command}`);
})}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:(command:string)=>owner.native(command)}));
vi.mock("@tauri-apps/api/event",()=>({listen:async()=>()=>{}}));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({onCloseRequested:async()=>()=>{}})}));
vi.mock("./ContestRecorderStrip",()=>({ContestRecorderStrip:()=>null}));
vi.mock("./useContestSurfaceOwner",async importOriginal=>({...await importOriginal<typeof import("./useContestSurfaceOwner")>(),
  useContestSurfaceOwner:(value:any)=>{owner.current=value;return async()=>{};}}));
vi.mock("./contestSurfaceNative",async importOriginal=>({...await importOriginal<typeof import("./contestSurfaceNative")>(),
  openContestSurfaceWindow:vi.fn(),openContestCallHistoryWindow:vi.fn()}));
vi.mock("./contestSetupDialogs",()=>({openContestSetupDialog:vi.fn(),useContestSetupDialogs:vi.fn()}));
vi.mock("./contestGroupChat",()=>({configureContestGroupChat:vi.fn(async()=>({})),readContestGroupNetwork:vi.fn(async()=>({})),
  openContestGroupChatWindow:vi.fn(),requestContestGroupAuthority:vi.fn(),syncContestGroupReplicaPage:vi.fn(),
  publishContestGroupContact:vi.fn(),takeContestGroupUnverifiedAcknowledgements:()=>[]}));
vi.mock("../live/useSharedCW",()=>({useSharedCW:()=>({controller:{refresh:vi.fn(),arm:vi.fn(),stop:vi.fn(),
  executeContest:vi.fn(()=>{throw Error("Output prohibited");})},state:{pending:false,armed:false,message:"Disarmed",error:""},profile:{macros:[]}})}));
vi.mock("../live/mapContext",()=>({connectMapContext:()=>({refresh:vi.fn(),dispose:vi.fn()})}));
vi.mock("../live/BandMaps",()=>({default:()=>null,deduplicateBandMapSpots:(spots:any[])=>spots}));
vi.mock("../live/ClusterPanel",()=>({default:()=>null}));
vi.mock("./contestVoiceOutput",()=>({ContestVoiceOutput:class {stop=async()=>{};play=async()=>{throw Error("Audio prohibited");};}}));

const root=resolve(import.meta.dirname,"../../..");
const fixture=JSON.parse(readFileSync(resolve(root,"python/tests/fixtures/all_contests_lifecycle.json"),"utf8")).cq_wpx_cw;
afterEach(()=>{cleanup();localStorage.clear();owner.current=null;owner.native.mockClear();window.history.replaceState({},"","/");});

function pythonHost(){
  const directory=realpathSync(mkdtempSync(resolve(tmpdir(),"xlog-wave1-ui-")));
  const child=spawn(globalThis.process.env.XLOG_CONTEST_PYTHON??"/opt/local/bin/python3.12",
    ["-I","-B",resolve(root,"python/contest_host/launcher.py"),"--data-root",directory],{cwd:root,stdio:["pipe","pipe","pipe"]});
  let buffer="",stderr="";
  const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  child.stdout.setEncoding("utf8");child.stderr.on("data",value=>{stderr+=String(value);});
  child.stdout.on("data",value=>{buffer+=value;while(buffer.includes("\n")){
    const end=buffer.indexOf("\n"),message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    pending.get(message.id)?.resolve(message);pending.delete(message.id);
  }});
  child.on("exit",()=>{for(const request of pending.values())request.reject(Error(`Python exited: ${stderr}`));pending.clear();});
  const request=async(method:string,params:Record<string,any>={}):Promise<any>=>{
    const id=crypto.randomUUID();
    if(method==="contest_scp_status")return{id,ok:true,result:{dataset:null,unavailableReason:"not_imported"}};
    if(method==="contest_history_status")return{id,ok:true,result:{status:"inactive",active:null,pending:null}};
    if(method.startsWith("contest_scp_"))return{id,ok:false,error:{code:"unavailable",message:"No SCP fixture"}};
    return await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+"\n");});
  };
  return{request,close:async()=>{const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.stdin.end();await exited;rmSync(directory,{recursive:true});}};
}

it("WPX productivity desk logs and loads next, retains a delayed draft note, and reviews exact unsubmitted bytes",async()=>{
  const host=pythonHost(),sessionID=crypto.randomUUID(),workspaceGeneration=crypto.randomUUID(),operatingContext=crypto.randomUUID();
  const started=performance.now(),timings:Record<string,number>={},requests:{method:string;params:Record<string,any>;result:any}[]=[];
  const delayedNote:{release:(()=>void)|null}={release:null};
  const request=async(method:string,params:Record<string,any>={})=>{
    const result=await host.request(method,params);requests.push({method,params,result});
    if(method==="contest_note_save")await new Promise<void>(resolve=>{delayedNote.release=resolve;});
    return result;
  };
  const prohibited=vi.fn(async()=>{throw Error("Physical/provider action prohibited in disposable UI test");});
  const serviceRequest=vi.fn(async(method:string,params:any={})=>method==="lookup_call"?{call:params.call,...(fixture.state.reference.countries[params.call]??{})}:{});
  try{
    const created=await host.request("contest_session_create",{sessionID,workspaceGeneration,operationID:crypto.randomUUID(),expectedRevision:0,
      pluginID:"cq_wpx_cw",station:fixture.state.station,settings:fixture.state.settings,reference:fixture.state.reference,
      frequencyHz:fixture.state.draft.frequencyHz,mode:fixture.mode});
    expect(created.ok,JSON.stringify(created)).toBe(true);
    const firstSerial=created.result.projection.reservedSerial;
    const view=render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} contestingTest
      strictHostActive={{sessionID,workspaceGeneration}} operatingContext={operatingContext} workspaceGeneration={workspaceGeneration}
      stationCall={fixture.state.station.Call} stationTune={prohibited} contestSpot={prohibited}
      radioFrequencyHz={fixture.state.draft.frequencyHz} spots={[]} cluster={null}/>);
    await waitFor(()=>expect(owner.current?.projections["active-qso"]?.status).toBe("ready"),{timeout:10000});
    timings.openMs=Math.round(performance.now()-started);
    fireEvent.click(screen.getByRole("button",{name:"Productivity desk"}));
    fireEvent.change(screen.getByRole("textbox",{name:"Add heard call to stack"}),{target:{value:"K2ABC"}});
    fireEvent.click(screen.getByRole("button",{name:"Add caller"}));
    expect(screen.getByRole("button",{name:"K2ABC"})).toBeTruthy();
    const input=(id:string)=>{const node=view.container.querySelector<HTMLInputElement>(`[data-contest-field="${id}"]`);expect(node,`Entry ${id}`).not.toBeNull();return node!;};
    for(const field of created.result.projection.fields){
      if(field.visible&&field.enabled&&!field.readOnly)fireEvent.change(input(field.id),{target:{value:fixture.fields[field.id]}});
    }
    expect(Number(input("other_1").value)).toBe(firstSerial);
    fireEvent.click(screen.getByRole("button",{name:"Log and load next"}));
    await waitFor(()=>{
      expect(input("callsign").value).toBe("K2ABC");expect(Number(input("other_1").value)).toBe(firstSerial+1);
      expect(screen.getByText(/Manual order · 0 queued/)).toBeTruthy();
    },{timeout:5000});
    const firstLog=await host.request("contest_log_page",{sessionID});
    expect(firstLog.result.total).toBe(1);expect(firstLog.result.rows[0].Call).toBe("K1ABC");
    expect(Number(firstLog.result.rows[0].SentNr)).toBe(firstSerial);
    expect(input("other_2").value).toBe("");
    timings.logNextMs=Math.round(performance.now()-started);
    const secondDraft=(await host.request("contest_projection",{sessionID})).result.projection.draftID;
    fireEvent.click(screen.getByRole("button",{name:"Log & notes"}));
    fireEvent.click(screen.getByRole("button",{name:"Note current"}));
    fireEvent.change(screen.getByRole("textbox",{name:"Operator note"}),{target:{value:"Heard K2ABC suffix uncertain — review original caller."}});
    fireEvent.click(screen.getByRole("button",{name:"Save note"}));
    await waitFor(()=>expect(delayedNote.release).toBeTypeOf("function"));
    const sentNote=requests.find(row=>row.method==="contest_note_save")!;
    expect(sentNote.params.target).toEqual({draftID:secondDraft});expect(sentNote.result.ok,JSON.stringify(sentNote.result)).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Entry & stack"}));
    expect((screen.getByRole("button",{name:"Log Now"}) as HTMLButtonElement).disabled).toBe(true);
    await act(async()=>{delayedNote.release!();});
    await waitFor(()=>expect((screen.getByRole("button",{name:"Log Now"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(input("other_2"),{target:{value:"405"}});
    fireEvent.click(screen.getByRole("button",{name:"Log Now"}));
    await waitFor(()=>expect(owner.current?.projections["active-qso"]?.manual?.qsos).toBe(2),{timeout:5000});
    const logged=await host.request("contest_log_page",{sessionID});
    expect(logged.result.rows.map((row:any)=>[row.Call,Number(row.SentNr)])).toEqual([["K2ABC",firstSerial+1],["K1ABC",firstSerial]]);
    const current=(await host.request("contest_projection",{sessionID})).result.projection;
    const notes=await host.request("contest_notes",{sessionID,workspaceGeneration,expectedRevision:current.revision,offset:0,limit:50});
    expect(notes.result.rows).toHaveLength(1);expect(notes.result.rows[0].qso_id).toBe(logged.result.rows[0].ID);
    expect(notes.result.rows[0].qso_id).not.toBe(logged.result.rows[1].ID);
    timings.delayedNoteAndSecondLogMs=Math.round(performance.now()-started);
    fireEvent.click(screen.getByRole("button",{name:"Log & notes"}));
    expect(await screen.findByText("Heard K2ABC suffix uncertain — review original caller.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Whole-log sort"),{target:{value:"receivedSerial"}});
    await waitFor(()=>expect(requests.filter(row=>row.method==="contest_log_page").at(-1)?.params).toMatchObject({sort:"receivedSerial"}));
    fireEvent.click(screen.getByRole("button",{name:"Submission"}));
    fireEvent.click(screen.getByRole("button",{name:"Review submission"}));
    await screen.findByRole("button",{name:"Save reviewed export"});
    const manifest=JSON.parse(view.container.querySelector(".contest-productivity-section pre")!.textContent!);
    expect(manifest.submissionStatus).toBe("not-submitted");expect(manifest.contacts.count).toBe(2);
    const prepared=await host.request("contest_export_prepare",{sessionID,expectedRevision:manifest.logRevision,format:"cabrillo"});
    expect(prepared.ok,JSON.stringify(prepared)).toBe(true);
    const bytes=await host.request("contest_export_read",{sessionID,workspaceGeneration,exportID:prepared.result.artifactID,offset:0,length:prepared.result.byteLength});
    const payload=Buffer.from(bytes.result.dataBase64,"base64");
    expect(manifest.sha256).toBe(createHash("sha256").update(payload).digest("hex"));expect(manifest.byteLength).toBe(payload.length);
    expect((await host.request("contest_projection",{sessionID})).result.projection.revision).toBe(manifest.logRevision);
    expect(prohibited).not.toHaveBeenCalled();expect(owner.native).not.toHaveBeenCalled();
    timings.completeMs=Math.round(performance.now()-started);
    console.info("Wave1 disposable Python desk timings",JSON.stringify(timings));
    view.unmount();
  }finally{delayedNote.release?.();cleanup();await host.close();}
},20000);
