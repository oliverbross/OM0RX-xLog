import { invoke } from "@tauri-apps/api/core";
import type { AnalyticsMeta, AnalyticsRow } from "./contestAnalytics";
export type AnalyticsSnapshot={meta:AnalyticsMeta;rows:AnalyticsRow[]};
export type AnalyticsRead=(params:Record<string,unknown>,context?:AnalyticsMeta)=>Promise<any>;
export const readAnalytics:AnalyticsRead=(params,context)=>invoke("contest_analytics_read",{params,sessionId:context?.sessionID??null,workspaceGeneration:context?.workspaceGeneration??null});
const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException("Analytics cancelled.","AbortError");};
export async function collectAnalytics(read:AnalyticsRead,signal:AbortSignal,progress:(text:string)=>void):Promise<AnalyticsSnapshot>{
  aborted(signal);
  const meta:AnalyticsMeta=await read({action:"prepare"});
  try{
    aborted(signal);
    if(!Number.isSafeInteger(meta.total)||meta.total<0||meta.total>50000||!meta.identity||!meta.sessionID||!meta.snapshotID)throw new Error("The analytics snapshot is invalid.");
    const rows:AnalyticsRow[]=[];
    while(rows.length<meta.total){
      // Yield between bounded requests so entry traffic can use the existing owner.
      await new Promise(resolve=>setTimeout(resolve,15));aborted(signal);
      progress(`Reading contacts · ${rows.length.toLocaleString()} / ${meta.total.toLocaleString()}`);
      const page=await read({action:"page",snapshotID:meta.snapshotID,offset:rows.length,limit:500},meta);aborted(signal);
      if(page.identity!==meta.identity||page.snapshotID!==meta.snapshotID||page.offset!==rows.length||page.total!==meta.total||!Array.isArray(page.rows)||!page.rows.length||page.rows.length>500)throw new Error("The analytical copy returned inconsistent pages. Refresh to retry.");
      rows.push(...page.rows);
    }
    if(rows.length!==meta.total||new Set(rows.map(q=>q.id)).size!==rows.length)throw new Error("The analytical copy contains inconsistent contact identities.");
    const checked=await read({action:"check",snapshotID:meta.snapshotID},meta);aborted(signal);
    if(checked.current!==true||checked.identity!==meta.identity)throw new Error("The contest changed while analytics was loading. Refresh to read the new log.");
    return {meta,rows};
  }catch(error){void read({action:"release",snapshotID:meta.snapshotID},meta).catch(()=>{});throw error;}
}
