import { expect, it, vi } from "vitest";
import { CarrierTuneSession, type CarrierReceipt, type CarrierTarget } from "./carrierTune";
const target:CarrierTarget={provider:"direct_agent",selection_id:"00000000-0000-4000-8000-000000000001",selection_generation:2,worker_generation:4,connection_generation:7,control_revision:3,observation_revision:8,received_at_ms:10000};
function fixture(){
  let retained:string|null=null;const receipts=new Map<string,CarrierReceipt>();
  const journal={read:()=>retained,write:(id:string|null)=>{retained=id;}};
  const request=vi.fn(async(params:Record<string,any>):Promise<any>=>{
    if(params.action==="snapshot")return{target,receipts:[...receipts.values()].filter(r=>["pending","unknown"].includes(r.status))};
    if(params.action==="receipt")return receipts.get(params.operation_id)??null;
    if(params.action==="review"){const r={...receipts.get(params.operation_id)!,status:"reviewed" as const};receipts.set(params.operation_id,r);return r;}
    expect(retained).toBe(params.operation_id);const r:CarrierReceipt={operation_id:params.operation_id,target:params.target,status:"acknowledged"};receipts.set(params.operation_id,r);return r;
  });return{request,journal,receipts,session:new CarrierTuneSession(request,journal)};
}
it("journals a one-shot native carrier target and keeps Agent acknowledgement unconfirmed",async()=>{
  const f=fixture();expect(await f.session.tune("direct_agent")).toEqual({accepted:true,confirmed:false});
  expect(f.session.getSnapshot().message).toContain("RF remains unconfirmed");expect(f.session.getSnapshot().pending).toBeNull();
  expect(f.request.mock.calls.filter(([p])=>p.action==="tune")).toHaveLength(1);
});
it("lost reply remount recovers a terminal receipt without sending Tune again",async()=>{
  const f=fixture(),normal=f.request.getMockImplementation()!;
  f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="tune")throw new Error("lost reply");return r;});
  await expect(f.session.tune("direct_agent")).rejects.toThrow("lost reply");const id=f.session.getSnapshot().pending;
  const remount=new CarrierTuneSession(f.request,f.journal);await remount.refresh();
  expect(remount.getSnapshot().pending).toBeNull();expect(f.request).toHaveBeenCalledWith({action:"receipt",operation_id:id});
  expect(f.request.mock.calls.filter(([p])=>p.action==="tune")).toHaveLength(1);
});
it("unknown acquisition gates another Tune until review; old recovery never clears newer feedback",async()=>{
  const f=fixture(),normal=f.request.getMockImplementation()!;let unknown=true;
  f.request.mockImplementation(async p=>{const r=await normal(p);if(p.action==="tune"&&unknown){unknown=false;r.status="unknown";}return r;});
  await expect(f.session.tune("direct_agent")).rejects.toThrow("unknown");const old=f.session.getSnapshot().pending!;
  await expect(f.session.tune("direct_agent")).rejects.toThrow("Cancel remains available");await f.session.review();
  await f.session.tune("direct_agent");const message=f.session.getSnapshot().message;await f.session.check(old);
  expect(f.session.getSnapshot().message).toBe(message);expect(f.request.mock.calls.filter(([p])=>p.action==="tune")).toHaveLength(2);
});
it("stale renderer connection cannot relabel native identity; changed selection and storage failure never key",async()=>{
  const f=fixture();await f.session.tune("direct_agent",{selection:{provider:"direct_agent",generation:2,selection_id:target.selection_id},radio:{snapshot:{generation:99}}} as any);
  expect(f.request.mock.calls.find(([p])=>p.action==="tune")![0].target).toEqual(target);
  const blocked=new CarrierTuneSession(f.request,{read:()=>null,write:()=>{throw new Error("storage");}});
  await expect(blocked.tune("direct_agent")).rejects.toThrow("storage");
  await expect(f.session.tune("direct_agent",{selection:{provider:"direct_agent",generation:3,selection_id:target.selection_id}} as any)).rejects.toThrow("Refresh");
  expect(f.request.mock.calls.filter(([p])=>p.action==="tune")).toHaveLength(1);
});
