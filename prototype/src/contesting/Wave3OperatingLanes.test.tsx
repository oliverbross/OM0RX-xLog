// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";

const owner=vi.hoisted(()=>({current:null as any}));
const native=vi.hoisted(()=>({calls:[] as any[],snapshot:null as any}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:async(command:string,{params}:any)=>{
  if(command!=="contest_lane_output_request")throw Error("Native action prohibited");native.calls.push(structuredClone(params));
  if(params.action==="bind")native.snapshot.lanes[params.laneID]={context:{...params}};
  return {...native.snapshot,receipt:{accepted:true,confirmed:true,action:params.action}};
}}));
vi.mock("@tauri-apps/api/event",()=>({listen:async()=>()=>{}}));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({onCloseRequested:async()=>()=>{}})}));
vi.mock("./ContestRecorderStrip",()=>({ContestRecorderStrip:()=>null}));
vi.mock("./useContestSurfaceOwner",async original=>({...await original<typeof import("./useContestSurfaceOwner")>(),useContestSurfaceOwner:(value:any)=>{owner.current=value;return async()=>{};}}));
vi.mock("./contestSurfaceNative",async original=>({...await original<typeof import("./contestSurfaceNative")>(),openContestSurfaceWindow:vi.fn(),openContestCallHistoryWindow:vi.fn()}));
vi.mock("./contestSetupDialogs",()=>({openContestSetupDialog:vi.fn(),useContestSetupDialogs:vi.fn()}));
vi.mock("./contestGroupChat",()=>({configureContestGroupChat:vi.fn(async()=>({})),readContestGroupNetwork:vi.fn(async()=>({})),openContestGroupChatWindow:vi.fn(),requestContestGroupAuthority:vi.fn(),syncContestGroupReplicaPage:vi.fn(),publishContestGroupContact:vi.fn(),takeContestGroupUnverifiedAcknowledgements:()=>[]}));
vi.mock("../live/useSharedCW",()=>({useSharedCW:()=>({controller:{refresh:vi.fn(),arm:vi.fn(),stop:vi.fn(),executeContest:vi.fn(()=>{throw Error("SO1V output prohibited");})},state:{pending:false,armed:false,message:"Disarmed",error:""},profile:{macros:[]}})}));
vi.mock("../live/mapContext",()=>({connectMapContext:()=>({refresh:vi.fn(),dispose:vi.fn()})}));
vi.mock("../live/BandMaps",()=>({default:()=>null,deduplicateBandMapSpots:(spots:any[])=>spots}));
vi.mock("../live/ClusterPanel",()=>({default:()=>null}));
vi.mock("./contestVoiceOutput",()=>({ContestVoiceOutput:class {stop=async()=>{};play=async()=>{throw Error("Audio prohibited");};}}));
const root=resolve(import.meta.dirname,"../../.."),fixture=JSON.parse(readFileSync(resolve(root,"python/tests/fixtures/all_contests_lifecycle.json"),"utf8")).cq_wpx_cw;
afterEach(()=>{cleanup();localStorage.clear();owner.current=null;native.calls=[];window.history.replaceState({},"","/");});

// Same isolated JSONL launcher protocol used by retained Wave1StackRecovery.
function pythonHost(){
  const directory=realpathSync(mkdtempSync(resolve(tmpdir(),"xlog-lane-entry-")));
  const child=spawn(process.env.XLOG_CONTEST_PYTHON??"/opt/local/bin/python3.12",["-I","-B",resolve(root,"python/contest_host/launcher.py"),"--data-root",directory],{cwd:root,stdio:["pipe","pipe","pipe"]});
  const pending=new Map<string,{resolve(value:any):void;reject(error:Error):void}>();let buffer="",stderr="";
  child.stdout.setEncoding("utf8");child.stderr.on("data",value=>{stderr+=String(value);});
  child.stdout.on("data",value=>{buffer+=value;while(buffer.includes("\n")){const end=buffer.indexOf("\n"),frame=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(frame.id)?.resolve(frame);pending.delete(frame.id);}});
  child.on("exit",()=>{for(const waiter of pending.values())waiter.reject(Error(`Python exited: ${stderr}`));pending.clear();});
  const request=async(method:string,params:Record<string,any>={}):Promise<any>=>{
    const id=crypto.randomUUID();
    if(method==="contest_scp_status")return{id,ok:true,result:{dataset:null,unavailableReason:"not_imported"}};
    if(method==="contest_history_status")return{id,ok:true,result:{status:"inactive",active:null,pending:null}};
    if(method.startsWith("contest_scp_"))return{id,ok:false,error:{code:"unavailable",message:"No SCP fixture"}};
    return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+"\n");});
  };
  return{request,close:async()=>{const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.stdin.end();await exited;rmSync(directory,{recursive:true});}};
}
it("real host persists independent lane typing, tunes nonfocused B explicitly, and logs each original shared serial once",async()=>{
  const host=pythonHost(),sessionID=crypto.randomUUID(),workspaceGeneration=crypto.randomUUID();
  const routes=[{radioID:"radio1",receiverID:"receiver1",vfo:"A",sliceID:null,generation:1},{radioID:"radio2",receiverID:"receiver1",vfo:"A",sliceID:null,generation:1}];
  native.snapshot={simulated:true,externalIO:false,capabilities:{supported:true,routes},nativeContext:{workerGeneration:1},lanes:{},cw:{armed:false},listenLaneID:null,txLaneID:null};
  const prohibited=vi.fn(async()=>{throw Error("Active-radio fallback prohibited");});
  try{
    const made=await host.request("contest_session_create",{sessionID,workspaceGeneration,operationID:crypto.randomUUID(),expectedRevision:0,
      pluginID:"cq_wpx_cw",station:fixture.state.station,settings:fixture.state.settings,reference:fixture.state.reference,frequencyHz:14_025_000,mode:"CW"});expect(made.ok).toBe(true);
    const configured=await host.request("contest_lanes_configure",{sessionID,workspaceGeneration,operationID:crypto.randomUUID(),expectedRevision:made.result.projection.revision,mode:"SO2R",bindings:{laneA:routes[0],laneB:routes[1]}});expect(configured.ok,JSON.stringify(configured)).toBe(true);
    const initial=configured.result.projection.operatingLanes.lanes;
    const view=render(<Not1MMContestWorkspace request={host.request} serviceRequest={async()=>({})} strictHostActive={{sessionID,workspaceGeneration}}
      operatingContext="disposable-native-context" workspaceGeneration={workspaceGeneration} stationCall="OM0RX" contestingTest radioFrequencyHz={7_111_000}
      stationTune={prohibited} contestSpot={prohibited} spots={[]} cluster={null}/>);
    await waitFor(()=>expect(owner.current?.projections["active-qso"]?.status).toBe("ready"),{timeout:10000});
    fireEvent.click(screen.getByRole("button",{name:"Productivity desk"}));
    const a=within(screen.getByRole("region",{name:"Lane A"})),b=within(screen.getByRole("region",{name:"Lane B"}));
    fireEvent.change(a.getByRole("textbox",{name:/^Lane A Call(?:sign)?$/}),{target:{value:"K1LEFT"}});
    fireEvent.change(view.container.querySelector<HTMLInputElement>('[data-lane-id="laneA"] [data-contest-lane-field="other_2"]')!,{target:{value:"123"}});
    fireEvent.change(b.getByRole("textbox",{name:/^Lane B Call(?:sign)?$/}),{target:{value:"DL2RIGHT"}});
    const receivedB=view.container.querySelector<HTMLInputElement>('[data-lane-id="laneB"] [data-contest-lane-field="other_2"]')!;
    fireEvent.change(receivedB,{target:{value:"456"}});
    await waitFor(async()=>{const read=await host.request("contest_draft_get",{sessionID});const lanes=read.result.projection.operatingLanes.lanes;
      expect(lanes[0].fields.find((f:any)=>f.id==="callsign").value).toBe("K1LEFT");expect(lanes[1].fields.find((f:any)=>f.id==="callsign").value).toBe("DL2RIGHT");},{timeout:5000});
    fireEvent.click(screen.getByText(/Operating lanes ·/));
    fireEvent.click(screen.getByRole("button",{name:"Review native lane routes"}));
    await screen.findByText("Offline fake providers · no physical radio, audio or RF output.");
    fireEvent.change(b.getByRole("textbox",{name:"Lane B frequency Hz"}),{target:{value:"7027000"}});
    fireEvent.click(b.getByRole("button",{name:"Tune here"}));
    await waitFor(()=>expect(native.calls.some(call=>call.action==="tune"&&call.laneID==="laneB"&&call.binding.radioID==="radio2"&&call.frequencyHz===7_027_000)).toBe(true),{timeout:5000});
    const afterTune=(await host.request("contest_draft_get",{sessionID})).result.projection;
    expect(afterTune.operatingLanes.keyboardLaneID).toBe("laneA");expect(afterTune.operatingLanes.lanes[0].frequencyHz).toBe(14_025_000);
    fireEvent.click(b.getByRole("button",{name:"Log Lane B"}));
    await waitFor(async()=>expect((await host.request("contest_log_page",{sessionID})).result.total).toBe(1),{timeout:5000});
    fireEvent.click(a.getByRole("button",{name:"Log Lane A"}));
    await waitFor(async()=>expect((await host.request("contest_log_page",{sessionID})).result.total).toBe(2),{timeout:5000});
    const rows=(await host.request("contest_log_page",{sessionID})).result.rows;
    expect(Object.fromEntries(rows.map((row:any)=>[row.Call,Number(row.SentNr)]))).toEqual({K1LEFT:initial[0].reservedSerial,DL2RIGHT:initial[1].reservedSerial});
    expect(native.calls.filter(call=>["listen","requestTX","send","macro"].includes(call.action))).toEqual([]);
    expect(prohibited).not.toHaveBeenCalled();
  }finally{cleanup();await host.close();}
},20000);
