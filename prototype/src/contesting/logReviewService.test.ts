import { describe, expect, it } from "vitest";
import { collectReview, type ReviewRead } from "./logReviewService";
const row={ID:"one",Call:"DL3AG",TS:"2026-10-24 00:01:00",Freq:7150,Mode:"SSB"};
const context={sessionID:"session",workspaceGeneration:"workspace",revision:7,total:1,rows:[row]};
const archive={status:{total:1,earliest:null,latest:null},recording:{state:"recording",queued:0,unrecorded:0}};
const references={sources:[{name:"cty",status:"available",version:"fixture"}],rows:[{id:row.ID,call:row.Call,lotwListed:null,countries:[]}]};
describe("on-demand review source acquisition",()=>{
  it("skips malformed calls in reference batches without losing valid contacts",async()=>{
    const mixed={...context,total:2,rows:[row,{...row,ID:"invalid",Call:"AAA"}]};
    const read:ReviewRead=async(method,params)=>{
      if(method==="context"||method==="contest_log_page")return mixed;
      if(method==="spot_history_status")return archive;
      if(method==="reference_log_review") {expect(params.contacts).toHaveLength(1);return references;}
      return {page:{rows:[],watermark:0,nextCursor:null}};
    };
    const result=await collectReview(read,new AbortController().signal,()=>{});
    expect(result.qsos).toHaveLength(2);expect(result.references.rows).toHaveLength(1);
  });
  it("pins archive watermark and log revision and uses only read methods",async()=>{
    const calls:[string,Record<string,unknown>][]=[];
    const read:ReviewRead=async(method,params)=>{
      calls.push([method,params]);
      if(method==="context")return context;
      if(method==="spot_history_status")return archive;
      if(method==="contest_log_page")return {...context,rows:[row]};
      if(method==="reference_log_review")return references;
      return {page:{rows:params.cursor?[{id:"second"}]:[{id:"first"}],watermark:10,nextCursor:params.cursor?null:"next"}};
    };
    const result=await collectReview(read,new AbortController().signal,()=>{});
    expect(result.spots).toHaveLength(2);
    expect(calls.map(([method])=>method)).toEqual(["context","spot_history_status","spot_history_query","spot_history_query","reference_log_review","contest_log_page"]);
    expect(calls[3][1]).toMatchObject({cursor:"next",watermark:10,limit:100});
    expect(calls[5][1]).toMatchObject({expectedRevision:7});
    expect(result.references).toEqual(references);
  });
  it("rejects changed log revision after the archive read",async()=>{
    const read:ReviewRead=async(method)=>method==="context"?context:method==="spot_history_status"?archive:
      method==="contest_log_page"?{...context,revision:8}:method==="reference_log_review"?references:{page:{rows:[],watermark:0,nextCursor:null}};
    await expect(collectReview(read,new AbortController().signal,()=>{})).rejects.toThrow("contest changed");
  });
  it("cancels before queuing the next request",async()=>{
    const controller=new AbortController();let reads=0;
    const read:ReviewRead=async()=>{reads++;controller.abort();return context;};
    await expect(collectReview(read,controller.signal,()=>{})).rejects.toMatchObject({name:"AbortError"});
    expect(reads).toBe(1);
  });
  it("rejects duplicate contacts in a snapshot",async()=>{
    await expect(collectReview(async()=>({...context,total:2,rows:[row,row]}),new AbortController().signal,()=>{}))
      .rejects.toThrow("inconsistent contact");
  });
  it("rejects changed archive watermark rather than mixing snapshots",async()=>{
    const read:ReviewRead=async(method,params)=>method==="context"?context:method==="spot_history_status"?archive:
      {page:{rows:[],watermark:params.cursor?11:10,nextCursor:params.cursor?null:"next"}};
    await expect(collectReview(read,new AbortController().signal,()=>{})).rejects.toThrow("inconsistent page");
  });
});
