// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {CarrierTuneStatus} from "./CarrierTuneStatus";
import {CarrierTuneSession,type CarrierReceipt} from "./carrierTune";
import Monitor from "./Monitor";
afterEach(cleanup);
it("standalone receipt status recovers and reviews a durable unknown without acquiring TX",async()=>{
  const id=crypto.randomUUID(),target={provider:"direct_agent" as const,selection_id:crypto.randomUUID(),selection_generation:2,worker_generation:4,connection_generation:7,control_revision:3,observation_revision:8,received_at_ms:10000};
  let retained:string|null=id,receipt:CarrierReceipt={operation_id:id,target,status:"unknown"};
  const request=vi.fn(async(params:Record<string,unknown>):Promise<any>=>{
    if(params.action==="snapshot")return{target,receipts:receipt.status==="unknown"?[receipt]:[]};
    if(params.action==="review")receipt={...receipt,status:"reviewed"};return receipt;
  });
  const journal={read:()=>retained,write:(next:string|null)=>{retained=next;}};
  const view=render(<CarrierTuneStatus session={new CarrierTuneSession(request,journal)}/>);
  fireEvent.click(await screen.findByRole("button",{name:"I have reviewed carrier Tune and observed radio state"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Check carrier Tune receipt"})).toBeNull());
  expect(screen.getByText(/Unknown carrier Tune was reviewed/)).toBeTruthy();view.unmount();
  expect(request.mock.calls.every(([p])=>["snapshot","receipt","review"].includes(String(p.action)))).toBe(true);
});
it("Monitor delegates lost carrier ACK to its recoverable status and retains a later Stop error",async()=>{
  const target={provider:"direct_flex_lan" as const,selection_id:crypto.randomUUID(),selection_generation:2,worker_generation:4,connection_generation:7,control_revision:3,observation_revision:8,received_at_ms:10000};
  let retained:string|null=null,receipt:CarrierReceipt|null=null;
  const request=vi.fn(async(params:Record<string,any>):Promise<any>=>{
    if(params.action==="snapshot")return{target,receipts:[]};
    if(params.action==="receipt")return receipt;
    receipt={operation_id:params.operation_id,target:params.target,status:"confirmed"};throw new Error("Lost carrier Tune ACK");
  });
  const session=new CarrierTuneSession(request,{read:()=>retained,write:(next:string|null)=>{retained=next;}});
  const snapshot={source:"direct_flex_lan",allow_transmit:true,radio:{connected:true,observed:true,transmitting:false},station:null,capabilities:{supported_commands:["tune","cancel"]},rotor:{owner:"native_dcu1",connected:true,azimuth:53}};
  render(<><CarrierTuneStatus session={session}/><Monitor snapshot={snapshot} map={null}
    onRequest={()=>session.tune("direct_flex_lan")} onRotorRequest={async()=>{throw new Error("Later Stop error");}} externalTuneFeedback/></>);
  fireEvent.click(screen.getByRole("button",{name:"Tune"}));
  await screen.findByText("Lost carrier Tune ACK");
  expect(screen.getAllByText("Lost carrier Tune ACK")).toHaveLength(1);
  const operation=session.getSnapshot().pending!;
  fireEvent.click(screen.getByRole("button",{name:"Check carrier Tune receipt"}));
  await waitFor(()=>expect(screen.queryByText("Lost carrier Tune ACK")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"Stop"}));
  await screen.findByText("Later Stop error");
  await act(async()=>{await session.check(operation);});
  expect(screen.getByText("Later Stop error")).toBeTruthy();
  expect(request.mock.calls.filter(([p])=>p.action==="tune")).toHaveLength(1);
});
