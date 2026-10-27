import { expect, it, vi } from "vitest";
import { createContestSpotTuner, createContestVFOStepper, createContestReminderTuner } from "./contestSpotTune";

const station = (active = "radio1", provider: string | null = "direct_flex_lan") => ({
  radio_id:"radio1", active_radio:active, tx_owner:null, generation:"setup", revision:3, base_url:"", last_receipt:null,
  selection:{provider,generation:7,selection_id:"selection",control_revision:11}, worker_generation:5,
  radio:{provider,selection_id:"selection",selection_generation:7,snapshot:{generation:13}},
}) as any;

it("routes a reminder only to its explicit target and retains an unresolved tune",async()=>{
  const tune=vi.fn(async()=>({accepted:true,confirmed:true})),check=vi.fn(async()=>{}),review=vi.fn();
  const session=vi.fn(()=>({getSnapshot:()=>({pending:null}),check,tune,review} as any));
  const load=vi.fn(async()=>({...station("radio1"),radio_id:"radio2"}));
  await createContestReminderTuner({load,session})("radio2",7_145_000,"SSB");
  expect(load).toHaveBeenCalledExactlyOnceWith("radio2");expect(session).toHaveBeenCalledExactlyOnceWith("radio2");
  expect(tune).toHaveBeenCalledExactlyOnceWith("direct_flex_lan",7_145_000,"SSB");
  tune.mockClear();session.mockImplementation(()=>({getSnapshot:()=>({pending:"unresolved"}),check,tune,review} as any));
  await expect(createContestReminderTuner({load,session})("radio2",7_145_000,"SSB")).rejects.toThrow(/previous tune receipt/);
  expect(tune).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
});

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

it("reviews a retained unknown tune before admitting one new explicit spot selection", async () => {
  let state:{pending:string|null;reviewable:boolean} = {pending:"old",reviewable:false};
  const tune = vi.fn(async () => ({accepted:true,confirmed:true}));
  const check = vi.fn(async () => { state = {pending:"old",reviewable:true}; });
  const review = vi.fn(async () => { state = {pending:null,reviewable:false}; });
  const session = vi.fn(() => ({getSnapshot:()=>state,check,review,tune} as any));
  const load = vi.fn(async () => station());
  await createContestSpotTuner({load,session})(7_145_000,"SSB");
  expect(check).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledOnce();
  expect(tune).toHaveBeenCalledExactlyOnceWith("direct_flex_lan",7_145_000,"SSB");
});

it("retires an unknown tune discovered by the fresh native snapshot and honors the spot click", async () => {
  let state:{pending:string|null;reviewable:boolean} = {pending:null,reviewable:false};
  const tune = vi.fn(async () => {
    if (tune.mock.calls.length === 1) {
      state = {pending:"native-old",reviewable:false};
      throw new Error("The previous manual tune outcome is unknown.");
    }
    return {accepted:true,confirmed:true};
  });
  const check = vi.fn(async () => { state = {pending:"native-old",reviewable:true}; });
  const review = vi.fn(async () => { state = {pending:null,reviewable:false}; });
  const session = vi.fn(() => ({getSnapshot:()=>state,check,review,tune} as any));
  await createContestSpotTuner({load:vi.fn(async()=>station()),session})(7_164_000,"SSB");
  expect(check).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledOnce();
  expect(tune).toHaveBeenCalledTimes(2);
  expect(tune).toHaveBeenLastCalledWith("direct_flex_lan",7_164_000,"SSB");
});

it("never replays a newly dispatched tune whose outcome is unknown", async () => {
  let state:{pending:string|null;reviewable:boolean} = {pending:null,reviewable:false};
  const tune = vi.fn(async () => {
    state = {pending:"new-operation",reviewable:true};
    throw new Error("Manual tune outcome is unknown.");
  });
  const check = vi.fn(), review = vi.fn();
  const session = vi.fn(() => ({getSnapshot:()=>state,check,review,tune} as any));
  await expect(createContestSpotTuner({load:vi.fn(async()=>station()),session})(7_164_000,"SSB"))
    .rejects.toThrow(/outcome is unknown/);
  expect(tune).toHaveBeenCalledOnce();
  expect(check).not.toHaveBeenCalled();
  expect(review).not.toHaveBeenCalled();
});

it.each([
  ["CW",14_025_000,"up",14_025_020], ["CWR",14_025_000,"down",14_024_980],
  ["USB",14_250_000,"up",14_250_100], ["LSB",7_100_000,"down",7_099_900],
] as const)("steps observed %s without changing mode and carries the source fence",async(mode,frequency,direction,target)=>{
  const tune=vi.fn(async()=>({accepted:true,confirmed:true})),session=vi.fn(()=>({getSnapshot:()=>({pending:null}),check:vi.fn(),tune} as any));
  const load=vi.fn(async()=>({...station(),radio:{...station().radio,snapshot:{generation:13,radio:{frequency_hz:frequency,mode}}}}));
  await createContestVFOStepper({load,session})(direction);
  expect(tune).toHaveBeenCalledWith("direct_flex_lan",target,mode,undefined,{frequencyHz:frequency,mode});
});

it("rejects unsupported or unobserved VFO modes before durable dispatch",async()=>{
  const tune=vi.fn(),session=vi.fn(()=>({getSnapshot:()=>({pending:null}),check:vi.fn(),tune} as any));
  const load=vi.fn(async()=>({...station(),radio:{...station().radio,snapshot:{generation:13,radio:{frequency_hz:14_074_000,mode:"FT8"}}}}));
  await expect(createContestVFOStepper({load,session})("up")).rejects.toThrow(/only for an observed CW or SSB/);
  expect(tune).not.toHaveBeenCalled();
});

it("resolves radio two and refuses stale or unresolved station state", async () => {
  const tune = vi.fn(async () => ({accepted:true,confirmed:true}));
  const states = [{pending:"old"},{pending:"old"}];
  const session = vi.fn(() => ({getSnapshot:()=>states.shift() ?? {pending:"old"},check:vi.fn(async()=>{}),review:vi.fn(async()=>{}),tune} as any));
  const load = vi.fn(async (radioId: string) => radioId === "radio1" ? station("radio2") : {...station("radio2"),radio_id:"radio2"});
  await expect(createContestSpotTuner({load,session})(7_025_000,"CW")).rejects.toThrow(/previous manual tune is still in progress/);
  expect(load.mock.calls.map(([radio])=>radio)).toEqual(["radio1","radio2"]);
  expect(tune).not.toHaveBeenCalled();

  await expect(createContestSpotTuner({load:vi.fn(async()=>station("radio1",null)),session})(7_025_000,"CW"))
    .rejects.toThrow(/Select and refresh/);

  let reads=0;
  await expect(createContestSpotTuner({load:vi.fn(async()=>++reads===1?station("radio2"):{...station("radio1"),radio_id:"radio2"}),session})(7_025_000,"CW"))
    .rejects.toThrow(/active radio changed/);
});
