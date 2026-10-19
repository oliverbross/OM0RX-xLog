import { expect, it, vi } from "vitest";
import { createContestSpotTuner } from "./contestSpotTune";

const station = (active = "radio1", provider: string | null = "direct_flex_lan") => ({
  radio_id:"radio1", active_radio:active, tx_owner:null, generation:"setup", revision:3, base_url:"", last_receipt:null,
  selection:{provider,generation:7,selection_id:"selection",control_revision:11}, worker_generation:5,
  radio:{provider,selection_id:"selection",selection_generation:7,snapshot:{generation:13}},
}) as any;

it("tunes the current active radio through the durable manual-tune session", async () => {
  const tune = vi.fn(async () => ({accepted:true,confirmed:true}));
  const check = vi.fn(async () => {});
  const session = vi.fn(() => ({getSnapshot:()=>({pending:null}),check,tune} as any));
  const load = vi.fn(async () => station());
  await createContestSpotTuner({load,session})(14_025_000,"CW");
  expect(load).toHaveBeenCalledWith("radio1");
  expect(session).toHaveBeenCalledWith("radio1");
  expect(tune).toHaveBeenCalledWith("direct_flex_lan",14_025_000,"CW");
});

it("resolves radio two and refuses stale or unresolved station state", async () => {
  const tune = vi.fn(async () => ({accepted:true,confirmed:true}));
  const states = [{pending:"old"},{pending:"old"}];
  const session = vi.fn(() => ({getSnapshot:()=>states.shift() ?? {pending:"old"},check:vi.fn(async()=>{}),tune} as any));
  const load = vi.fn(async (radioId: string) => radioId === "radio1" ? station("radio2") : {...station("radio2"),radio_id:"radio2"});
  await expect(createContestSpotTuner({load,session})(7_025_000,"CW")).rejects.toThrow(/previous manual tune receipt/);
  expect(load.mock.calls.map(([radio])=>radio)).toEqual(["radio1","radio2"]);
  expect(tune).not.toHaveBeenCalled();

  await expect(createContestSpotTuner({load:vi.fn(async()=>station("radio1",null)),session})(7_025_000,"CW"))
    .rejects.toThrow(/Select and refresh/);

  let reads=0;
  await expect(createContestSpotTuner({load:vi.fn(async()=>++reads===1?station("radio2"):{...station("radio1"),radio_id:"radio2"}),session})(7_025_000,"CW"))
    .rejects.toThrow(/active radio changed/);
});
