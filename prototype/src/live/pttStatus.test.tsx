// @vitest-environment jsdom
import {expect,it,vi,afterEach} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {PTTStatus} from "./PTTStatus";
import {PTTSession} from "./pttSession";
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn(async()=>()=>{})}));
afterEach(cleanup);
it("offers deliberate retired-owner recovery without issuing commands on mount or generic Off",async()=>{
 const target={provider:"direct_agent" as const,selection_generation:2,selection_id:"00000000-0000-4000-8000-000000000001",worker_generation:5,connection_generation:8,control_revision:3,observation_revision:9,received_at_ms:10000};
 const owner_id=crypto.randomUUID();let duty:any={owner_id,target:{...target,worker_generation:4}},ids:string[]=[];
 const request=vi.fn(async(p:Record<string,any>):Promise<any>=>{if(p.action==="snapshot")return{target,receipts:[],release_required:duty};if(p.action==="receipt")return null;
   expect(p.action).toBe("recover");expect(p.owner_id).toBe(owner_id);expect(p.target).toEqual(target);expect(ids).toContain(p.operation_id);duty=null;return{operation_id:p.operation_id,enabled:false,owner_id,target,status:"recovered"};});
 const session=new PTTSession(request,{read:()=>ids,write:next=>{ids=next;}});render(<PTTStatus session={session}/>);
 const button=await screen.findByRole("button",{name:"Recover retired PTT owner using fresh RX proof"});
 expect(request.mock.calls.every(([p])=>p.action==="snapshot")).toBe(true);
 fireEvent.click(button);await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("No Off command was sent"));
 expect(request.mock.calls.filter(([p])=>p.action==="recover")).toHaveLength(1);
 expect(request.mock.calls.some(([p])=>["on","off"].includes(p.action))).toBe(false);
});
