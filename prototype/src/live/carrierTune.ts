import { invoke } from "@tauri-apps/api/core";
import type { MonitorContext } from "./monitorContext";
import type { ReleaseTarget } from "./radioRelease";
export type CarrierTarget = ReleaseTarget & { control_revision: number; observation_revision: number; received_at_ms: number };
export type CarrierReceipt = { operation_id: string; target: CarrierTarget; status: "pending" | "unknown" | "acknowledged" | "confirmed" | "reviewed" };
type Snapshot = { target: CarrierTarget | null; receipts: CarrierReceipt[] };
type Request = <T>(params: Record<string, unknown>) => Promise<T>;
type State = { pending: string | null; busy: boolean; message: string; reviewable: boolean; feedback: string | null };
const key="xlog.carrier-tune.pending";
const storage={read:()=>{try{return sessionStorage.getItem(key);}catch{return null;}},write:(id:string|null)=>{if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);}};
const native:Request=params=>invoke("carrier_tune_request",{params});
const terminal=(r:CarrierReceipt)=>["acknowledged","confirmed","reviewed"].includes(r.status);
const targetKeys=["provider","selection_generation","selection_id","worker_generation","connection_generation","control_revision","observation_revision","received_at_ms"] as const;
const validTarget=(t:CarrierTarget|null):t is CarrierTarget=>!!t && ["direct_agent","direct_flex_lan"].includes(t.provider) && /^[0-9a-f-]{36}$/i.test(t.selection_id)
  && [t.selection_generation,t.worker_generation,t.connection_generation,t.control_revision,t.observation_revision,t.received_at_ms].every(v=>Number.isSafeInteger(v)&&v>=0) && t.worker_generation>0;
const validReceipt=(r:CarrierReceipt|null,id:string):r is CarrierReceipt=>!!r && r.operation_id===id && validTarget(r.target) && ["pending","unknown","acknowledged","confirmed","reviewed"].includes(r.status);
export class CarrierTuneSession {
  private state:State;
  private listeners=new Set<()=>void>();
  private inFlight=false;
  private resolved=new Set<string>();
  constructor(private request:Request=native,private journal=storage){const retained=journal.read();this.state={pending:retained,busy:false,message:"",reviewable:false,feedback:retained};}
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(change:Partial<State>){this.state={...this.state,...change};this.listeners.forEach(listener=>listener());}
  private retain(r:CarrierReceipt){
    if(terminal(r)){this.resolved.add(r.operation_id);if(this.state.pending===r.operation_id){this.journal.write(null);this.update({pending:null,reviewable:false});}}
    else if(!this.resolved.has(r.operation_id) && (!this.state.pending || this.state.pending===r.operation_id)){this.journal.write(r.operation_id);this.update({pending:r.operation_id,reviewable:r.status==="unknown"});}
  }
  async refresh(){
    const retained=this.state.pending;
    const base=await this.request<Snapshot>({action:"snapshot"});
    if(!this.inFlight && base.receipts?.length){const r=base.receipts[0];if(!validReceipt(r,r.operation_id))throw new Error("Carrier Tune receipt unavailable.");this.retain(r);}
    if(retained && !this.inFlight)await this.check(retained);
  }
  async tune(provider:CarrierTarget["provider"],context?:MonitorContext|null){
    if(this.state.busy||this.state.pending)throw new Error("Inspect the existing carrier Tune receipt before another acquisition. Cancel remains available.");
    this.update({busy:true,feedback:null,message:""});this.inFlight=true;
    try{
      const base=await this.request<Snapshot>({action:"snapshot"});
      if(base.receipts?.length){const r=base.receipts[0];if(!validReceipt(r,r.operation_id))throw new Error("Carrier Tune receipt unavailable.");this.retain(r);throw new Error("Review the unknown carrier Tune and observe RX before another acquisition. Cancel remains available.");}
      const target=base.target;
      if(!validTarget(target)||target.provider!==provider||context?.acceptance||context && (context.selection?.provider!==provider||context.selection.selection_id!==target.selection_id||context.selection.generation!==target.selection_generation))throw new Error("Refresh the selected radio before carrier Tune.");
      const id=crypto.randomUUID();this.journal.write(id);this.update({pending:id,feedback:id,reviewable:false});
      const r=await this.request<CarrierReceipt>({action:"tune",operation_id:id,target});
      if(!validReceipt(r,id)||!targetKeys.every(key=>r.target[key]===target[key]))throw new Error("Carrier Tune receipt could not be verified.");
      this.retain(r);
      if(!terminal(r))throw new Error("Carrier Tune outcome is unknown. Use Cancel and inspect its receipt; no Tune will be replayed.");
      this.update({message:r.status==="confirmed"?"Carrier transmit state confirmed by fresh radio readback. Cancel remains available.":"Carrier Tune acknowledged by the Agent; RF remains unconfirmed. Cancel remains available."});
      return{accepted:true,confirmed:r.status==="confirmed"};
    }catch(cause){this.update({message:cause instanceof Error?cause.message:"Carrier Tune outcome unknown; inspect its receipt. Cancel remains available."});throw cause;}
    finally{this.inFlight=false;this.update({busy:false});}
  }
  async check(id=this.state.pending){
    if(!id)return;if(this.inFlight)throw new Error("Carrier Tune is still being admitted. Cancel remains available.");
    const r=await this.request<CarrierReceipt|null>({action:"receipt",operation_id:id});
    if(r&&!validReceipt(r,id))throw new Error("Carrier Tune receipt does not match its retained operation.");
    if(r)this.retain(r);else if(this.state.pending===id){this.journal.write(null);this.update({pending:null,reviewable:false});}
    if(this.state.feedback===id)this.update({message:r?`Carrier Tune receipt: ${r.status}. No Tune was repeated.`:"No carrier Tune was admitted under this identity. No Tune was repeated."});
  }
  async review(){
    const id=this.state.pending;if(!id||!this.state.reviewable||this.inFlight)return;
    const r=await this.request<CarrierReceipt>({action:"review",operation_id:id});
    if(!validReceipt(r,id)||r.status!=="reviewed")throw new Error("Carrier Tune review could not be verified.");this.retain(r);
    if(this.state.feedback===id)this.update({message:"Unknown carrier Tune was reviewed. Observe RX and resolve owned TX with Cancel before a new explicit Tune. No Tune was repeated."});
  }
}
let shared:CarrierTuneSession|undefined;
export const carrierTuneSession=()=>shared??=new CarrierTuneSession();
