import { beforeEach, expect, it, vi } from "vitest";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch, requestContestGroupAuthority } from "./contestGroupChat";

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
  const requestID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", response = { id:requestID, ok:true, result:{ serial:7 } };
  native.invoke.mockResolvedValue(response);
  await expect(requestContestGroupAuthority(context, "serialReserve", { frequencyHz:14_025_000 }, requestID)).resolves.toEqual(response);
  expect(native.invoke).toHaveBeenCalledWith("contest_group_authority_request", {
    ...context, request:{ requestID, operation:"serialReserve", params:{ frequencyHz:14_025_000 } },
  });
});
