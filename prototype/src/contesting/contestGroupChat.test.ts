import { beforeEach, expect, it, vi } from "vitest";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch, requestContestGroupAuthority, syncContestGroupReplicaPage } from "./contestGroupChat";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => vi.resetAllMocks());

it("requires one exact admitted Group Chat route context", () => {
  const query = "?scope=contesting&view=group-chat&operatingContext=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&sessionID=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&workspaceGeneration=cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  expect(contestGroupChatContextFromSearch(query).sessionID).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  expect(() => contestGroupChatContextFromSearch(query + "&sessionID=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toThrow(/verified/);
});

it("matches own-operator mentions without changing displayed text", () => {
  expect(contestChatMentionsOperator("please ask om0rx now", "OM0RX")).toBe(true);
  expect(contestChatMentionsOperator("OM0R is different", "OM0RX")).toBe(false);
  expect(contestChatMentionsOperator("hello", "")).toBe(false);
});

it("sends one correlated authority request through the narrow native route", async () => {
  const context = { operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  const requestID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", authority={sessionID:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    workspaceGeneration:"ffffffff-ffff-4fff-8fff-ffffffffffff",pluginID:"cq_wpx_cw",sourceRevision:"source",
    referenceID:"cty",coordinationDigest:"a".repeat(64)}, response = { id:requestID, ok:true,
      result:{requestID,revision:3,replayed:false,scope:"contest",serial:7,sentExchange:"007",allocatedFieldID:"sent",authority} };
  native.invoke.mockResolvedValue(response);
  await expect(requestContestGroupAuthority(context, "serialReserve", { frequencyHz:14_025_000 }, requestID)).resolves.toEqual(response.result);
  expect(native.invoke).toHaveBeenCalledWith("contest_group_authority_request", {
    ...context, request:{ requestID, operation:"serialReserve", params:{ frequencyHz:14_025_000 } },
  });
});

it("rejects a mismatched or incomplete authority result before admission", async()=>{
  const context={operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},requestID="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  native.invoke.mockResolvedValue({id:requestID,ok:true,result:{requestID,serial:7}});
  await expect(requestContestGroupAuthority(context,"serialReserve",{frequencyHz:14_025_000},requestID)).rejects.toThrow(/mismatched/);
  native.invoke.mockResolvedValue({id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",ok:true,result:{}});
  await expect(requestContestGroupAuthority(context,"changes",{afterRevision:0,afterSequence:0,limit:100},requestID)).rejects.toThrow(/mismatched/);
});

it("admits only a correlated local native replica result",async()=>{
  const context={operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},request={operationID:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      changesRequestID:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",expectedRevision:4,fromCursor:{revision:2,sequence:7},limit:25};
  const response={apply:{id:request.operationID,ok:true,result:{projection:{sessionID:context.sessionID},replicaCursor:{revision:3,sequence:0}}},hasMore:false,authoredApplied:false};
  native.invoke.mockResolvedValue(response);
  await expect(syncContestGroupReplicaPage(context,request)).resolves.toEqual(response);
  expect(native.invoke).toHaveBeenCalledWith("contest_group_replica_sync_page",{...context,request});
  native.invoke.mockResolvedValue({...response,apply:{...response.apply,id:crypto.randomUUID()}});
  await expect(syncContestGroupReplicaPage(context,request)).rejects.toThrow(/mismatched/);
  const {authoredApplied:_,...missingMarker}=response;
  native.invoke.mockResolvedValue(missingMarker);
  await expect(syncContestGroupReplicaPage(context,request)).rejects.toThrow(/mismatched/);
});
