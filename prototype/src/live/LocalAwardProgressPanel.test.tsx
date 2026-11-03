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
it("distinguishes POTA countable candidates, expanded records and unresolved eligibility",async()=>{
  const candidate={day:"2026-11-03",physicalRows:11,countableContacts:10,programmeLogRecords:10,duplicateProgrammeRecords:1,unknownEligibilityRows:0,excludedRows:0,threshold:10,candidateStatus:"local candidate",reasons:[],eligibility:"Operation eligibility and portal acceptance remain unverified."};
  const conditional={...candidate,day:"2026-11-02",physicalRows:4,countableContacts:4,programmeLogRecords:12,duplicateProgrammeRecords:0,candidateStatus:"conditional",reasons:["Multi-park minimum interpretation remains unresolved."]};
  const frame={...base,units:[{...base.units[0],unit:"US-0001",role:"activator",worked:15,utcDays:{"2026-11-03":11,"2026-11-02":4},activationCandidates:[candidate,conditional]}]};
  const request=vi.fn(async(_method:string,_params?:Record<string,unknown>)=>frame);
  render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation}/>);
  await screen.findByRole("button",{name:"US-0001 · Supporting contacts"});
  fireEvent.change(screen.getByLabelText("Progress programme"),{target:{value:"pota"}});
  expect(await screen.findByText("2026-11-03: local candidate")).toBeTruthy();
  expect(screen.getByText(/10 \/ 10 distinct countable contact events.*11 physical rows.*10 unique programme log records.*1 duplicate programme/)).toBeTruthy();
  expect(screen.getByText("2026-11-02: conditional")).toBeTruthy();
  expect(screen.getByText("Multi-park minimum interpretation remains unresolved.")).toBeTruthy();
  expect(screen.getAllByText("Operation eligibility and portal acceptance remain unverified.")).toHaveLength(2);
});
it("clears an applied legacy text search and typed conditions, restores results and preserves drilldown Back",async()=>{
  const request=vi.fn(async(method:string,params?:Record<string,unknown>)=> {
    if(method === "workspace_preferences_load") return {generation,revision:1,preferences:{savedLogbookFilters:[{name:"K1 contacts",query:"K1"}]}};
    return {...base,workedUnits:params?.search ? 1 : 2,supportingQSOs:params?.search ? 1 : 3};
  });
  render(<LocalAwardProgressPanel request={request} refresh={0} readScope={generation}/>);
  await screen.findByRole("button",{name:"AF · Supporting contacts"});
  fireEvent.click(screen.getByRole("button",{name:"Filter contacts"}));
  const saved=await screen.findByLabelText("Saved Logbook filter");
  await waitFor(()=>expect((saved as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(saved,{target:{value:"K1 contacts"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({search:"K1",query:expect.objectContaining({clauses:[]})})));
  expect(screen.getByText("K1",{selector:"strong"})).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Start with a preset"),{target:{value:"cw"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply conditions"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({search:"K1",query:expect.objectContaining({clauses:[{field:"mode",op:"eq",values:["CW"]}]})})));
  fireEvent.click(screen.getByRole("button",{name:"Clear all contact filters"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({search:"",query:{version:1,join:"all",clauses:[]}})));
  await screen.findByText(/2 distinct worked units · 3 supporting physical contacts/);
  expect(screen.getByText(/Active contact search: None. 0 active structured conditions./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"AF · Supporting contacts"}));
  await screen.findByRole("button",{name:"Back to matrix"});
  fireEvent.click(screen.getByRole("button",{name:"Back to matrix"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"",search:"",query:{version:1,join:"all",clauses:[]}})));
});
it("presents compatible IOTA groups with original locations and clearable own-grid selection",async()=>{
  const scope="OM0RX · own DXCC 504 · compatible recorded locations";
  const units=["EU-005","AS-007"].map(unit=>({...base.units[0],unit,role:"HF",worked:1}));
  const request=vi.fn(async(_method:string,params?:Record<string,unknown>)=>{
    const filtered=(params?.query as {clauses?:unknown[]})?.clauses?.length;
    const selected=filtered ? [units[1]] : units;
    return {...base,programme:"iota",stationScope:scope,scopes:[scope,"OM0RX · own DXCC 150 · compatible recorded locations"],roles:["HF"],units:selected,totalUnits:selected.length,workedUnits:selected.length,supportingQSOs:selected.length,
      evidence:params?.unit ? [{id:"d5680e8c-e8c1-4563-b059-9933847ad7fd",call:"JA1ABC",start:0,band:"20m",mode:"CW",paper:"",lotw:"",reason:"Recorded reference; eligibility unavailable",recordedGrid:"JN88",recordedLocation:"Mountain",recordedContext:"OM0RX · own DXCC 504 · JN88"}] : [],evidenceTotal:params?.unit ? 1 : 0};
  });
  render(<LocalAwardProgressPanel request={request} refresh={0}/>);
  await screen.findByRole("button",{name:"EU-005 · Supporting contacts"});
  fireEvent.change(screen.getByLabelText("Progress programme"),{target:{value:"iota"}});
  await screen.findByText(/IOTA local progress combines locations/);
  expect(screen.getByRole("button",{name:"AS-007 · Supporting contacts"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Filter contacts"}));
  fireEvent.click(screen.getByRole("button",{name:"Add condition"}));
  fireEvent.change(screen.getByLabelText("Condition 1 field"),{target:{value:"ownGrid"}});
  fireEvent.change(screen.getByLabelText("Condition 1 value"),{target:{value:"JN88"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply conditions"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({programme:"iota",query:expect.objectContaining({clauses:[{field:"ownGrid",op:"eq",values:["JN88"]}]})})));
  await screen.findByText(/1 distinct worked units · 1 supporting physical contacts/);
  fireEvent.click(screen.getByRole("button",{name:"AS-007 · Supporting contacts"}));
  await screen.findByText(/JN88 · Mountain/);
  expect(screen.getByText("OM0RX · own DXCC 504 · JN88",{selector:"small"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Back to matrix"}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({unit:"",query:expect.objectContaining({clauses:[{field:"ownGrid",op:"eq",values:["JN88"]}]})})));
  fireEvent.click(screen.getByRole("button",{name:"Clear all contact filters"}));
  await screen.findByText(/2 distinct worked units · 2 supporting physical contacts/);
  expect(request).toHaveBeenLastCalledWith("logbook_award_progress",expect.objectContaining({search:"",query:{version:1,join:"all",clauses:[]}}));
});
