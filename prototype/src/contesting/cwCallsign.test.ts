import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveContestCWCallsign } from "./cwCallsign";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
const action:any={requestID:"40000000-0000-4000-8000-000000000001",operatingContext:"operating",sessionID:"session",workspaceGeneration:"workspace",
  action:"entry_cw_callsign",params:{draftID:"draft",expectedDraftRevision:4,sourceEpoch:crypto.randomUUID(),spotID:crypto.randomUUID(),spotVersion:crypto.randomUUID()}};
const reply=()=>({operationId:action.requestID,operatingContext:action.operatingContext,sessionID:action.sessionID,workspaceGeneration:action.workspaceGeneration,
  draftID:action.params.draftID,expectedDraftRevision:action.params.expectedDraftRevision,callsign:"K1ABC"});
beforeEach(()=>vi.mocked(invoke).mockReset());
it("asks only the native sole-owner resolver for the original operation",async()=>{
  vi.mocked(invoke).mockResolvedValue(reply());expect(await resolveContestCWCallsign(action)).toBe("K1ABC");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cw_contest_callsign_resolve",{operationId:action.requestID});
});
it.each(["operationId","operatingContext","sessionID","workspaceGeneration","draftID","expectedDraftRevision","callsign"])("refuses changed %s evidence",async field=>{
  vi.mocked(invoke).mockResolvedValue({...reply(),[field]:field==="expectedDraftRevision"?5:"changed"});
  await expect(resolveContestCWCallsign(action)).rejects.toThrow(/no longer belongs/);
});
it("requires the original lane and receiver binding on native readback",async()=>{
  const scoped={...action,params:{...action.params,laneID:"laneB",bindingVersion:7}};
  vi.mocked(invoke).mockResolvedValue({...reply(),laneID:"laneB",bindingVersion:7});
  expect(await resolveContestCWCallsign(scoped)).toBe("K1ABC");
  for(const changed of [{},{laneID:"laneA",bindingVersion:7},{laneID:"laneB",bindingVersion:8}]){
    vi.mocked(invoke).mockResolvedValue({...reply(),...changed});await expect(resolveContestCWCallsign(scoped)).rejects.toThrow();
  }
});
