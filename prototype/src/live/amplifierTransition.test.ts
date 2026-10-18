import {expect,it,vi} from "vitest";
import {AmplifierTransitionSession,type AmplifierReceipt} from "./amplifierTransition";
const target={provider:"direct_agent" as const,selection_id:"00000000-0000-4000-8000-000000000001",selection_generation:2,worker_generation:4,connection_generation:7,control_revision:3,observation_revision:8,received_at_ms:10000};
function fixture(){let retained:string[]=[];const receipts=new Map<string,AmplifierReceipt>();const journal={read:()=>retained,write:(ids:string[])=>{retained=ids;}};
  const request=vi.fn(async(p:Record<string,any>):Promise<any>=>{
    if(p.action==="snapshot"||p.action==="prepare")return{target,preparation:{session:target.selection_id,epoch:target.selection_id,action:p.transition},receipts:[...receipts.values()].filter(r=>["unknown","pending"].includes(r.status))};
    if(p.action==="receipt")return receipts.get(p.operation_id)??null;
    if(p.action==="review"){const r={...receipts.get(p.operation_id)!,status:"reviewed" as const};receipts.set(p.operation_id,r);return r;}
    expect(retained).toContain(p.operation_id);const r:AmplifierReceipt={operation_id:p.operation_id,target:p.target,action:p.action,status:"acknowledged"};receipts.set(p.operation_id,r);return r;
  });return{request,journal,receipts,session:new AmplifierTransitionSession(request,journal)};
}
it("persists exact native authority before one explicit send; acknowledgement is silent",async()=>{const f=fixture();expect(await f.session.transition("operate")).toEqual({accepted:true,confirmed:false});expect(f.session.getSnapshot().pending).toEqual([]);expect(f.session.getSnapshot().message).toBe("");expect(f.request.mock.calls.filter(([p])=>p.action==="operate")).toHaveLength(1);});
it("lost reply reload recovers terminal tombstone by ID without replay",async()=>{const f=fixture(),normal=f.request.getMockImplementation()!;f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="operate")throw new Error("Lost ACK");return r;});await expect(f.session.transition("operate")).rejects.toThrow("Lost ACK");const id=f.session.getSnapshot().pending[0];const remount=new AmplifierTransitionSession(f.request,f.journal);await remount.refresh();expect(remount.getSnapshot().pending).toEqual([]);expect(f.request).toHaveBeenCalledWith({action:"receipt",operation_id:id});expect(f.request.mock.calls.filter(([p])=>p.action==="operate")).toHaveLength(1);});
it("unknown Operate blocks acquisition but never urgent Standby; review is receipt-only",async()=>{const f=fixture(),normal=f.request.getMockImplementation()!;f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="operate"){r.status="unknown";r.detail={code:"operate-rollback-incomplete",message:"drive proof failed"};}return r;});await expect(f.session.transition("operate")).rejects.toThrow("operate-rollback-incomplete");const old=f.session.getSnapshot().pending[0];await expect(f.session.transition("operate")).rejects.toThrow("Standby remains available");await f.session.transition("standby");const message=f.session.getSnapshot().message;await f.session.review(old);expect(f.session.getSnapshot().message).toBe(message);expect(f.session.getSnapshot().pending).toEqual([]);});
it("pending Operate allows Standby and reverse completion cannot overwrite its feedback",async()=>{const f=fixture(),normal=f.request.getMockImplementation()!;let release!:(r:any)=>void;let old:AmplifierReceipt|undefined;
  f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="operate"){old={...r,status:"pending"};f.receipts.set(r.operation_id,old!);return new Promise(resolve=>{release=resolve;});}return r;});
  const operate=f.session.transition("operate");await vi.waitFor(()=>expect(release).toBeTypeOf("function"));await f.session.transition("standby");const message=f.session.getSnapshot().message;
  release({...old,status:"acknowledged"});await operate;expect(f.session.getSnapshot().message).toBe(message);expect(message).toBe("");expect(f.session.getSnapshot().pending).toEqual([]);
});
it("late receipt reads never replace newer Standby status",async()=>{const f=fixture();await f.session.transition("operate");const old=[...f.receipts.keys()][0];const normal=f.request.getMockImplementation()!;let release!:(r:any)=>void;f.request.mockImplementation(p=>p.action==="receipt"?new Promise(resolve=>{release=resolve;}):normal(p));const check=f.session.check(old);await f.session.transition("standby");const message=f.session.getSnapshot().message;release(f.receipts.get(old));await check;expect(f.session.getSnapshot().message).toBe(message);});
it("later acknowledged Standby retires an older deferred Operate snapshot even when it returns current native authority",async()=>{
  const f=fixture(),normal=f.request.getMockImplementation()!;let release!:(r:any)=>void;
  f.request.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const operate=f.session.transition("operate");const rejected=expect(operate).rejects.toThrow("superseded by a later Standby");
  await f.session.transition("standby");const message=f.session.getSnapshot().message;
  release({target:{...target,control_revision:target.control_revision+1,observation_revision:target.observation_revision+1},receipts:[]});
  await rejected;expect(f.request.mock.calls.filter(([p])=>p.action==="operate")).toHaveLength(0);
  expect(f.request.mock.calls.filter(([p])=>p.action==="standby")).toHaveLength(1);expect(f.session.getSnapshot().pending).toEqual([]);
  expect(f.session.getSnapshot().message).toBe(message);expect(message).toBe("");
  f.request.mockImplementation(normal);await f.session.transition("operate");expect(f.request.mock.calls.filter(([p])=>p.action==="operate")).toHaveLength(1);
});
it("independent Desk and Monitor sessions preserve the native preparation fence despite a delayed fresh Desk target",async()=>{
  let epoch=crypto.randomUUID(),releaseDesk!:(v:any)=>void;const admitted:string[]=[],receipts=new Map<string,AmplifierReceipt>();let first=true;
  const request=vi.fn(async(p:Record<string,any>):Promise<any>=>{
    if(p.action==="prepare"){
      if(p.transition==="standby")epoch=crypto.randomUUID();const preparation={session:target.selection_id,epoch,action:p.transition};
      if(first){first=false;return new Promise(resolve=>{releaseDesk=value=>resolve({...value,preparation});});}
      return{target,preparation,receipts:[]};
    }
    if(p.action==="receipt")return receipts.get(p.operation_id)??null;
    if(p.preparation.epoch!==epoch)throw new Error("Native preparation superseded by Standby");
    admitted.push(p.action);const receipt={operation_id:p.operation_id,action:p.action,target:p.target,status:"acknowledged" as const};receipts.set(p.operation_id,receipt);return receipt;
  });
  const journal=()=>{let saved:string[]=[];return{read:()=>saved,write:(ids:string[])=>{saved=ids;}};};
  const desk=new AmplifierTransitionSession(request,journal()),monitor=new AmplifierTransitionSession(request,journal());
  const old=desk.transition("operate"),rejected=expect(old).rejects.toThrow("Native preparation superseded");
  await monitor.transition("standby");releaseDesk({target:{...target,control_revision:target.control_revision+2,observation_revision:target.observation_revision+2},receipts:[]});await rejected;
  expect(admitted).toEqual(["standby"]);expect([...receipts.values()].map(r=>r.action)).toEqual(["standby"]);
  await desk.check(desk.getSnapshot().pending[0]);expect(desk.getSnapshot().pending).toEqual([]);expect(monitor.getSnapshot().message).toBe("");
});
it("storage failure prevents dispatch and changed selection/acceptance cannot relabel native target",async()=>{const f=fixture();const failing=new AmplifierTransitionSession(f.request,{read:()=>[],write:()=>{throw new Error("storage failed");}});await expect(failing.transition("standby")).rejects.toThrow("storage failed");expect(f.request.mock.calls.some(([p])=>p.action==="standby")).toBe(false);
  await expect(f.session.transition("operate",{selection:{provider:"direct_agent",generation:3,selection_id:target.selection_id}} as any)).rejects.toThrow("exact Agent");
  await f.session.transition("standby",{selection:{provider:"direct_agent",generation:2,selection_id:target.selection_id},radio:{snapshot:{generation:99}}} as any);expect(f.request.mock.calls.find(([p])=>p.action==="standby")![0].target).toEqual(target);
});
for(const field of ["operation_id","action","target"])it(`malformed ${field} reply stays unresolved and is never retried`,async()=>{const f=fixture(),normal=f.request.getMockImplementation()!;f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="standby")return{...r,[field]:null};return r;});await expect(f.session.transition("standby")).rejects.toThrow("could not be verified");expect(f.session.getSnapshot().pending).toHaveLength(1);expect(f.request.mock.calls.filter(([p])=>p.action==="standby")).toHaveLength(1);});
