// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContestOpportunities, unifyContestOpportunities } from "./ContestOpportunities";
import type { ContestSurfaceSpot } from "./contestSurfaceProtocol";
import type { ContestMethod, ContestRequest } from "./types";

const scope={sessionID:"opportunity-session",workspaceGeneration:"opportunity-workspace",revision:8,draftID:"protected-draft"};
const bands=[{id:"20m",frequencyHz:14025000},{id:"40m",frequencyHz:7025000}];
type Candidate={spotID:string;callsign:string;frequencyHz:number;mode:string};
type Review={spotID:string;dupe:boolean|null;points:number|null;multiplierCount:number|null;reason:string|null;conditionalScoreGain:number|null;
  newDimensions:{dimension:string;label:string;value:string;scope:string}[];dimensionsVerified:boolean;inferredExchange:Record<string,string>;valueBasis:string;exchangeProvenance:string};
function spot(id:string,values:Partial<ContestSurfaceSpot>={}):ContestSurfaceSpot {
  return {id,receivedAt:Date.now()/1000-978_307_200-60,clusterName:"Cluster A",spotter:"W1AAA",spotterContinent:"NA",frequencyKHz:14025,frequencyText:"14025.0",
    callsign:"K1ABC",comment:"CQ",band:"20m",mode:"CW",country:"United States",adif:291,continent:"NA",cqZone:5,ituZone:8,
    callStatus:"new",dxccStatus:"new",workedBefore:0,specialTags:[],score:5,contestPoints:null,contestDupe:null,contestMultiplierCount:null,
    contestCountryMultiplier:null,contestZoneMultiplier:null,scoreReasons:[],aggregateCount:1,aggregateSpotters:["W1AAA"],source:"DX cluster",
    statusHex:"#ffffff",bandHex:"#ffffff",modeHex:"#ffffff",marked:false,...values};
}
const review=(candidate:Candidate,values:Partial<Review>={}):Review=>({spotID:candidate.spotID,dupe:false,points:null,multiplierCount:null,
  reason:"exchange_required",conditionalScoreGain:null,newDimensions:[],dimensionsVerified:false,inferredExchange:{},
  valueBasis:"Received serial still required",exchangeProvenance:"No serial inferred",...values});
function fixture(spots:ContestSurfaceSpot[],custom:(candidate:Candidate)=>Partial<Review>=()=>({})) {
  const calls=vi.fn(async(method:ContestMethod,params:Record<string,unknown>={})=>{
    if(method==="contest_strategy")return {id:"strategy",ok:true as const,result:{version:1,skeds:[],moves:[],dueCount:0}};
    if(method!=="contest_opportunities")throw Error(`Unexpected request: ${method}`);
    const candidates=params.spots as Candidate[];
    return {id:"opportunities",ok:true as const,result:{sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,
      revision:params.expectedRevision,spots:candidates.map(candidate=>review(candidate,custom(candidate)))}};
  });
  return {scope,request:calls as unknown as ContestRequest,spots,bands,mode:"CW",currentCall:"",disabled:false,
    onMutate:vi.fn(async(_action:string,_values:Record<string,unknown>):Promise<unknown>=>undefined),
    onLoad:vi.fn(async(_item:{callsign:string;frequencyHz:number;mode:string})=>{}),
    onSked:vi.fn(),calls};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("groups supporting observations into one call/band/mode and uses the newest frequency",async()=>{
  const now=Date.now()/1000-978_307_200;
  const observations=[spot("older",{mode:"USB",receivedAt:now-120,frequencyKHz:14250,source:"Cluster A"}),
    spot("newer",{callsign:" k1abc ",mode:"LSB",receivedAt:now-60,frequencyKHz:14255,source:"Cluster B"}),
    spot("other-band",{band:"40m",mode:"SSB",frequencyKHz:7125}),spot("cw",{mode:"CW"}),spot("invalid",{callsign:"INVALID CALL"})];
  const unified=unifyContestOpportunities(observations);
  expect(unified).toHaveLength(3);
  expect(unified.find(row=>row.id==="K1ABC/20m/SSB")).toMatchObject({frequencyHz:14255000,observations:[observations[0],observations[1]]});
  render(<ContestOpportunities {...fixture(observations)}/>);
  const button=await screen.findByRole("button",{name:"K1ABC · 20m/SSB"}),row=button.closest("tr")!;
  expect(row.textContent).toContain("2 observations");expect(row.textContent).toContain("Cluster A, Cluster B");
  expect(screen.getAllByRole("button",{name:"K1ABC · 20m/SSB"})).toHaveLength(1);
});

it("shows native Apple-reference observation ages using the newest report and the shared unknown-age label",async()=>{
  const nowUTC=Date.parse("2026-10-27T12:00:00Z"),nativeNow=nowUTC/1000-978_307_200;
  vi.spyOn(Date,"now").mockReturnValue(nowUTC);
  const options=fixture([spot("older",{receivedAt:nativeNow-600}),spot("latest",{receivedAt:nativeNow-75}),
    spot("fresh",{callsign:"DL1ABC",receivedAt:nativeNow-15}),spot("future",{callsign:"K2ABC",receivedAt:nativeNow+30}),
    spot("invalid",{callsign:"K3ABC",receivedAt:Number.NaN})]);
  render(<ContestOpportunities {...options}/>);
  const ageFor=(call:string)=>within(screen.getByRole("button",{name:`${call} · 20m/CW`}).closest("tr")!).getAllByRole("cell")[0].textContent;
  await screen.findByRole("button",{name:"K1ABC · 20m/CW"});
  expect(ageFor("K1ABC")).toContain("2 observations · 1 min ·");
  expect(ageFor("DL1ABC")).toContain("1 observations · Now ·");
  expect(ageFor("K2ABC")).toContain("1 observations · Now ·");
  expect(ageFor("K3ABC")).toContain("1 observations · — ·");
  expect(options.onLoad).not.toHaveBeenCalled();expect(options.onMutate).not.toHaveBeenCalled();
});

it("feed refresh and selection never load, plan or route; explicit load and sked preparation use the selected opportunity",async()=>{
  const options=fixture([spot("one")]),mounted=render(<ContestOpportunities {...options}/>);
  const button=await screen.findByRole("button",{name:"K1ABC · 20m/CW"});fireEvent.click(button);
  mounted.rerender(<ContestOpportunities {...options} spots={[spot("new",{frequencyKHz:14030}),spot("other",{callsign:"DL1ABC"})]}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"K1ABC · 20m/CW"})).toHaveProperty("ariaPressed","true"));
  expect(options.onLoad).not.toHaveBeenCalled();expect(options.onMutate).not.toHaveBeenCalled();expect(options.onSked).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Load selected call only"}));
  await waitFor(()=>expect(options.onLoad).toHaveBeenCalledWith(expect.objectContaining({callsign:"K1ABC",frequencyHz:14030000,mode:"CW"})));
  expect(options.onMutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Prepare selected sked"}));
  expect(options.onSked).toHaveBeenCalledWith(expect.objectContaining({callsign:"K1ABC",source:expect.stringContaining("Spot observations:")}));
});

it("retains independently known duplicate state while explicitly showing unknown exchange",async()=>{
  const options=fixture([spot("dupe"),spot("clear",{callsign:"DL1ABC"})],candidate=>({dupe:candidate.callsign==="K1ABC",reason:"exchange_required"}));
  render(<ContestOpportunities {...options}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"K1ABC · 20m/CW"}).closest("tr")!.textContent).toContain("duplicate: yes"));
  const knownDupe=screen.getByRole("button",{name:"K1ABC · 20m/CW"}).closest("tr")!;
  expect(knownDupe.textContent).toContain("Unknown exchange");
  const clear=screen.getByRole("button",{name:"DL1ABC · 20m/CW"}).closest("tr")!;
  expect(clear.textContent).toContain("Unknown exchange");expect(clear.textContent).toContain("duplicate: no");
  expect(options.onLoad).not.toHaveBeenCalled();expect(options.onMutate).not.toHaveBeenCalled();
});

it("labels shared multiplier gains nonadditive without inventing a combined total",async()=>{
  const dimension={dimension:"country",label:"Country",value:"K",scope:"20m"};
  const options=fixture([spot("one"),spot("two",{callsign:"K2ABC"})],()=>({reason:null,points:3,multiplierCount:1,
    conditionalScoreGain:9,dimensionsVerified:true,newDimensions:[dimension],valueBasis:"Plugin conditional total change"}));
  render(<ContestOpportunities {...options}/>);
  await waitFor(()=>expect(screen.getAllByText(/shared, nonadditive/)).toHaveLength(2));
  for(const call of ["K1ABC","K2ABC"]){const row=screen.getByRole("button",{name:`${call} · 20m/CW`}).closest("tr")!;
    expect(row.textContent).toContain("Conditionally new");expect(row.textContent).toContain("Country K / 20m · shared, nonadditive");
    expect(within(row).getByText("9",{exact:false})).toBeTruthy();}
  expect(screen.getByText(/Shared new multipliers are not additive/)).toBeTruthy();
  expect(screen.queryByText("18",{exact:true})).toBeNull();
});

it("retains the selected identity through revision and observation order changes",async()=>{
  const options=fixture([spot("one"),spot("two",{callsign:"DL1ABC"})]),mounted=render(<ContestOpportunities {...options}/>);
  fireEvent.click(await screen.findByRole("button",{name:"K1ABC · 20m/CW"}));
  mounted.rerender(<ContestOpportunities {...options} scope={{...scope,revision:9}} spots={[spot("two",{callsign:"DL1ABC"}),spot("one-new",{frequencyKHz:14027})]}/>);
  await waitFor(()=>expect(options.calls.mock.calls.some(([,params])=>params?.expectedRevision===9)).toBe(true));
  expect(screen.getByRole("button",{name:"K1ABC · 20m/CW"})).toHaveProperty("ariaPressed","true");
  expect(screen.getByRole("button",{name:"Load selected call only"})).toBeTruthy();
});

it("reviews scoped batches of at most eight and creates a plan only with explicit band and radio fields",async()=>{
  const options=fixture(Array.from({length:18},(_,index)=>spot(`spot-${index}`,{callsign:`K${index}ABC`})));
  render(<ContestOpportunities {...options}/>);
  await waitFor(()=>expect(options.calls.mock.calls.filter(([method])=>method==="contest_opportunities")).toHaveLength(3));
  const initialBatches=options.calls.mock.calls.filter(([method])=>method==="contest_opportunities");
  expect(initialBatches.map(([,params])=>(params!.spots as Candidate[]).length)).toEqual([8,8,2]);
  for(const [,params] of initialBatches)expect(params).toMatchObject({sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:8});
  expect(options.onMutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox",{name:"Move callsign"}),{target:{value:"DL1ABC"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Target band"}),{target:{value:"40m"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Explicit radio target"}),{target:{value:"radio2"}});
  fireEvent.click(screen.getByRole("button",{name:"Plan move"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledOnce());
  expect(options.onMutate.mock.calls[0]).toEqual(["move_add",{itemID:expect.stringMatching(/^[0-9a-f-]{36}$/),callsign:"DL1ABC",band:"40m",
    frequencyHz:7025000,mode:"CW",radioID:"radio2",text:"Planned multiplier move",note:"",source:"Operator plan",skedID:null,status:"Planned"}]);
  expect(options.onLoad).not.toHaveBeenCalled();expect(options.onSked).not.toHaveBeenCalled();
});
