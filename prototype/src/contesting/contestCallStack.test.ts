import { describe, expect, it } from "vitest";
import { ContestCallStack, callStackStorageKey, currentStackClassification, emptyCallStack, occupiedStackDraft,
  restoreCallStack, type CallStackDraft, type CallStackOperation, type CallStackPorts, type CallStackResult, type CallStackState } from "./contestCallStack";

const scope = { sessionID: "practice-session", workspaceGeneration: "disposable-workspace" };
const clone = <T,>(value: T): T => structuredClone(value);
function fixture() {
  let counter = 0, serial = 7, saved: CallStackState | null = null, commits = 0, loads = 0;
  let draft: CallStackDraft = { ...scope, draftID: "draft-7", revision: 1,
    fields: { callsign: "K1AAA", sent: "599", receive: "599", other_1: "7", other_2: "14", name: "Alice", grid: "FN42" },
    defaults: { callsign: "", sent: "599", receive: "", other_1: "7", other_2: "", name: "", grid: "" },
    heardFieldIDs: ["receive", "other_2", "name", "grid"] };
  const receipts = new Map<string, CallStackResult>(), operations: CallStackOperation[] = [];
  const ports: CallStackPorts = { getDraft: () => clone(draft), id: () => `identity-${++counter}`,
    persist: value => { saved = clone(value); }, rejected: cause => cause === "rejected",
    receipt: async operation => receipts.has(operation.operationID) ? clone(receipts.get(operation.operationID)!) : null,
    mutate: async operation => {
      operations.push(clone(operation));
      if (receipts.has(operation.operationID)) return clone(receipts.get(operation.operationID)!);
      if (operation.draft.draftID !== draft.draftID || operation.draft.revision !== draft.revision) throw "rejected";
      if (operation.kind === "commit") {
        commits += 1; serial += 1;
        const defaults = { ...draft.defaults, other_1: String(serial) };
        draft = { ...draft, draftID: `draft-${serial}`, revision: draft.revision + 1, fields: { ...defaults }, defaults };
      } else { loads += 1; draft = { ...draft, fields: { ...operation.fields }, revision: draft.revision + 1 }; }
      const result: CallStackResult = { operationID: operation.operationID, draft: clone(draft),
        ...(operation.kind === "commit" ? { qsoID: `qso-${serial - 1}` } : {}) };
      receipts.set(operation.operationID, clone(result)); return result;
    } };
  return { ports, operations, receipts, draft: () => draft, setDraft: (next: CallStackDraft) => { draft = next; },
    saved: () => saved, counts: () => ({ commits, loads }),
    controller: (state = emptyCallStack(scope)) => new ContestCallStack(state, ports) };
}

describe("manual Call Stack assistance", () => {
  it("keeps FIFO order, stable item identities and explicit manual promotion without contacting the host", () => {
    const f = fixture(), stack = f.controller();
    const one = stack.add(" k1one "), two = stack.add("K2TWO"), partial = stack.add("DL?AB");
    stack.select(two); stack.promote(two);
    expect(stack.snapshot().items.map(item => item.id)).toEqual([two, one, partial]);
    expect(stack.snapshot().items.map(item => item.revision)).toEqual([0, 0, 0]);
    expect(stack.snapshot().revision).toBe(5);
    stack.remove(partial); expect(stack.snapshot().items.map(item => item.callsign)).toEqual(["K2TWO", "K1ONE"]);
    expect(f.operations).toEqual([]); expect(f.counts()).toEqual({ commits: 0, loads: 0 });
  });
  it("requires an explicit occupied-draft choice and swaps only heard fragments, never the sent serial", async () => {
    const f = fixture(), stack = f.controller(), id = stack.add("K2TWO");
    await expect(stack.load(id)).rejects.toThrow("Choose Swap, Park, or Discard");
    expect(f.operations).toHaveLength(0);
    await stack.load(id, "swap");
    expect(f.draft().fields).toEqual({ callsign: "K2TWO", sent: "599", receive: "", other_1: "7", other_2: "", name: "", grid: "" });
    const parked = stack.snapshot().items[0];
    expect(parked.callsign).toBe("K1AAA"); expect(parked.fragments.name).toEqual({ source: "heard", value: "Alice" });
    expect(parked.fragments).not.toHaveProperty("sent"); expect(parked.fragments).not.toHaveProperty("other_1");
    expect(f.counts()).toEqual({ commits: 0, loads: 1 });
  });
  it("parks at the end and discards only after the draft load has succeeded", async () => {
    const f = fixture(), stack = f.controller(), first = stack.add("K2TWO"), second = stack.add("K3THREE");
    await stack.load(first, "park");
    expect(stack.snapshot().items.map(item => item.callsign)).toEqual(["K3THREE", "K1AAA"]);
    await stack.load(second, "discard");
    expect(stack.snapshot().items.map(item => item.callsign)).toEqual(["K1AAA"]);
  });
  it("retains NAQP's explicitly heard other_1 name using the declared received field roles", async () => {
    const f = fixture();
    f.setDraft({ ...f.draft(), heardFieldIDs: ["other_1", "other_2"], receivedFieldIDs: ["other_1", "other_2"],
      fields: { callsign: "K1AAA", sent: "599", other_1: "ALICE", other_2: "MA" },
      defaults: { callsign: "", sent: "599", other_1: "", other_2: "" } });
    const stack = f.controller(), id = stack.add("K2TWO"); await stack.load(id, "swap");
    const parked = stack.snapshot().items[0];
    expect(parked.fragments.other_1).toEqual({ value: "ALICE", source: "heard" });
    expect(parked.fragments.other_2).toEqual({ value: "MA", source: "heard" });
    // The next caller has not supplied any heard fields; this must not discard the queued caller's provenance.
    f.setDraft({ ...f.draft(), heardFieldIDs: [] });
    await stack.load(parked.id, "discard");
    expect(f.draft().fields.other_1).toBe("ALICE"); expect(f.draft().fields.other_2).toBe("MA");
  });
  it("retains and loads ? calls as assistance and refuses to commit an incomplete call", async () => {
    const f = fixture(), stack = f.controller(), partial = stack.add("DL?AB"); stack.add("K2TWO");
    await stack.load(partial, "discard");
    await expect(stack.logAndNext()).rejects.toThrow("partial calls are assistance only");
    expect(f.counts()).toEqual({ commits: 0, loads: 1 }); expect(stack.snapshot().items[0].callsign).toBe("K2TWO");
  });
  it("advances WPX-style serials only at the existing host commit boundary", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); stack.add("K3THREE");
    expect(f.draft().fields.other_1).toBe("7"); expect(f.operations).toHaveLength(0);
    await stack.logAndNext();
    expect(f.operations.map(operation => operation.kind)).toEqual(["commit", "load"]);
    expect(f.operations[0].fields.other_1).toBe("7"); expect(f.operations[1].fields.other_1).toBe("8");
    expect(f.draft().fields.callsign).toBe("K2TWO"); expect(f.draft().fields.name).toBe("");
    expect(stack.snapshot().items[0].callsign).toBe("K3THREE");
  });
  it("does not confuse received exchange with caller-independent defaults", () => {
    const f = fixture(); expect(occupiedStackDraft(f.draft())).toBe(true);
    const blank = { ...f.draft(), fields: { ...f.draft().defaults } }; expect(occupiedStackDraft(blank)).toBe(false);
    expect(occupiedStackDraft({ ...blank, fields: { ...blank.fields, name: "Heard" } })).toBe(true);
    expect(callStackStorageKey(scope)).toContain(`${scope.workspaceGeneration}/${scope.sessionID}`);
  });
});

describe("Call Stack durable transition recovery", () => {
  it("preserves current entry and queue after a definite invalid/rejected save", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const before = clone(f.draft());
    f.ports.mutate = async () => { throw "rejected"; };
    await expect(stack.logAndNext()).rejects.toBe("rejected");
    expect(f.draft()).toEqual(before); expect(stack.snapshot().items).toHaveLength(1); expect(stack.snapshot().pending).toBeNull();
  });
  it("recovers a lost commit reply after restart from its original receipt without logging twice", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const mutate = f.ports.mutate;
    f.ports.mutate = async operation => { const result = await mutate(operation); if (operation.kind === "commit") throw new Error("lost reply"); return result; };
    await expect(stack.logAndNext()).rejects.toThrow("lost reply");
    expect(stack.snapshot().items).toHaveLength(1); expect(stack.snapshot().pending?.phase).toBe("commit");
    const restarted = f.controller(restoreCallStack(JSON.stringify(f.saved()), scope));
    await restarted.recover();
    expect(f.counts()).toEqual({ commits: 1, loads: 1 }); expect(restarted.snapshot().items).toHaveLength(0);
    await restarted.recover(); expect(f.counts()).toEqual({ commits: 1, loads: 1 });
  });
  it("keeps missing receipts uncertain and retries only the original immutable ID and payload", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const mutate = f.ports.mutate;
    f.ports.mutate = async () => { throw new Error("disconnected before request"); };
    await expect(stack.logAndNext()).rejects.toThrow();
    const pending = clone(stack.snapshot().pending);
    await expect(stack.recover()).rejects.toThrow("still unconfirmed"); expect(stack.snapshot().pending).toEqual(pending);
    f.ports.mutate = mutate; await stack.recover(true);
    expect(f.operations[0]).toEqual(pending?.phase === "commit" ? pending.operation : undefined);
    expect(f.counts()).toEqual({ commits: 1, loads: 1 });
  });
  it("recovers a loaded draft after a lost reply and consumes the item once", async () => {
    const f = fixture(), stack = f.controller(), id = stack.add("K2TWO"), mutate = f.ports.mutate;
    f.ports.mutate = async operation => { await mutate(operation); throw new Error("lost load reply"); };
    await expect(stack.load(id, "swap")).rejects.toThrow("lost load reply");
    expect(stack.snapshot().items[0].callsign).toBe("K2TWO");
    const restarted = f.controller(restoreCallStack(JSON.stringify(f.saved()), scope)); await restarted.recover();
    expect(restarted.snapshot().items.map(item => item.callsign)).toEqual(["K1AAA"]);
    await restarted.recover(); expect(f.counts()).toEqual({ commits: 0, loads: 1 });
  });
  it("persists the journal before sending any host request", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO");
    f.ports.persist = () => { throw new Error("storage full"); };
    await expect(stack.logAndNext()).rejects.toThrow("storage full"); expect(f.operations).toHaveLength(0);
  });
  it("recovers even when the local completion journal fails after the host committed", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const persist = f.ports.persist;
    f.ports.persist = state => { if (state.pending?.phase === "committed") throw new Error("storage full"); persist(state); };
    await expect(stack.logAndNext()).rejects.toThrow("storage full");
    expect(f.counts()).toEqual({ commits: 1, loads: 0 }); f.ports.persist = persist;
    const restarted = f.controller(restoreCallStack(JSON.stringify(f.saved()), scope)); await restarted.recover();
    expect(f.counts()).toEqual({ commits: 1, loads: 1 }); expect(restarted.snapshot().items).toHaveLength(0);
  });
  it("retains the queue after a saved contact when a later operator edit prevents automatic load", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const mutate = f.ports.mutate;
    f.ports.mutate = async operation => { const result = await mutate(operation);
      if (operation.kind === "commit") f.setDraft({ ...f.draft(), revision: f.draft().revision + 1, fields: { ...f.draft().fields, callsign: "W1NEW" } });
      return result; };
    await expect(stack.logAndNext()).rejects.toThrow("Entry changed");
    expect(stack.snapshot().pending?.phase).toBe("committed"); expect(stack.snapshot().items).toHaveLength(1);
    stack.keepQueueAfterSavedContact(); expect(f.draft().fields.callsign).toBe("W1NEW");
    expect(stack.snapshot().pending).toBeNull(); expect(f.counts()).toEqual({ commits: 1, loads: 0 });
  });
  it("retains a confirmed save if loading next is rejected, permitting a manual queue decision", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const mutate = f.ports.mutate;
    f.ports.mutate = async operation => { if (operation.kind === "load") throw "rejected"; return mutate(operation); };
    await expect(stack.logAndNext()).rejects.toBe("rejected"); expect(stack.snapshot().pending?.phase).toBe("committed");
    stack.keepQueueAfterSavedContact(); expect(stack.snapshot().items).toHaveLength(1); expect(f.counts().commits).toBe(1);
  });
  it("does not pop for a stale or wrong receipt", async () => {
    const f = fixture(), stack = f.controller(); stack.add("K2TWO"); const mutate = f.ports.mutate;
    f.ports.mutate = async operation => ({ ...await mutate(operation), operationID: "unrelated-operation" });
    await expect(stack.logAndNext()).rejects.toThrow("does not match");
    expect(stack.snapshot().pending?.phase).toBe("commit"); expect(stack.snapshot().items).toHaveLength(1);
  });
  it("keeps scope changes and partial calls unknown until the existing authority reclassifies them", () => {
    const f = fixture(), stack = f.controller(), id = stack.add("K2TWO"), item = stack.snapshot().items[0];
    const classifications = [{ itemID: id, itemRevision: 0, scope: "band20/log4", state: "duplicate" as const, reason: "worked" }];
    expect(currentStackClassification(item, "band20/log4", classifications)?.state).toBe("duplicate");
    expect(currentStackClassification(item, "band40/log4", classifications)).toBeUndefined();
    expect(currentStackClassification(item, "band20/log5", classifications)).toBeUndefined();
    expect(stack.snapshot().items).toHaveLength(1);
  });
  it("rejects corrupt or other-workspace journals without silently discarding callers", () => {
    expect(() => restoreCallStack("bad-json", scope)).toThrow("unreadable");
    expect(() => restoreCallStack(JSON.stringify(emptyCallStack(scope)), { ...scope, workspaceGeneration: "other" })).toThrow("does not match");
    expect(() => restoreCallStack(JSON.stringify({ ...emptyCallStack(scope), pending: { phase: "commit" } }), scope)).toThrow("does not match");
  });
});
