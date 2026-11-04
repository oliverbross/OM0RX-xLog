import { useEffect, useMemo, useState } from "react";
import type { ContestRequest } from "./types";

type QTCDirectionCapability={eligibility:"unknown"|"eligible"|"ineligible";reason:string|null;availableSources:number|null;opportunity:boolean};
export type QTCOpportunity={eligibility:"unknown"|"eligible"|"ineligible";reason:string|null;direction:"send"|"receive";
  remaining:number;confirmed:number;reserved:number;availableSources:number|null;
  capabilities?:{send:QTCDirectionCapability;receive:QTCDirectionCapability};
  observation:{status:"unknown"|"available"|"later"|"unavailable";observedUTC?:string;note?:string};opportunity:boolean};
export type QTCOpportunityProjection={schema:1;revision:number;opportunities:Record<string,QTCOpportunity>};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const bounded=(value:unknown,max:number)=>typeof value==="string"&&new TextEncoder().encode(value).length<=max;
const count=(value:unknown,max=1_000_000)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max;
const capability=(value:unknown)=>record(value)&&Object.keys(value).length===4&&
  Object.keys(value).every(key=>["eligibility","reason","availableSources","opportunity"].includes(key))&&
  ["unknown","eligible","ineligible"].includes(String(value.eligibility))&&(value.reason===null||bounded(value.reason,512))&&
  (value.availableSources===null||count(value.availableSources))&&typeof value.opportunity==="boolean";
export function validQTCOpportunities(value:unknown):value is QTCOpportunityProjection{
  if(!record(value)||value.schema!==1||!count(value.revision,Number.MAX_SAFE_INTEGER)||!record(value.opportunities)||Object.keys(value).some(key=>!["schema","revision","opportunities"].includes(key))||Object.keys(value.opportunities).length>2000)return false;
  return Object.entries(value.opportunities).every(([call,row])=>/^[A-Z0-9/]{3,32}$/.test(call)&&record(row)&&
    Object.keys(row).every(key=>["eligibility","reason","direction","remaining","confirmed","reserved","availableSources","observation","opportunity","capabilities"].includes(key))&&
    (row.capabilities===undefined||record(row.capabilities)&&Object.keys(row.capabilities).length===2&&capability(row.capabilities.send)&&capability(row.capabilities.receive))&&
    ["unknown","eligible","ineligible"].includes(String(row.eligibility))&&(row.reason===null||bounded(row.reason,512))&&["send","receive"].includes(String(row.direction))&&
    count(row.remaining,10)&&count(row.confirmed)&&count(row.reserved)&&(row.availableSources===null||count(row.availableSources))&&typeof row.opportunity==="boolean"&&record(row.observation)&&
    Object.keys(row.observation).every(key=>["status","observedUTC","note"].includes(key))&&["unknown","available","later","unavailable"].includes(String(row.observation.status))&&
    (row.observation.observedUTC===undefined||bounded(row.observation.observedUTC,64))&&(row.observation.note===undefined||bounded(row.observation.note,256)));
}
export function qtcOpportunityFor(projection:QTCOpportunityProjection|undefined|null,call:unknown){
  return typeof call==="string"?projection?.opportunities[call.trim().toUpperCase()]:undefined;
}
export function qtcOpportunityLabel(row:QTCOpportunity|undefined){
  if(!row)return "QTC eligibility unknown · waiting for the contest owner";
  if(row.capabilities){
    const directions=(["send","receive"] as const).map(direction=>{
      const value=row.capabilities![direction];
      return `${direction} ${value.eligibility}${value.availableSources===null?"":` · ${value.availableSources} source contacts`} · ${value.opportunity?"opportunity":"no capacity"}${value.reason?` · ${value.reason}`:""}`;
    }).join("; ");
    return `QTC ${directions} · ${row.remaining} remaining · ${row.confirmed} confirmed · ${row.reserved} reserved (shared send/receive quota) · local ${row.observation.status}`+
      `${row.observation.observedUTC?` at ${row.observation.observedUTC}`:""}${row.observation.note?` · ${row.observation.note}`:""}`;
  }
  return `QTC ${row.direction} · ${row.eligibility} · ${row.remaining} remaining · ${row.confirmed} confirmed · ${row.reserved} reserved`+
    `${row.availableSources===null?"":` · ${row.availableSources} source contacts`} · local ${row.observation.status}`+
    `${row.observation.observedUTC?` at ${row.observation.observedUTC}`:""}${row.reason?` · ${row.reason}`:""}${row.observation.note?` · ${row.observation.note}`:""}`;
}
/** Read the existing journal projection; React does no quota/scoring arithmetic. */
export function useQTCOpportunities(scope:{sessionID:string;workspaceGeneration:string;revision:number;pluginID:string}|null,
  spots:readonly {callsign?:unknown}[],request:ContestRequest){
  const calls=useMemo(()=>[...new Set(spots.flatMap(spot=>typeof spot.callsign==="string"&&/^[A-Z0-9/]{3,32}$/.test(spot.callsign.trim().toUpperCase())?[spot.callsign.trim().toUpperCase()]:[]))].sort().slice(0,2000),[spots]);
  const signature=calls.join("|"),identity=scope?`${scope.sessionID}/${scope.workspaceGeneration}/${scope.revision}`:"";
  const [result,setResult]=useState<{identity:string;signature:string;value:QTCOpportunityProjection}|null>(null);
  const enabled=!!scope&&["wae_cw","wae_ssb","wae_rtty"].includes(scope.pluginID);
  useEffect(()=>{
    if(!enabled||!scope)return;let current=true;
    const timer=window.setTimeout(()=>{void(async()=>{
      const chunks=Array.from({length:Math.ceil(calls.length/200)},(_,index)=>calls.slice(index*200,index*200+200));
      const frames=await Promise.all(chunks.map(counterparts=>request<{opportunities:Record<string,QTCOpportunity>}>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,
        expectedRevision:scope.revision,section:"qtc",counterparts})));
      const opportunities=Object.fromEntries(frames.flatMap(frame=>{if(!frame.ok)throw Error(frame.error.message);return Object.entries(frame.result.opportunities??{});}));
      const value={schema:1 as const,revision:scope.revision,opportunities};
      if(!validQTCOpportunities(value))throw Error("The QTC owner returned an invalid opportunity projection.");
      if(current)setResult({identity,signature,value});
    })().catch(()=>{if(current)setResult(null);});},200);
    return()=>{current=false;window.clearTimeout(timer);};
  },[enabled,scope?.sessionID,scope?.workspaceGeneration,scope?.revision,signature,request]);
  return enabled?result?.identity===identity&&result.signature===signature?result.value:{schema:1 as const,revision:scope!.revision,opportunities:{}}:undefined;
}
