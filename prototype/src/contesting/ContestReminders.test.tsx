// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestReminders, type Sked, type StrategyProjection } from "./ContestReminders";
import type { ContestRequest } from "./types";

const scope={sessionID:"source-session",workspaceGeneration:"workspace",revision:7,draftID:"occupied-draft"};
const sked:Sked={id:"stable-sked",callsign:"K1ABC",text:"Return contact",frequencyHz:14025000,mode:"CW",dueUTC:"2099-10-28T00:01:00Z",
  radioID:"radio2",note:"Try second radio",source:"Explicit draft",status:"active",schedule:1,deliveredSchedule:null,deliveredUTC:null,
  createdUTC:"2026-10-27T23:59:00Z",updatedUTC:"2026-10-27T23:59:00Z",history:[{action:"sked_add",atUTC:"2026-10-27T23:59:00Z"}]};
const state=(items:Sked[]=[sked]):StrategyProjection=>({version:1,skeds:items,moves:[],dueCount:0});
const requestFor=(data:StrategyProjection)=>vi.fn(async()=>({id:"strategy",ok:true as const,result:data})) as unknown as ContestRequest;
const props=(data=state())=>({scope,request:requestFor(data),disabled:false,onMutate:vi.fn(async(_action:string,_values:Record<string,unknown>):Promise<unknown>=>undefined),
  onLoad:vi.fn(async(_item:Sked)=>{}),onLoadAndTune:vi.fn(async(_item:Sked,_radio:"radio1"|"radio2")=>{})});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("claims overdue reminders as one passive batch without focus, load, tune or complete",async()=>{
  const due={...sked,dueUTC:"2026-01-01T00:00:00Z"},options=props(state([due]));
  options.onMutate.mockImplementation(async()=>({...state([{...due,deliveredSchedule:1}]),notifications:[due]}));
  render(<><input aria-label="Protected entry"/><ContestReminders {...options} visible={false}/></>);
  const entry=screen.getByRole("textbox",{name:"Protected entry"});entry.focus();
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledOnce());
  expect(options.onMutate.mock.calls[0][0]).toBe("claim_due");
  expect(await screen.findByRole("status")).toHaveProperty("textContent","1 contest reminder is due. Open Skeds to review.");
  expect(document.activeElement).toBe(entry);expect(options.onLoad).not.toHaveBeenCalled();expect(options.onLoadAndTune).not.toHaveBeenCalled();
  expect(screen.queryByRole("button",{name:"Load"})).toBeNull();
});

it("announces a durable claim even when its own publication advances the revision before the reply",async()=>{
  const due={...sked,dueUTC:"2026-01-01T00:00:00Z"},options=props(state([due]));
  let finish!:(result:unknown)=>void;
  options.onMutate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const mounted=render(<ContestReminders {...options}/>);
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledOnce());
  mounted.rerender(<ContestReminders {...options} request={requestFor(state([{...due,deliveredSchedule:1}]))} scope={{...scope,revision:8}}/>);
  await act(async()=>{finish({...state([{...due,deliveredSchedule:1}]),notifications:[due]});});
  expect(screen.getByRole("status")).toHaveProperty("textContent","1 contest reminder is due. Open Skeds to review.");
  expect(options.onMutate).toHaveBeenCalledOnce();
});

it("loads only on deliberate action and failed explicit tune preserves the item",async()=>{
  const options=props();options.onLoadAndTune.mockRejectedValueOnce(Error("Fresh readback failed"));
  render(<ContestReminders {...options}/>);
  fireEvent.click(await screen.findByRole("button",{name:/K1ABC · Return contact/}));
  fireEvent.click(screen.getByRole("button",{name:"Load and tune Radio 2"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","Fresh readback failed");
  expect(options.onLoadAndTune).toHaveBeenCalledWith(sked,"radio2");expect(options.onMutate).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:/K1ABC · Return contact/})).toHaveProperty("ariaPressed","true");
  fireEvent.click(screen.getByRole("button",{name:"Load"}));
  await waitFor(()=>expect(options.onLoad).toHaveBeenCalledWith(sked));expect(options.onMutate).not.toHaveBeenCalled();
});

it("requires an explicit radio target for tuning",async()=>{
  render(<ContestReminders {...props(state([{...sked,radioID:null}]))}/>);
  fireEvent.click(await screen.findByRole("button",{name:/K1ABC · Return contact/}));
  expect(screen.getByRole("button",{name:"Load and tune — choose target"})).toHaveProperty("disabled",true);
  expect(screen.getByRole("button",{name:"Load"})).toHaveProperty("disabled",false);
});

it("uses explicit draft prefill, saves UTC and stable item identity, and supports edit",async()=>{
  const options=props();render(<ContestReminders {...options} prefill={{callsign:"K2DRAFT",frequencyHz:7025000,mode:"CW",source:"Current draft"}}/>);
  fireEvent.click(screen.getByRole("button",{name:"New sked"}));
  expect(screen.getByRole("textbox",{name:"Callsign"})).toHaveProperty("value","K2DRAFT");
  fireEvent.change(screen.getByRole("textbox",{name:"Due UTC"}),{target:{value:"2026-10-28T00:05:00Z"}});
  fireEvent.click(screen.getByRole("button",{name:"Save sked"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledOnce());
  const [action,values]=options.onMutate.mock.calls[0];expect(action).toBe("sked_add");
  expect(values).toMatchObject({callsign:"K2DRAFT",frequencyHz:7025000,mode:"CW",dueUTC:"2026-10-28T00:05:00Z",source:"Current draft",radioID:null});
  expect(values.itemID).toMatch(/^[0-9a-f-]{36}$/);
  fireEvent.click(await screen.findByRole("button",{name:/K1ABC · Return contact/}));
  fireEvent.click(screen.getByRole("button",{name:"Edit sked"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Note"}),{target:{value:"Change planned band later"}});
  fireEvent.click(screen.getByRole("button",{name:"Save sked"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledTimes(2));
  expect(options.onMutate.mock.calls[1]).toEqual(["sked_edit",expect.objectContaining({itemID:"stable-sked",note:"Change planned band later"})]);
});

it("preserves selection on revision refresh and clears it across contest scope",async()=>{
  const options=props(),mounted=render(<ContestReminders {...options}/>);
  fireEvent.click(await screen.findByRole("button",{name:/K1ABC · Return contact/}));
  mounted.rerender(<ContestReminders {...options} scope={{...scope,revision:8}}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Load"})).toBeTruthy());
  mounted.rerender(<ContestReminders {...options} request={requestFor(state([]))} scope={{...scope,sessionID:"other-session"}}/>);
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Load"})).toBeNull());
});

it("shows closed history and snoozes a dismissed item with its original ID",async()=>{
  const options=props(state([{...sked,status:"dismissed"}]));render(<ContestReminders {...options}/>);
  await screen.findByText("No reminders in this view.");
  fireEvent.click(screen.getByRole("checkbox",{name:"Include closed reminders"}));
  fireEvent.click(screen.getByRole("button",{name:/K1ABC · Return contact/}));
  fireEvent.click(screen.getByRole("button",{name:"Later 5 min"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledOnce());
  expect(options.onMutate.mock.calls[0]).toEqual(["sked_snooze",expect.objectContaining({itemID:"stable-sked",dueUTC:expect.stringMatching(/Z$/)})]);
  expect(screen.getByText("sked_add",{exact:false})).toBeTruthy();
});

it("discards a delayed read from the prior contest",async()=>{
  let resolve!:(frame:unknown)=>void;
  const request=vi.fn(()=>new Promise(done=>{resolve=done;})) as unknown as ContestRequest;
  const options=props(),mounted=render(<ContestReminders {...options} request={request}/>);
  mounted.rerender(<ContestReminders {...options} request={requestFor(state([]))} scope={{...scope,sessionID:"next"}}/>);
  await act(async()=>{resolve({id:"old",ok:true,result:state()});});
  await screen.findByText("No reminders in this view.");expect(screen.queryByText("K1ABC")).toBeNull();
});
