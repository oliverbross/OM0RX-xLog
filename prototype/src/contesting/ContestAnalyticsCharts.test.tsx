// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it } from "vitest";
import { AnalyticsExplorer } from "./ContestAnalyticsCharts";
import { analyzeAnalytics,defaultAnalyticsFilters,prepareAnalytics } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";
afterEach(cleanup);
it("returns to available rows and columns when a display filter narrows a paged cross-tab",()=>{
  const start=Date.parse("2026-10-20T00:00:00Z"),rows=Array.from({length:90},(_,i)=>({...analyticsFixtureRows[0],id:`page-${i}`,call:`K${i}TEST`,operator:`OP${i}`,utc:new Date(start+i*3600000).toISOString()}));
  const dataset=prepareAnalytics({...analyticsFixtureMeta,total:90},rows),filters=defaultAnalyticsFilters,now=start+91*3600000;
  const renderTable=(count:number,scope=filters)=><AnalyticsExplorer result={analyzeAnalytics({...dataset,contacts:dataset.contacts.slice(0,count)},scope,now)} filters={scope} onChange={()=>{}} onDrill={()=>{}} multiplierSupported/>;
  const view=render(renderTable(90));
  fireEvent.click(screen.getByRole("button",{name:"Next rows"}));
  expect(screen.queryByRole("rowheader",{name:"2026-10-20 00:00"})).toBeNull();
  view.rerender(renderTable(3));
  expect(screen.getByRole("rowheader",{name:"2026-10-20 00:00"})).toBeTruthy();
  const operatorScope={...filters,row:"band" as const,column:"operator" as const};
  view.rerender(renderTable(90,operatorScope));fireEvent.click(screen.getByRole("button",{name:"Next columns"}));
  expect(screen.queryByRole("columnheader",{name:"OP0"})).toBeNull();
  view.rerender(renderTable(3,operatorScope));expect(screen.getByRole("columnheader",{name:"OP0"})).toBeTruthy();
});
