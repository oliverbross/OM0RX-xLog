import { invoke } from "@tauri-apps/api/core";
import type { CarrierTarget } from "./carrierTune";
import type { MonitorContext } from "./monitorContext";
export type AmplifierAction = "operate" | "standby";
type Preparation={session:string;epoch:string;action:AmplifierAction};
export type AmplifierReceipt = { operation_id:string; action:AmplifierAction; target:CarrierTarget; status:"pending"|"unknown"|"acknowledged"|"reviewed"; detail?:{code?:string;message?:string}|null };
type Request = <T>(params:Record<string,unknown>)=>Promise<T>;
type State = { receipts:AmplifierReceipt[]; pending:string[]; operateBusy:boolean; standbyBusy:boolean; message:string; feedback:string|null };
const key="xlog.amplifier-transition.pending";
const storage={read:():string[]=>{try {return JSON.parse(sessionStorage.getItem(key)||"[]");}catch{return [];}},write:(ids:string[])=>{sessionStorage.setItem(key,JSON.stringify(ids));}};
const native:Request=params=>invoke("amplifier_transition_request",{params});
const keys=["provider","selection_generation","selection_id","worker_generation","connection_generation","control_revision","observation_revision","received_at_ms"] as const;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const validTarget=(t:any):t is CarrierTarget=>t?.provider==="direct_agent"&&uuid(t.selection_id)&&keys.filter(k=>!['provider','selection_id'].includes(k)).every(k=>Number.isSafeInteger(t[k])&&t[k]>=0)&&t.worker_generation>0;
const validReceipt=(r:any,id:string):r is AmplifierReceipt=>r?.operation_id===id&&uuid(id)&&["operate","standby"].includes(r.action)&&validTarget(r.target)&&["pending","unknown","acknowledged","reviewed"].includes(r.status);
const unresolved=(r:AmplifierReceipt)=>r.status==="pending"||r.status==="unknown";
export class AmplifierTransitionSession {
  private state:State;
  private listeners=new Set<()=>void>();
  private inFlight=new Set<string>();
  private resolved=new Set<string>();
  private standbyRevision=0;
  constructor(private request:Request=native,private journal=storage){const saved=journal.read();const pending=Array.isArray(saved)?[...new Set(saved.filter(uuid))].slice(0,256):[];this.state={receipts:[],pending,operateBusy:false,standbyBusy:false,message:"",feedback:pending.at(-1)??null};}
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(change:Partial<State>){this.state={...this.state,...change};this.listeners.forEach(listener=>listener());}
  private retain(r:AmplifierReceipt){
    const terminal=!unresolved(r);if(terminal)this.resolved.add(r.operation_id);else if(this.resolved.has(r.operation_id))return;
    const pending=terminal?this.state.pending.filter(id=>id!==r.operation_id):[...new Set([...this.state.pending,r.operation_id])];
    if(pending.length>256)throw new Error("Amplifier recovery journal is full; inspect existing receipts.");
    this.journal.write(pending);this.update({pending,receipts:[...this.state.receipts.filter(old=>old.operation_id!==r.operation_id),r]});
  }
  private feedback(id:string,message:string){if(this.state.feedback===id)this.update({message});}
  async refresh(){
    const retained=[...this.state.pending];const base=await this.request<{receipts:AmplifierReceipt[]}>({action:"snapshot"});
    if(!Array.isArray(base.receipts))throw new Error("Amplifier journal unavailable.");
    for(const r of base.receipts){if(!validReceipt(r,r.operation_id))throw new Error("Invalid amplifier receipt.");if(!this.inFlight.has(r.operation_id))this.retain(r);}
    await Promise.all(retained.filter(id=>!this.inFlight.has(id)).map(id=>this.check(id)));
  }
  async transition(action:AmplifierAction,context?:MonitorContext|null){
    // Capture user intent before the snapshot await: its eventual reply may
    // contain a newer native revision, but cannot revive an older preparation.
    if(action==="standby")this.standbyRevision++;
    const revision=this.standbyRevision;
    const requireCurrent=()=>{if(action==="operate"&&revision!==this.standbyRevision)throw new Error("Operate was superseded by a later Standby; no Operate was sent.");};
    if(this.state[action==="operate"?"operateBusy":"standbyBusy"])throw new Error("That amplifier lane is busy. Standby remains independent of Operate.");
    if(action==="operate"&&this.state.pending.length)throw new Error("Inspect unresolved amplifier receipts before Operate. Standby remains available.");
    const marker=crypto.randomUUID();this.update({[action==="operate"?"operateBusy":"standbyBusy"]:true,feedback:marker,message:""});let id:string|null=null;
    try{
      // Native registers this preparation before reading a target. Its token is
      // shared across WebViews; a newer Monitor Standby retires Desk preparation.
      const base=await this.request<{target:CarrierTarget|null;receipts:AmplifierReceipt[];preparation:Preparation}>({action:"prepare",transition:action});
      requireCurrent();
      const preparation=base.preparation;
      if(!preparation||!uuid(preparation.session)||!uuid(preparation.epoch)||preparation.action!==action)throw new Error("Amplifier preparation authority unavailable; no transition was sent.");
      if(!Array.isArray(base.receipts))throw new Error("Amplifier journal unavailable.");
      for(const r of base.receipts){if(!validReceipt(r,r.operation_id))throw new Error("Invalid amplifier receipt.");this.retain(r);}
      if(action==="operate"&&base.receipts.some(unresolved))throw new Error("Inspect unresolved amplifier receipts before Operate. Standby remains available.");
      const target=base.target;
      if(!validTarget(target)||context?.acceptance||context&&(context.selection?.provider!=="direct_agent"||context.selection.selection_id!==target.selection_id||context.selection.generation!==target.selection_generation))throw new Error("Refresh exact Agent selection authority before amplifier control.");
      id=crypto.randomUUID();const pending=[...this.state.pending,id];if(pending.length>256)throw new Error("Amplifier recovery journal is full.");
      this.journal.write(pending);this.inFlight.add(id);this.update({pending,...(this.state.feedback===marker?{feedback:id}:{})});
      requireCurrent();
      const r=await this.request<AmplifierReceipt>({action,operation_id:id,target,preparation});
      if(!validReceipt(r,id)||r.action!==action||!keys.every(k=>r.target[k]===target[k]))throw new Error("Amplifier receipt could not be verified; outcome unknown.");
      this.retain(r);
      if(unresolved(r))throw new Error(`Amplifier ${action} outcome unknown${r.detail?.code?` (${r.detail.code})`:""}${r.detail?.message?`: ${r.detail.message}`:""}. Inspect its receipt; no transition will be replayed.`);
      this.feedback(id,"");
      return{accepted:true,confirmed:false};
    }catch(cause){this.feedback(id??marker,cause instanceof Error?cause.message:"Amplifier outcome unknown; inspect its receipt.");throw cause;}
    finally{if(id)this.inFlight.delete(id);this.update({[action==="operate"?"operateBusy":"standbyBusy"]:false});}
  }
  async check(id:string){
    if(this.inFlight.has(id))return;
    const r=await this.request<AmplifierReceipt|null>({action:"receipt",operation_id:id});
    if(r){if(!validReceipt(r,id))throw new Error("Amplifier receipt identity mismatch.");this.retain(r);}
    else{this.journal.write(this.state.pending.filter(p=>p!==id));this.update({pending:this.state.pending.filter(p=>p!==id)});}
    this.feedback(id,r?`Amplifier ${r.action} receipt: ${r.status}${r.detail?.code?` (${r.detail.code})`:""}. No command was repeated.`:"No amplifier transition was admitted under this identity. No command was repeated.");
  }
  async review(id:string){
    if(this.inFlight.has(id))return;
    const r=await this.request<AmplifierReceipt>({action:"review",operation_id:id});
    if(!validReceipt(r,id)||r.status!=="reviewed")throw new Error("Amplifier review could not be verified.");this.retain(r);
    this.feedback(id,"Unknown amplifier transition reviewed. Observe station state before another explicit action. RF release obligations remain unchanged.");
  }
}
let shared:AmplifierTransitionSession|undefined;
export const amplifierTransitionSession=()=>shared??=new AmplifierTransitionSession();
