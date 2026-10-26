import type { ContestRequest } from "./types";

export type AssistanceScope = {sessionID:string;workspaceGeneration:string;revision:number;draftID:string};
export type AssistanceCoordinates = Omit<AssistanceScope,"revision"> & {expectedRevision:number;requestID:string};
export type ReverseOptions = {query:string;fieldID:string;matchMode:"prefix"|"contains";source:"history"|"log";offset:number;limit:number};
export type ReverseCandidate = {candidateID:string;callsign:string;sourceLabel:string;sourceDate:string;
  comparedFields:{id:string;label:string;value:string}[]};
export type ReverseResult = AssistanceCoordinates & {evaluatedAtUTC:string;query:string;offset:number;limit:number;
  fieldID:string;source:"history"|"log";matchMode:"prefix"|"contains";fields:{id:string;label:string}[];
  dataset:{generation:string;digest:string;rowCount:number}|null;rows:ReverseCandidate[];nextOffset:number|null;unsupportedReason:string|null};
export type DupesheetResult = AssistanceCoordinates & {evaluatedAtUTC:string;query:string;offset:number;limit:number;
  rows:{callsign:string;lastWorkedUTC:string;contactCount:number;isDupe:boolean|null}[];totalCalls:number;nextOffset:number|null;
  scopeDescription:string;frequencyHz:number;mode:string;roverLocation:string};
type RawRequest=<T>(method:string,params:Record<string,unknown>)=>Promise<{ok:boolean;result?:T;error?:{message?:string}}>;
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const text=(v:unknown,max=512):v is string=>typeof v==="string"&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const natural=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export const assistanceKey=(scope:AssistanceScope)=>`${scope.sessionID}/${scope.workspaceGeneration}/${scope.revision}/${scope.draftID}`;
export function assistanceCoordinates(scope:AssistanceScope):AssistanceCoordinates {
  return {sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,draftID:scope.draftID,requestID:crypto.randomUUID()};
}
function common(value:unknown,coordinates:AssistanceCoordinates,query:string,offset:number,limit:number):Record<string,unknown> {
  const v=record(value);
  if(!v||!Object.entries(coordinates).every(([key,val])=>v[key]===val)||v.query!==query.trim().toUpperCase()||v.offset!==offset||v.limit!==limit||
    !text(v.evaluatedAtUTC,32)||!Array.isArray(v.rows)||v.rows.length>limit||!(v.nextOffset===null||v.nextOffset===offset+limit))
    throw new Error("Malformed or stale assistance response.");
  return v;
}
async function read(request:ContestRequest,method:string,params:Record<string,unknown>):Promise<unknown> {
  const response=await (request as RawRequest)<unknown>(method,params);
  if(!response?.ok)throw new Error(response?.error?.message||"Contest assistance is unavailable.");
  return response.result;
}
export async function reverseHistory(request:ContestRequest,coordinates:AssistanceCoordinates,options:ReverseOptions):Promise<ReverseResult> {
  const v=common(await read(request,"contest_assistance_reverse",{...coordinates,...options}),coordinates,options.query,options.offset,options.limit);
  const fields=v.fields,rows=v.rows as unknown[],dataset=record(v.dataset);
  if(v.fieldID!==options.fieldID||v.source!==options.source||v.matchMode!==options.matchMode||
    !Array.isArray(fields)||fields.length>4||!fields.every(f=>{const x=record(f);return x&&text(x.id,32)&&text(x.label,128);})||
    !(v.unsupportedReason===null||text(v.unsupportedReason))||
    !(v.dataset===null||dataset&&text(dataset.generation,64)&&typeof dataset.digest==="string"&&/^[a-f0-9]{64}$/.test(dataset.digest)&&natural(dataset.rowCount))||
    !rows.every(row=>{const r=record(row);return r&&text(r.candidateID,64)&&typeof r.callsign==="string"&&/^[A-Z0-9/]{2,32}$/.test(r.callsign)&&
      text(r.sourceLabel,128)&&text(r.sourceDate)&&Array.isArray(r.comparedFields)&&r.comparedFields.length<=4&&
      r.comparedFields.every(cell=>{const c=record(cell);return c&&text(c.id,32)&&text(c.label,128)&&text(c.value);});}))
    throw new Error("Malformed reverse history response.");
  return v as unknown as ReverseResult;
}
export async function visibleDupesheet(request:ContestRequest,coordinates:AssistanceCoordinates,query:string,offset=0,limit=50):Promise<DupesheetResult> {
  const v=common(await read(request,"contest_assistance_dupesheet",{...coordinates,query,offset,limit}),coordinates,query,offset,limit);
  if(!natural(v.totalCalls)||!text(v.scopeDescription)||!natural(v.frequencyHz)||!text(v.mode,32)||!text(v.roverLocation,32)||
    !(v.rows as unknown[]).every(row=>{const r=record(row);return r&&text(r.callsign,32)&&text(r.lastWorkedUTC,32)&&natural(r.contactCount)&&
      (r.isDupe===null||typeof r.isDupe==="boolean");}))throw new Error("Malformed visible dupesheet response.");
  return v as unknown as DupesheetResult;
}
