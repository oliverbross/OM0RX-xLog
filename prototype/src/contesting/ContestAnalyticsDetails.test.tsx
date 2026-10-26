// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnalyticsMultipliers } from "./ContestAnalyticsDetails";
import { analyzeAnalytics, defaultAnalyticsFilters, prepareAnalytics } from "./contestAnalytics";
import { analyticsFixtureMeta, analyticsFixtureRows } from "./contestAnalytics.fixtures";

vi.mock("./RecorderAudioAction",()=>({RecorderAudioAction:()=>null,RecorderAudioProvider:({children}:any)=>children}));
afterEach(cleanup);

it("shows finite Needed provenance and keeps open identity classes separate",()=>{
  const dataset=prepareAnalytics({...analyticsFixtureMeta,hostEvidence:true,multiplierAdapter:true,
    scoreHistory:{status:"UNVERIFIED",reason:"Historical owner is unresolved",model:"points-times-credited-identities"},
    neededViews:[{id:"prefecture",label:"Japanese prefectures",status:"PASS",reason:"Pinned JIDX 1–50 exchange contract",scope:"band",
      rows:[{scope:"20m",worked:["13"],needed:["14","15"]}]},
      {id:"prefix",label:"WPX prefixes",status:"NOT APPLICABLE",reason:"Open-ended identity class; candidate Needed is separate",rows:[]}]},analyticsFixtureRows);
  const result=analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse(analyticsFixtureMeta.capturedAt));
  render(<AnalyticsMultipliers dataset={dataset} result={result} onDrill={vi.fn()}/>);
  expect(screen.getByRole("heading",{name:"Finite worked / needed lists"})).toBeTruthy();
  expect(screen.getByText("PASS · Pinned JIDX 1–50 exchange contract")).toBeTruthy();
  expect(screen.getByText("14, 15")).toBeTruthy();
  expect(screen.getByText(/NOT APPLICABLE.*candidate Needed is separate/)).toBeTruthy();
});

it("allows additive conditional value without asking for a fictitious multiplier",()=>{
  const dataset=prepareAnalytics({...analyticsFixtureMeta,cqWW:false,pluginID:"wia_remembrance",hostEvidence:true,multiplierAdapter:false,total:1,
    score:{qsos:1,points:2,multipliers:0,total:2},
    scoreHistory:{status:"PASS",reason:"Stored points",model:"stored-points",factor:1}},
    [{...analyticsFixtureRows[0],points:2,hostDupe:false,claimedScore:2}]);
  const result=analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse(analyticsFixtureMeta.capturedAt));
  render(<AnalyticsMultipliers dataset={dataset} result={result} onDrill={vi.fn()}/>);
  expect((screen.getByLabelText("New credited identities") as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText("+3")).toBeTruthy();
});

it("labels a capped literal-code scope as limited even when its credit slots are exhausted",()=>{
  const dataset=prepareAnalytics({...analyticsFixtureMeta,hostEvidence:true,multiplierAdapter:true,
    neededViews:[{id:"county",label:"Received counties / regions",status:"PASS",reason:"Literal codes only; compound exchanges are not enumerated",
      universeSize:67,universeComplete:false,universeScope:"single-literal-exchange-codes-only",remainingCreditSlots:0,
      rows:[{scope:"Contest",worked:["ALAM"],needed:[]}]}]},analyticsFixtureRows);
  render(<AnalyticsMultipliers dataset={dataset} result={analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse(analyticsFixtureMeta.capturedAt))} onDrill={vi.fn()}/>);
  expect(screen.getByText("67 values in this limited reference scope.")).toBeTruthy();
  expect(screen.getByText("0 remaining multiplier-credit slots under the pinned cap.")).toBeTruthy();
});

it("allows a new credited region in the seniority-bonus family",()=>{
  const dataset=prepareAnalytics({...analyticsFixtureMeta,cqWW:false,pluginID:"es_manual_key",hostEvidence:true,multiplierAdapter:true,total:1,
    score:{qsos:1,points:30,multipliers:0,total:45},
    scoreHistory:{status:"PASS",reason:"Station seniority plus stored points",model:"points-plus-seniority-times-identities-plus-one",factor:1,initialScore:15,constantBonus:15}},
    [{...analyticsFixtureRows[0],points:30,hostDupe:false,claimedScore:45,creditedKeys:[]}]);
  render(<AnalyticsMultipliers dataset={dataset} result={analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse(analyticsFixtureMeta.capturedAt))} onDrill={vi.fn()}/>);
  const identities=screen.getByLabelText("New credited identities") as HTMLSelectElement;
  expect(identities.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Candidate stored QSO points"),{target:{value:"0"}});
  fireEvent.change(identities,{target:{value:"1"}});
  expect(screen.getByText("+45")).toBeTruthy();
});
