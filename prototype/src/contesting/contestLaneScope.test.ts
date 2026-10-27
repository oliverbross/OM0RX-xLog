import { expect, it } from "vitest";
import { assertContestLaneScope, captureContestLaneScope, contestLaneProjection, mergeContestLaneBuffer,
  type ContestLaneProjectionSource, type ContestLaneSnapshot } from "./contestLaneScope";

function source(): ContestLaneProjectionSource {
  const lane = (laneID: "laneA" | "laneB", call: string): ContestLaneSnapshot => ({ laneID, draftID: `draft-${laneID}`, bindingVersion: 2,
    binding: { radioID: laneID === "laneA" ? "radio1" : "radio2", receiverID: "receiver1", vfo: "A", sliceID: null, generation: 3 },
    fields: [{ id: "callsign", value: call }, { id: "other_1", value: "7", readOnly: true }], frequencyHz: 14_025_000, mode: "CW", run: true, focus: "callsign" });
  return { sessionID: "session", workspaceGeneration: "workspace", draftID: "draft-laneA", revision: 4,
    operatingLanes: { version: 1, mode: "SO2R", keyboardLaneID: "laneA", lanes: [lane("laneA", "K1ABC"), lane("laneB", "DL2ABC")] } };
}
it("keeps an explicit nonfocused projection and rejects every changed lane identity including generation type", () => {
  const s = source(), scope = captureContestLaneScope(s, "laneB");
  expect(contestLaneProjection(s, "laneB").draftID).toBe("draft-laneB");
  expect(s.operatingLanes!.keyboardLaneID).toBe("laneA");
  expect(assertContestLaneScope({ ...s, revision: 5 }, scope).laneID).toBe("laneB");
  for (const mutate of [(v: typeof s) => { v.sessionID = "other"; },
    (v: typeof s) => { v.operatingLanes!.lanes[1].draftID = "later"; },
    (v: typeof s) => { v.operatingLanes!.lanes[1].bindingVersion++; },
    (v: typeof s) => { v.operatingLanes!.lanes[1].binding!.generation = "3"; }]) {
    const changed = structuredClone(s); mutate(changed);
    expect(() => assertContestLaneScope(changed, scope)).toThrow("changed");
  }
});
it("preserves each lane's buffered typing through other-lane receipts and exposes competing edits", () => {
  const s = source(), a = mergeContestLaneBuffer(undefined, s, "laneA"), b = mergeContestLaneBuffer(undefined, s, "laneB");
  a.fields.callsign = "K1TYPED"; a.version++;
  b.fields.callsign = "DL2TYPED"; b.version++;
  const receipt = structuredClone(s); receipt.revision++;
  receipt.operatingLanes!.lanes[1].fields[1].value = "8";
  expect(mergeContestLaneBuffer(a, receipt, "laneA").fields.callsign).toBe("K1TYPED");
  const nextB = mergeContestLaneBuffer(b, receipt, "laneB");
  expect(nextB.fields).toEqual({ callsign: "DL2TYPED", other_1: "8" });
  receipt.operatingLanes!.lanes[1].fields[0].value = "EXTERNAL";
  expect(mergeContestLaneBuffer(nextB, receipt, "laneB").conflicts).toEqual(["callsign"]);
  receipt.operatingLanes!.lanes[1].draftID = "new-contact";
  expect(mergeContestLaneBuffer(nextB, receipt, "laneB").fields.callsign).toBe("EXTERNAL");
});
