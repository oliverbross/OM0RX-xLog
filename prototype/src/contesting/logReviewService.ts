import { invoke } from "@tauri-apps/api/core";
import { reviewTime, validReviewCall, type ReviewOptions, type ReviewQSO, type ReviewResult, type ReviewSpot, type ReviewReferences } from "./logReview";
export type ReviewContext = {sessionID:string;workspaceGeneration:string;revision:number;total:number;rows:ReviewQSO[]};
export type ArchiveStatus = {status:{total:number;earliest:string|null;latest:string|null}|null;
  recording:{state:string;queued:number;unrecorded:number;retainedGap?:boolean;unknownGap?:boolean}};
export type ReviewSnapshot = {context:ReviewContext;qsos:ReviewQSO[];spots:ReviewSpot[];archive:ArchiveStatus;
  watermark:number|null;truncated:boolean;arrivalFrom:string|null;arrivalTo:string|null;capturedAt:string;references:ReviewReferences};
export type ReviewRead = (method:string,params:Record<string,unknown>,context?:ReviewContext)=>Promise<any>;
export const readReview: ReviewRead = (method,params,context) => invoke("contest_log_review_read", {
  method,params,sessionId:context?.sessionID ?? null,workspaceGeneration:context?.workspaceGeneration ?? null,
});
const check = (signal:AbortSignal) => { if(signal.aborted) throw new DOMException("Review cancelled.","AbortError"); };
const yieldRead = async(signal:AbortSignal) => { await new Promise(resolve=>setTimeout(resolve,20)); check(signal); };

export async function collectReview(read:ReviewRead, signal:AbortSignal, progress:(text:string)=>void):Promise<ReviewSnapshot> {
  check(signal);
  const context:ReviewContext = await read("context",{}); check(signal);
  if(!context.sessionID || !Number.isSafeInteger(context.revision) || !Number.isSafeInteger(context.total)
      || context.total < 0 || !Array.isArray(context.rows)) throw new Error("The contest log snapshot is invalid.");
  if(context.total > 20000) throw new Error("This first review version supports up to 20,000 contacts per contest.");
  const qsos = [...context.rows];
  while(qsos.length<context.total) {
    progress(`Reading contacts: ${qsos.length} / ${context.total}`);
    await yieldRead(signal);
    const page = await read("contest_log_page",{expectedRevision:context.revision,offset:qsos.length,limit:100},context);
    check(signal);
    if(page.revision!==context.revision || page.total!==context.total || !Array.isArray(page.rows) || !page.rows.length)
      throw new Error("The contest changed during review. Run it again after logging or editing finishes.");
    qsos.push(...page.rows);
  }
  if(qsos.length!==context.total || new Set(qsos.map(qso=>qso.ID)).size!==qsos.length)
    throw new Error("The contest snapshot contains inconsistent contact pages. Run the review again.");
  const archive:ArchiveStatus = await read("spot_history_status",{},context); check(signal);
  const times=qsos.map(qso=>reviewTime(qso.TS)).filter(Number.isFinite);
  // Query filters use ARRIVAL time, while comparison uses REPORTED time.
  // Allow a day on each side for historical replies and disclose the acquisition window.
  const arrivalFrom=times.length?new Date(Math.min(...times)-86400000).toISOString():null;
  const arrivalTo=times.length?new Date(Math.max(...times)+86400000).toISOString():null;
  const spots:ReviewSpot[]=[];
  let cursor:string|null=null, watermark:number|null=null, truncated=false;
  if(arrivalFrom && arrivalTo) do {
    await yieldRead(signal);
    const response=await read("spot_history_query",{from:arrivalFrom,to:arrivalTo,limit:100,
      ...(cursor?{cursor}:{}),...(watermark===null?{}:{watermark})},context);
    check(signal);
    const page=response.page;
    if(!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.watermark)
      || (watermark!==null && page.watermark!==watermark) || (cursor && page.nextCursor===cursor))
      throw new Error("The spot archive returned an inconsistent page.");
    watermark=page.watermark; spots.push(...page.rows); cursor=page.nextCursor ?? null;
    progress(`Reading archived reports: ${spots.length.toLocaleString()}`);
    if(spots.length>=50000 && cursor) {truncated=true;break;}
  } while(cursor);
  const references:ReviewReferences={sources:[],rows:[]};
  const referenceContacts=qsos.filter(qso=>qso.ID && qso.ID.length<=128 && Number.isFinite(reviewTime(qso.TS)) && validReviewCall(qso.Call.trim().toUpperCase()));
  let referenceVersion:string|undefined;
  for(let offset=0;offset<referenceContacts.length;offset+=100) {
    await yieldRead(signal);
    progress(`Checking local country and LoTW references: ${offset} / ${referenceContacts.length}`);
    const contacts=referenceContacts.slice(offset,offset+100).map(qso=>({id:qso.ID,call:qso.Call.trim().toUpperCase(),
      timestamp:new Date(reviewTime(qso.TS)).toISOString()}));
    const response:ReviewReferences=await read("reference_log_review",{contacts},context);check(signal);
    if(!Array.isArray(response.sources)||!Array.isArray(response.rows)||response.rows.length!==contacts.length
      ||response.rows.some((row,index)=>row.id!==contacts[index].id||row.call!==contacts[index].call||!Array.isArray(row.countries)))
      throw new Error("The local reference check returned an inconsistent batch.");
    const version=JSON.stringify(response.sources);
    if(referenceVersion!==undefined && referenceVersion!==version)
      throw new Error("Local reference files changed during review. Run the review again.");
    referenceVersion=version;references.sources=response.sources;references.rows.push(...response.rows);
  }
  // Validate the log revision again after reading the archive, without modifying a draft.
  await yieldRead(signal);
  const end=await read("contest_log_page",{expectedRevision:context.revision,offset:0,limit:1},context);
  check(signal);
  if(end.revision!==context.revision || end.total!==context.total)
    throw new Error("The contest changed during review. Run it again after logging or editing finishes.");
  return {context,qsos,spots,archive,watermark,truncated,arrivalFrom,arrivalTo,capturedAt:new Date().toISOString(),references};
}

export function runReviewWorker(snapshot:ReviewSnapshot,options:ReviewOptions,signal:AbortSignal):Promise<ReviewResult> {
  return new Promise((resolve,reject)=>{
    check(signal);
    const worker=new Worker(new URL("./logReview.worker.ts",import.meta.url),{type:"module"});
    const finish=()=>{worker.terminate();signal.removeEventListener("abort",cancel);};
    const cancel=()=>{finish();reject(new DOMException("Review cancelled.","AbortError"));};
    signal.addEventListener("abort",cancel,{once:true});
    worker.onmessage=event=>{finish();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);};
    worker.onerror=()=>{finish();reject(new Error("The comparison worker could not complete. Run the review again."));};
    worker.postMessage({qsos:snapshot.qsos,spots:snapshot.spots,options,references:snapshot.references});
  });
}
