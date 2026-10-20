import { expect, it } from "vitest";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch } from "./contestGroupChat";

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
