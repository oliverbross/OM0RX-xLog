import {invoke} from "@tauri-apps/api/core";
import type {CarrierTarget} from "./carrierTune";
export type PTTReceipt={operation_id:string;enabled:boolean;owner_id:string;target:CarrierTarget;status:"pending"|"unknown"|"acknowledged"|"confirmed"|"released"|"reviewed"|"recovered"};
type Duty={owner_id:string;target:CarrierTarget};
type Base={target:CarrierTarget|null;receipts:PTTReceipt[];release_required:Duty|null;intent?:string};
type Request=<T>(p:Record<string,unknown>)=>Promise<T>;
type State={onBusy:boolean;offBusy:boolean;pending:string[];receipts:PTTReceipt[];releaseRequired:Duty|null;message:string;feedback:string|null};
const key="xlog.ptt.pending",storage={read:():string[]=>{try{return JSON.parse(sessionStorage.getItem(key)||"[]");}catch{return[];}},write:(ids:string[])=>{sessionStorage.setItem(key,JSON.stringify(ids));}};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const keys=["provider","selection_id","selection_generation","worker_generation","connection_generation","control_revision","observation_revision","received_at_ms"] as const;
const target=(v:any):v is CarrierTarget=>v&&["direct_agent","direct_flex_lan"].includes(v.provider)&&uuid(v.selection_id)&&keys.filter(k=>k!=="provider"&&k!=="selection_id").every(k=>Number.isSafeInteger(v[k])&&v[k]>=0)&&v.worker_generation>0;
const receipt=(r:any,id:string):r is PTTReceipt=>r?.operation_id===id&&uuid(id)&&uuid(r.owner_id)&&typeof r.enabled==="boolean"&&target(r.target)&&["pending","unknown","acknowledged","confirmed","released","reviewed","recovered"].includes(r.status);
const terminal=(r:PTTReceipt)=>["confirmed","released","reviewed","recovered"].includes(r.status);
const native:Request=params=>invoke("ptt_session_request",{params});
export class PTTSession{
  private state:State;private listeners=new Set<()=>void>();private inFlight=new Set<string>();private resolved=new Set<string>();
  constructor(private request:Request=native,private journal=storage){const saved=journal.read();this.state={onBusy:false,offBusy:false,pending:Array.isArray(saved)?saved.filter(uuid).slice(0,256):[],receipts:[],releaseRequired:null,message:"",feedback:null};this.state.feedback=this.state.pending.at(-1)??null;}
  getSnapshot=()=>this.state;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  private feedback(id:string,message:string){if(this.state.feedback===id)this.update({message});}
  private retain(r:PTTReceipt){if(terminal(r))this.resolved.add(r.operation_id);else if(this.resolved.has(r.operation_id))return;
    const pending=terminal(r)?this.state.pending.filter(id=>id!==r.operation_id):[...new Set([...this.state.pending,r.operation_id])];if(pending.length>256)throw new Error("PTT receipt journal full");this.journal.write(pending);this.update({pending,receipts:[...this.state.receipts.filter(old=>old.operation_id!==r.operation_id),r]});}
  private accept(base:Base){if(!Array.isArray(base.receipts)||base.release_required!==null&&(!uuid(base.release_required?.owner_id)||!target(base.release_required?.target)))throw new Error("Native PTT state unavailable");
    this.update({releaseRequired:base.release_required});for(const r of base.receipts){if(!receipt(r,r.operation_id))throw new Error("Invalid native PTT receipt");if(!this.inFlight.has(r.operation_id))this.retain(r);}}
  async refresh(){const saved=[...this.state.pending];this.accept(await this.request<Base>({action:"snapshot"}));await Promise.all(saved.filter(id=>!this.inFlight.has(id)).map(id=>this.check(id)));}
  async set(enabled:boolean,provider?:CarrierTarget["provider"]){const lane=enabled?"onBusy":"offBusy";if(this.state[lane])throw new Error("This PTT lane is busy; PTT off remains independent");const marker=crypto.randomUUID();this.update({[lane]:true,feedback:marker,message:""});let id:string|null=null;
    try{const base=await this.request<Base>({action:"prepare",enabled});this.accept(base);
      if(enabled&&(base.release_required||base.receipts.some(r=>["pending","unknown"].includes(r.status))))throw new Error("Resolve retained GUI PTT release and receipts before PTT on");
      if(!enabled&&!base.release_required)throw new Error("No retained GUI PTT owner is available to release");
      const t=base.target;if(!target(t)||(provider!==undefined&&t.provider!==provider)||!uuid(base.intent))throw new Error("Exact native PTT authority unavailable");
      id=crypto.randomUUID();const pending=[...this.state.pending,id];if(pending.length>256)throw new Error("PTT journal full");this.journal.write(pending);this.inFlight.add(id);this.update({pending,...(this.state.feedback===marker?{feedback:id}:{})});
      const r=await this.request<PTTReceipt>({action:enabled?"on":"off",operation_id:id,target:t,intent:base.intent});
      if(!receipt(r,id)||r.enabled!==enabled||r.owner_id!==(enabled?id:base.release_required!.owner_id)||!keys.every(k=>r.target[k]===t[k]))throw new Error("PTT receipt identity lost; inspect without replay");this.retain(r);
      if(r.status==="unknown"||r.status==="pending")throw new Error("PTT outcome unknown. Use owned PTT off and inspect the retained receipt; no command will be replayed.");
      this.feedback(id,r.status==="confirmed"?`PTT ${enabled?"on":"off"} confirmed by newer transmit readback.`:`Agent PTT ${enabled?"on":"off"} acknowledged; waiting for newer observed TX/RX proof. Release duty remains.`);
      return{accepted:true,confirmed:r.status==="confirmed"};
    }catch(e){this.feedback(id??marker,e instanceof Error?e.message:"PTT outcome unknown");throw e;}finally{if(id)this.inFlight.delete(id);this.update({[lane]:false});}}
  async check(id:string){if(this.inFlight.has(id))return;const r=await this.request<PTTReceipt|null>({action:"receipt",operation_id:id});if(r){if(!receipt(r,id))throw new Error("PTT receipt mismatch");this.retain(r);}else{const pending=this.state.pending.filter(p=>p!==id);this.journal.write(pending);this.update({pending});}this.feedback(id,r?`PTT receipt: ${r.status}. No command repeated.`:"No PTT operation admitted under this identity. No command repeated.");}
  async review(id:string){if(this.inFlight.has(id))return;const r=await this.request<PTTReceipt>({action:"review",operation_id:id});if(!receipt(r,id)||r.status!=="reviewed")throw new Error("PTT review unavailable");this.retain(r);this.feedback(id,"PTT uncertainty reviewed. Owned release duty is unchanged; observe RX using PTT off.");}
  async recoverRetiredOwner(){const marker=crypto.randomUUID();this.update({feedback:marker,message:""});let id:string|null=null;try{
    const base=await this.request<Base>({action:"snapshot"});this.accept(base);const duty=base.release_required,t=base.target;
    if(!duty||!target(t))throw new Error("Retained PTT owner and exact current target are required");
    id=crypto.randomUUID();const pending=[...this.state.pending,id];if(pending.length>256)throw new Error("PTT journal full");this.journal.write(pending);this.inFlight.add(id);this.update({pending,...(this.state.feedback===marker?{feedback:id}:{})});
    const r=await this.request<PTTReceipt>({action:"recover",operation_id:id,owner_id:duty.owner_id,target:t});
    if(!receipt(r,id)||r.status!=="recovered"||r.enabled||r.owner_id!==duty.owner_id||!keys.every(k=>r.target[k]===t[k]))throw new Error("PTT recovery decision identity lost; check receipt without replay");
    this.retain(r);await this.refresh();this.feedback(id,"Retired PTT owner recovered using native retirement and fresh RX proof. No Off command was sent.");
  }catch(e){this.feedback(id??marker,e instanceof Error?e.message:"PTT recovery unknown");throw e;}finally{if(id)this.inFlight.delete(id);}}
}
let shared:PTTSession|undefined;export const pttSession=()=>shared??=new PTTSession();
