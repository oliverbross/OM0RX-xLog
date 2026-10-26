// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestReverseHistoryPanel } from "./ContestReverseHistoryPanel";
import { ContestVisibleDupesheet } from "./ContestVisibleDupesheet";
import { assistanceCoordinates, reverseHistory, visibleDupesheet, type AssistanceScope } from "./contestReverseAssistance";
import type { ContestRequest } from "./types";

afterEach(()=>{cleanup();vi.useRealTimers();});
const scope:AssistanceScope={sessionID:"11111111-1111-4111-8111-111111111111",workspaceGeneration:"22222222-2222-4222-8222-222222222222",revision:4,draftID:"draft-a"};
const fields=[{id:"call",label:"Partial call"},{id:"name",label:"Name"},{id:"state",label:"State / province / country"}];
const frame=(params:Record<string,unknown>,rows:unknown[]=[],extra:Record<string,unknown>={})=>({id:"reply",ok:true,result:{...params,
  query:String(params.query).trim().toUpperCase(),evaluatedAtUTC:"2026-10-27 08:00:00",fields,dataset:{generation:"active-history",digest:"a".repeat(64),rowCount:2},rows,nextOffset:null,unsupportedReason:null,...extra}});
const candidate=(callsign="K1ABC")=>({candidateID:`history:${callsign}`,callsign,sourceLabel:"Activated call history",sourceDate:"2026-01-01",
  comparedFields:[{id:"name",label:"Name",value:"BOB"},{id:"state",label:"State",value:"MA"}]});
const dupeFrame=(params:Record<string,unknown>,extra:Record<string,unknown>={})=>frame(params,[{callsign:"K1ABC",lastWorkedUTC:"2026-10-27 07:59:59",contactCount:1,isDupe:true}],
  {totalCalls:75,scopeDescription:"Worked on this band.",frequencyHz:14_025_000,mode:"CW",roverLocation:"",...extra});

it("shows declared roles and traceable source/date, loading only the selected call",async()=>{
  const selected=vi.fn(),request=(async(_method:string,params:Record<string,unknown>)=>frame(params,params.query?[candidate()]:[])) as ContestRequest;
  render(<ContestReverseHistoryPanel request={request} scope={scope} onSelect={selected}/>);
  await screen.findByRole("option",{name:"Name"});
  fireEvent.change(screen.getByLabelText("Compared field"),{target:{value:"name"}});
  fireEvent.change(screen.getByLabelText("Reverse lookup"),{target:{value:"BO"}});
  const load=await screen.findByRole("button",{name:"Load K1ABC"});
  expect(screen.getByText(/2026-01-01/)).toBeTruthy();
  expect(screen.getByText(/Name: BOB/)).toBeTruthy();
  fireEvent.click(load);expect(selected).toHaveBeenCalledExactlyOnceWith("K1ABC",scope);
});

it("discards obsolete query and draft replies and allows cancellation",async()=>{
  const pending:{params:Record<string,unknown>;resolve:(value:ReturnType<typeof frame>)=>void}[]=[];
  const request=(async(_method:string,params:Record<string,unknown>)=>params.query?new Promise<ReturnType<typeof frame>>(resolve=>pending.push({params,resolve})):frame(params)) as ContestRequest;
  const view=render(<ContestReverseHistoryPanel request={request} scope={scope}/>);
  fireEvent.change(screen.getByLabelText("Reverse lookup"),{target:{value:"K1"}});
  await waitFor(()=>expect(pending).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Reverse lookup"),{target:{value:"K2"}});
  await waitFor(()=>expect(pending).toHaveLength(2));
  await act(async()=>pending[1].resolve(frame(pending[1].params,[candidate("K2ABC")])));
  expect(await screen.findByText("K2ABC")).toBeTruthy();
  await act(async()=>pending[0].resolve(frame(pending[0].params,[candidate("K1ABC")])));
  expect(screen.queryByText("K1ABC")).toBeNull();
  view.rerender(<ContestReverseHistoryPanel request={request} scope={{...scope,revision:5,draftID:"draft-b"}}/>);
  await waitFor(()=>expect(pending).toHaveLength(3));
  expect(screen.queryByText("K2ABC")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Cancel lookup"}));
  await act(async()=>pending[2].resolve(frame(pending[2].params,[candidate("K2ABC")])));
  expect(screen.queryByText("K2ABC")).toBeNull();
});

it("explains serial-only unsupported lookup",async()=>{
  const request=(async(_method:string,params:Record<string,unknown>)=>frame(params,[],{
    unsupportedReason:params.fieldID==="serial"?"Rolling serials are not stable identities and cannot be searched as call history.":null})) as ContestRequest;
  render(<ContestReverseHistoryPanel request={request} scope={scope}/>);
  await screen.findByRole("option",{name:"Name"});
  fireEvent.change(screen.getByLabelText("Compared field"),{target:{value:"serial"}});
  expect(await screen.findByText(/Rolling serials are not stable identities/)).toBeTruthy();
});

it("reads optional whole-log pages, queries undisplayed calls and refreshes changed scope",async()=>{
  const request=vi.fn(async(_method:string,params:Record<string,unknown>)=>dupeFrame(params,{nextOffset:params.offset===0&&!params.query?50:null,
    rows:[{callsign:params.offset===50||params.query?"K9LAST":"K1ABC",lastWorkedUTC:"2026-10-27 07:59:59",contactCount:1,isDupe:params.expectedRevision===4}]}));
  const view=render(<ContestVisibleDupesheet request={request as ContestRequest} scope={scope}/>);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Visible Dupesheet"));
  expect(await screen.findByText("Duplicate")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"More calls"}));
  expect(await screen.findByText("K9LAST")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Find worked call"),{target:{value:"LAST"}});
  await waitFor(()=>expect(request.mock.calls.at(-1)?.[1]).toMatchObject({query:"LAST",offset:0}));
  view.rerender(<ContestVisibleDupesheet request={request as ContestRequest} scope={{...scope,revision:5}}/>);
  expect(await screen.findByText("Clear")).toBeTruthy();
});

it("rechecks timed-repeat authority periodically while the sheet is open",async()=>{
  vi.useFakeTimers();
  const request=vi.fn(async(_method:string,params:Record<string,unknown>)=>dupeFrame(params));
  render(<ContestVisibleDupesheet request={request as ContestRequest} scope={scope}/>);
  await act(async()=>fireEvent.click(screen.getByLabelText("Visible Dupesheet")));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByLabelText("Visible Dupesheet"));
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
  expect(request).toHaveBeenCalledTimes(2);
});

it("rejects mismatched worker identities, roles and invalid duplicate states",async()=>{
  const coordinates=assistanceCoordinates(scope),options={query:"BO",fieldID:"name",source:"history" as const,matchMode:"prefix" as const,offset:0,limit:50};
  const stale=(async(_method:string,params:Record<string,unknown>)=>frame(params,[candidate()],{draftID:"other"})) as ContestRequest;
  await expect(reverseHistory(stale,coordinates,options)).rejects.toThrow(/stale/);
  const wrongRole=(async(_method:string,params:Record<string,unknown>)=>frame(params,[candidate()],{fieldID:"serial"})) as ContestRequest;
  await expect(reverseHistory(wrongRole,coordinates,options)).rejects.toThrow(/Malformed reverse/);
  const malformed=(async(_method:string,params:Record<string,unknown>)=>dupeFrame(params,{rows:[{callsign:"K1ABC",lastWorkedUTC:"2026-10-27 08:00:00",contactCount:1,isDupe:"clear"}]})) as ContestRequest;
  await expect(visibleDupesheet(malformed,coordinates,"")).rejects.toThrow(/Malformed visible/);
});
