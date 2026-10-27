import { canonicalJSON, ContestServerError } from "./client";
type Scope={sessionID:string;workspaceGeneration:string};
type Request=(method:string,params:Record<string,unknown>)=>Promise<any>;
const methods=new Set(["contest_strategy_apply","contest_message_bank_save","contest_message_bank_activate","contest_operating_plan_save"]);
export const planningRecoveryKey=(scope:Scope)=>`xlog.contest.planning-pending.v1/${scope.workspaceGeneration}/${scope.sessionID}`;
function restored(storage:Storage,key:string,scope:Scope){
  const raw=storage.getItem(key);if(raw===null)return null;
  let value:any;try{value=JSON.parse(raw);}catch{throw Error("Planning recovery is unreadable. The original record is preserved; no new save was sent.");}
  if(value?.version!==1||!methods.has(value.method)||value.params?.sessionID!==scope.sessionID||value.params?.workspaceGeneration!==scope.workspaceGeneration||
    !/^[0-9a-f-]{36}$/.test(String(value.params?.operationID))||!Number.isSafeInteger(value.params?.expectedRevision)||
    typeof value.params?.draftID!=="string"||typeof value.intent!=="string")throw Error("Planning recovery does not match this session. Preserve the original record before recovery.");
  return value as {version:1;method:string;params:Record<string,unknown>;intent:string};
}
/** Finite planning saves reuse the host's existing operation receipt, never output. */
export async function planningMutation(scope:Scope,method:string|null,params:Record<string,unknown>,request:Request,storage:Storage=localStorage){
  const key=planningRecoveryKey(scope),saved=restored(storage,key,scope);
  const intent=method===null?null:canonicalJSON({method,params:Object.fromEntries(Object.entries(params).filter(([name])=>!["operationID","expectedRevision","draftID","nowUTC"].includes(name)))});
  if(saved&&intent!==null&&saved.intent!==intent)throw Error("Recover the previous planning action before starting another save.");
  if(!saved&&method===null)return null;
  if(!saved&&(!method||!methods.has(method)))throw Error("Unsupported planning operation");
  const item=saved??{version:1 as const,method:method!,params,intent:intent!};
  if(!saved){const raw=JSON.stringify(item);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error("Planning recovery could not be saved; no operation was sent.");}
  let mutationAttempted=false;
  try{
    const receipt=await request("contest_operation_receipt",{sessionID:scope.sessionID,operationID:item.params.operationID});
    if(!receipt.found)mutationAttempted=true;
    const result=receipt.found?receipt.result:await request(item.method,item.params);
    if(!result||result.operationID!==item.params.operationID||result.projection?.sessionID!==scope.sessionID||result.projection?.workspaceGeneration!==scope.workspaceGeneration||!Array.isArray(result.actions)||result.actions.length!==0)
      throw Error("Planning receipt could not be verified; retain it for recovery.");
    storage.removeItem(key);return result;
  }catch(cause){
    if(mutationAttempted&&cause instanceof ContestServerError&&cause.outcome!=="uncertain"){
      const archive=`${key}/rejected/${item.params.operationID}`,raw=storage.getItem(key)!;
      storage.setItem(archive,raw);if(storage.getItem(archive)===raw)storage.removeItem(key);
    }
    throw cause;
  }
}
