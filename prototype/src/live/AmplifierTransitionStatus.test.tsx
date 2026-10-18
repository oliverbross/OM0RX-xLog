// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {AmplifierTransitionStatus} from "./AmplifierTransitionStatus";
import {AmplifierTransitionSession,type AmplifierReceipt} from "./amplifierTransition";
import Monitor from "./Monitor";
afterEach(cleanup);
it("Monitor shows concise amplifier feedback without receipt or review controls and retains newer Stop errors",async()=>{
  const target={provider:"direct_agent" as const,selection_id:crypto.randomUUID(),selection_generation:2,worker_generation:4,connection_generation:7,control_revision:3,observation_revision:8,received_at_ms:10000};
  let saved:string[]=[],receipt:AmplifierReceipt|null=null;
  const request=vi.fn(async(p:Record<string,any>):Promise<any>=>{if(p.action==="snapshot"||p.action==="prepare")return{target,preparation:{session:target.selection_id,epoch:target.selection_id,action:p.transition},receipts:[]};if(p.action==="receipt")return receipt;receipt={operation_id:p.operation_id,action:p.action,target:p.target,status:"acknowledged"};throw new Error("Lost amplifier ACK");});
  const session=new AmplifierTransitionSession(request,{read:()=>saved,write:(ids:string[])=>{saved=ids;}});
  const snapshot={source:"direct_agent",radio:{connected:true,observed:true},station:{kpa_operate:true,allowed_actions:["standby"]},rotor:{owner:"native_dcu1",connected:true,azimuth:53}};
  render(<><AmplifierTransitionStatus session={session}/><Monitor snapshot={snapshot} map={null} onRequest={(_method,p)=>session.transition(p?.action)} onRotorRequest={async()=>{throw new Error("Later Stop error");}} externalAmplifierFeedback/></>);
  fireEvent.click(screen.getByRole("button",{name:"Standby"}));await screen.findByText("Lost amplifier ACK");expect(screen.getAllByText("Lost amplifier ACK")).toHaveLength(1);
  expect(screen.queryByRole("button",{name:/amplifier receipt|reviewed amplifier/i})).toBeNull();
  const id=session.getSnapshot().pending[0];await act(async()=>{await session.check(id);});await waitFor(()=>expect(screen.queryByText("Lost amplifier ACK")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"Stop"}));await screen.findByText("Later Stop error");await act(async()=>{await session.check(id);});expect(screen.getByText("Later Stop error")).toBeTruthy();expect(request.mock.calls.filter(([p])=>p.action==="standby")).toHaveLength(1);
});
