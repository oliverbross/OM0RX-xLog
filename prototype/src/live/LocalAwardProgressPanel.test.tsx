// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalAwardProgressPanel } from "./LocalAwardProgressPanel";
afterEach(cleanup);
const generation="df392be1-e94c-4d08-8d59-553947abec43";
const base={programme:"wac",stationScope:"OM0RX · own DXCC 504 · JN98",scopes:["OM0RX · own DXCC 504 · JN98"],roles:["worked"],bands:["20m"],
  units:[{unit:"AF",role:"worked",worked:0,confirmationRecorded:0,directoryMatched:true,points:null,bands:{},utcDays:{}}],totalUnits:1,workedUnits:0,supportingQSOs:0,
  confirmationUnits:0,unknownContacts:0,evidence:[],evidenceTotal:0,workspace_generation:generation,logbook_revision:2,eligibility:"Local progress only",analytics:"Band analytics",rulesVersion:"fixture"};
it("opens a needed cell as an exact native evidence query and returns to its matrix",async()=>{
  const request=vi.fn(async(_method:string,_params?:Record<string,unknown>)=>base);
  render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation} />);
  fireEvent.click(await screen.findByRole("button",{name:"AF · Supporting contacts"}));
  await screen.findByText("No supporting contacts for this needed cell in the selected band/mode/filter.");
  expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"AF",expected_generation:generation}));
  expect(request.mock.calls.some(([method])=>method === "station_tune")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Back to matrix"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:""})));
});
it("retires a slow previous-workspace result",async()=>{
  let resolve!:(value:any)=>void;
  const pending=new Promise(resolveValue=>{resolve=resolveValue;});
  const request=vi.fn(async(_method:string,params?:Record<string,unknown>)=>params?.expected_generation===generation ? pending : {...base,scopes:[],units:[]});
  const view=render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation} />);
  view.rerender(<LocalAwardProgressPanel request={request} refresh={0} readScope="456c7dc6-8e4f-4945-b4e3-6d60e1e26314" />);
  resolve(base);
  await screen.findByText("No local units in this station/filter scope. Try a different recorded context or reset conditions.");
  expect(screen.queryByRole("button",{name:"AF · Supporting contacts"})).toBeNull();
});

it("opens the clicked band/mode cell with exact native facets and restores matrix facets, page and scroll",async()=>{
  const frame={...base,totalUnits:40,bands:["20m","40m"],units:[{...base.units[0],worked:3,bands:{"20m":{CW:{worked:2,confirmationRecorded:1},Phone:{worked:1,confirmationRecorded:0}}}}]};
  const request=vi.fn(async(_method:string,_params?:Record<string,unknown>)=>frame);
  const view=render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation}/>);
  const next=await screen.findByRole("button",{name:"Next units"});
  await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"",band:"",mode:"Mixed",offset:20})));
  await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(true));
  const matrix=view.container.querySelector<HTMLDivElement>(".local-award-matrix")!;
  matrix.scrollTop=183;fireEvent.scroll(matrix);
  const cell=screen.getByRole("button",{name:"AF · worked · 20m · CW supporting contacts"});
  await waitFor(()=>expect((cell as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(cell);
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"AF",unit_role:"worked",band:"20m",mode:"CW",offset:0,expected_generation:generation})));
  expect(screen.getByRole("heading",{name:"AF · 20m / CW · Supporting contacts"})).toBeTruthy();
  expect((screen.getByLabelText("Progress band") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("Progress mode") as HTMLSelectElement).value).toBe("Mixed");
  fireEvent.click(screen.getByRole("button",{name:"Back to matrix"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"",band:"",mode:"Mixed",offset:20})));
  await waitFor(()=>expect(matrix.hidden).toBe(false));
  await waitFor(()=>expect(matrix.scrollTop).toBe(183));
  expect(screen.getByText("21–40 / 40")).toBeTruthy();
  expect(screen.queryByRole("heading",{name:"AF · 20m / CW · Supporting contacts"})).toBeNull();
});
it("labels POTA activation-day totals as physical rows without programme eligibility or duplicate claims",async()=>{
  const frame={...base,units:[{...base.units[0],unit:"US-0001",role:"activator",worked:13,utcDays:{"2026-11-03":10,"2026-11-02":3}}]};
  const request=vi.fn(async(_method:string,_params?:Record<string,unknown>)=>frame);
  render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation}/>);
  await screen.findByRole("button",{name:"US-0001 · Supporting contacts"});
  fireEvent.change(screen.getByLabelText("Progress programme"),{target:{value:"pota"}});
  expect(await screen.findByText("2026-11-03: 10 physical QSO rows recorded; programme duplicate/eligibility checks not applied")).toBeTruthy();
  expect(screen.getByText("2026-11-02: 3 physical QSO rows recorded; programme duplicate/eligibility checks not applied")).toBeTruthy();
  expect(screen.queryByText(/threshold reached|to local 10-QSO/)).toBeNull();
});
