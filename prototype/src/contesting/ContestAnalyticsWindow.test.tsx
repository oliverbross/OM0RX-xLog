// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { ContestAnalyticsWindow } from "./ContestAnalyticsWindow";
import { analyzeAnalytics,prepareAnalytics,type AnalyticsDataset } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";

class AnalysisWorker {
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;dataset:AnalyticsDataset|null=null;terminated=false;
  postMessage(message:any){setTimeout(()=>{if(this.terminated)return;try{if(message.snapshot)this.dataset=prepareAnalytics(message.snapshot.meta,message.snapshot.rows);this.onmessage?.({data:{id:message.id,result:analyzeAnalytics(this.dataset!,message.filters,message.now),...(message.snapshot?{dataset:this.dataset}:{})}});}catch(error){this.onmessage?.({data:{id:message.id,error:error instanceof Error?error.message:"failed"}});}},0);}
  terminate(){this.terminated=true;}
}
beforeEach(()=>{vi.stubGlobal("Worker",AnalysisWorker);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const snapshot={meta:analyticsFixtureMeta,rows:analyticsFixtureRows};
describe("Contest Analytics interaction",()=>{
  it("keeps filters and drilldown on one copied log without invoking station or log actions",async()=>{
    const read=vi.fn();render(<ContestAnalyticsWindow initialSnapshot={snapshot} read={read}/>);
    const metric=await screen.findByRole("button",{name:/Contacts in view 4/});fireEvent.click(metric);
    expect(await screen.findByRole("region",{name:"Contributing contacts"})).toBeTruthy();
    expect(within(screen.getByRole("region",{name:"Contributing contacts"})).getByText("a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Close contributing contacts"}));
    fireEvent.change(screen.getByLabelText("Analytics style"),{target:{value:"Unknown"}});
    expect(await screen.findByRole("button",{name:/Contacts in view 1/})).toBeTruthy();expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Timeline & Explorer"}));expect(screen.getByRole("table",{name:"Contest analytics cross-tab"})).toBeTruthy();
  });
  it("shows unsupported duration/radio attribution and explicit quality evidence",async()=>{
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Operating Performance"}));expect(screen.getByText("Not verified")).toBeTruthy();expect(screen.getByText("Rules-defined off-time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Quality & Review"}));fireEvent.click(screen.getByRole("button",{name:"Unattributed operating style 1"}));
    const detail=await screen.findByRole("region",{name:"Contributing contacts"});expect(within(detail).getByText("c")).toBeTruthy();
  });
  it("keeps the range controls usable after an invalid interval",async()=>{
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"UTC range"}));fireEvent.change(screen.getByLabelText("Analytics UTC start"),{target:{value:"2026-10-26T00:00"}});
    await waitFor(()=>expect((screen.getByRole("button",{name:"Reset"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Analytics UTC end"),{target:{value:"2026-10-25T00:00"}});
    expect((await screen.findByRole("alert")).textContent).toContain("valid UTC interval");expect(screen.queryByRole("region",{name:"Contest metrics"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Reset"}));expect(await screen.findByRole("button",{name:/Contacts in view 4/})).toBeTruthy();
  });
  it("contains read failures and permits retry without opening a station owner",async()=>{
    const read=vi.fn().mockRejectedValue(new Error("No active contest. Open a session."));render(<ContestAnalyticsWindow read={read}/>);
    expect((await screen.findByRole("alert")).textContent).toContain("No active contest");expect((screen.getByRole("button",{name:"Retry"}) as HTMLButtonElement).disabled).toBe(false);
    expect(read.mock.calls.every(([params])=>params.action==="prepare")).toBe(true);
  });
});
