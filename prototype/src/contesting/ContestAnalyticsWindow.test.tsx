// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { ContestAnalyticsWindow } from "./ContestAnalyticsWindow";
import { analyzeAnalytics,analyticsReport,defaultAnalyticsFilters,prepareAnalytics,type AnalyticsDataset } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";
import { saveAnalyticsFile } from "./contestAnalyticsExport";

const native=vi.hoisted(()=>({invoke:vi.fn(),isTauri:vi.fn(()=>true)}));
vi.mock("@tauri-apps/api/core",()=>native);
const lifecycle=vi.hoisted(()=>({close:null as (()=>void)|null,controller:null as (()=>{prepare:()=>Promise<void>})|null}));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({listen:vi.fn(async(_event:string,callback:()=>void)=>{lifecycle.close=callback;return ()=>{};})})}));
vi.mock("../operatingModulePreparation",()=>({prepareOperatingModuleTransition:(controller:typeof lifecycle.controller)=>{lifecycle.controller=controller;return ()=>{};}}));
vi.mock("./contestRecorder",async importOriginal=>({...await importOriginal<typeof import("./contestRecorder")>(),recorderRequest:vi.fn(async()=>({}))}));

class AnalysisWorker {
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;dataset:AnalyticsDataset|null=null;terminated=false;
  postMessage(message:any){setTimeout(()=>{if(this.terminated)return;try{if(message.snapshot)this.dataset=prepareAnalytics(message.snapshot.meta,message.snapshot.rows);this.onmessage?.({data:{id:message.id,result:analyzeAnalytics(this.dataset!,message.filters,message.now),...(message.snapshot?{dataset:this.dataset}:{})}});}catch(error){this.onmessage?.({data:{id:message.id,error:error instanceof Error?error.message:"failed",...(message.snapshot&&this.dataset?{dataset:this.dataset}:{})}});}},0);}
  terminate(){this.terminated=true;}
}
beforeEach(()=>{vi.stubGlobal("Worker",AnalysisWorker);native.invoke.mockReset();native.isTauri.mockReturnValue(true);});
afterEach(()=>{vi.restoreAllMocks();cleanup();localStorage.clear();vi.unstubAllGlobals();vi.useRealTimers();});
const snapshot={meta:analyticsFixtureMeta,rows:analyticsFixtureRows};
describe("Contest Analytics interaction",()=>{
  it("retains the last annotation on tab navigation and vetoes native close/preparation when storage fails",async()=>{
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);fireEvent.click(await screen.findByRole("button",{name:"Quality & Review"}));
    fireEvent.change(screen.getByLabelText("Original learning evidence"),{target:{value:"last unfinished annotation"}});
    const write=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("quota exhausted");});
    fireEvent.click(screen.getByRole("button",{name:"Overview"}));expect(screen.getByRole("button",{name:"Quality & Review"}).getAttribute("aria-current")).toBe("page");
    await expect(lifecycle.controller!().prepare()).rejects.toThrow(/quota exhausted/);
    act(()=>lifecycle.close!());expect(native.invoke).not.toHaveBeenCalledWith("close_learning_window");
    write.mockRestore();native.invoke.mockResolvedValue(undefined);act(()=>lifecycle.close!());await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("close_learning_window"));
    expect(Object.values(localStorage).join()).toContain("last unfinished annotation");
  });
  it("shows the host nonproduct score and separately labelled points and multiplier values",async()=>{
    const nonproduct={meta:{...analyticsFixtureMeta,cqWW:false,pluginID:"es_manual_key",hostEvidence:true,multiplierAdapter:true,total:1,
      score:{qsos:1,points:30,multipliers:0,total:45},
      scoreHistory:{status:"PASS" as const,reason:"Station seniority plus stored points",model:"points-plus-seniority-times-identities-plus-one",initialScore:15,constantBonus:15}},
      rows:[{...analyticsFixtureRows[0],points:30,claimedScore:45,hostDupe:false,creditedKeys:[]}]};
    render(<ContestAnalyticsWindow initialSnapshot={nonproduct}/>);
    const metrics=await screen.findByRole("region",{name:"Contest metrics"});
    expect(within(metrics).getByText("45")).toBeTruthy();
    expect(within(metrics).getByText("Stored QSO points: 30 · Host multiplier / bonus value: 0 · Host plugin total")).toBeTruthy();
    expect(metrics.textContent).not.toContain("×");
  });
  it("labels an incomplete CQWS score as a lower bound and shows the host limitation",async()=>{
    const partial={meta:{...analyticsFixtureMeta,cqWW:false,pluginID:"cqws",hostEvidence:true,multiplierAdapter:true,total:1,
      score:{qsos:1,points:2,multipliers:1,total:2,scoringComplete:false,scoringLimitations:["Brazilian federal-unit evidence is missing."]},
      scoreHistory:{status:"UNVERIFIED" as const,reason:"Incomplete scoring",model:"points-times-credited-identities"}},
      rows:[{...analyticsFixtureRows[0],points:2,claimedScore:null,hostDupe:false,creditedKeys:[]}]};
    render(<ContestAnalyticsWindow initialSnapshot={partial}/>);
    const note=await screen.findByRole("note",{name:"Partial host score"});
    expect(within(note).getByText(/PARTIAL score · lower bound/)).toBeTruthy();
    expect(within(note).getByText("Brazilian federal-unit evidence is missing.")).toBeTruthy();
    expect(screen.getByText("Known score · host · PARTIAL")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Multipliers"}));
    expect(screen.getByText(/Conditional growth is unavailable/)).toBeTruthy();
    expect(screen.queryByLabelText("Candidate stored QSO points")).toBeNull();
  });
  it("opens native Print/PDF once and blocks overlapping exports while pending",async()=>{
    let finish!:()=>void;
    native.invoke.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const browserPrint=vi.spyOn(window,"print").mockImplementation(()=>{});
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Contacts in view 4/}));
    const print=screen.getByRole("button",{name:"Print / PDF"}),report=screen.getByRole("button",{name:"Export report"}),csv=screen.getByRole("button",{name:"CSV"});
    fireEvent.click(print);fireEvent.click(print);fireEvent.click(report);fireEvent.click(csv);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("contest_analytics_print");
    expect(browserPrint).not.toHaveBeenCalled();
    expect((print as HTMLButtonElement).disabled).toBe(true);
    expect((report as HTMLButtonElement).disabled).toBe(true);
    expect((csv as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Opening print dialog…")).toBeTruthy();
    await act(async()=>finish());
    expect(screen.getByText("Print dialog requested.")).toBeTruthy();
    expect((print as HTMLButtonElement).disabled).toBe(false);
  });
  it("reports native print errors and allows retry",async()=>{
    native.invoke.mockRejectedValueOnce("Print service unavailable").mockResolvedValue(undefined);
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Print / PDF"}));
    expect((await screen.findByRole("alert")).textContent).toBe("Print failed: Print service unavailable");
    fireEvent.click(screen.getByRole("button",{name:"Print / PDF"}));
    await screen.findByText("Print dialog requested.");expect(screen.queryByRole("alert")).toBeNull();
  });
  it("uses window.print only in browser previews",async()=>{
    native.isTauri.mockReturnValue(false);
    const print=vi.spyOn(window,"print").mockImplementation(()=>{});
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Print / PDF"}));
    await screen.findByText("Print dialog requested.");
    expect(print).toHaveBeenCalledOnce();expect(native.invoke).not.toHaveBeenCalled();
  });
  it("saves JSON and displayed CSV through the native chooser without browser downloads",async()=>{
    native.invoke.mockResolvedValue({saved:true,cancelled:false});
    const browserDownload=vi.spyOn(HTMLAnchorElement.prototype,"click");
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Export report"}));
    await screen.findByText("Export saved.");
    const [command,args]=native.invoke.mock.calls[0];
    expect(command).toBe("contest_analytics_export");
    expect(args.filename).toBe(`xlog-${snapshot.meta.pluginID}-analytics.json`);
    expect(JSON.parse(args.content)).toEqual({...analyticsReport(prepareAnalytics(snapshot.meta,snapshot.rows),defaultAnalyticsFilters),exportedAt:expect.any(String)});
    fireEvent.change(screen.getByLabelText("Analytics style"),{target:{value:"Unknown"}});
    fireEvent.click(await screen.findByRole("button",{name:/Contacts in view 1/}));
    fireEvent.click(screen.getByRole("button",{name:"CSV"}));
    await waitFor(()=>expect(native.invoke).toHaveBeenCalledTimes(2));
    expect(native.invoke.mock.calls[1][0]).toBe("contest_analytics_export");
    expect(native.invoke.mock.calls[1][1].filename).toBe("xlog-analytics-contacts.csv");
    expect(native.invoke.mock.calls[1][1].content.split("\r\n")).toHaveLength(2);
    expect(native.invoke.mock.calls[1][1].content).toContain('"c"');
    expect(browserDownload).not.toHaveBeenCalled();
  });
  it("prevents duplicate exports while the chooser is open and reports cancellation",async()=>{
    let finish!:(value:{saved:boolean;cancelled:boolean})=>void;
    native.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Contacts in view 4/}));
    const report=screen.getByRole("button",{name:"Export report"}),csv=screen.getByRole("button",{name:"CSV"});
    fireEvent.click(report);fireEvent.click(report);fireEvent.click(csv);
    expect((report as HTMLButtonElement).disabled).toBe(true);
    expect((csv as HTMLButtonElement).disabled).toBe(true);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Choose where to save the export…")).toBeTruthy();
    await act(async()=>finish({saved:false,cancelled:true}));
    expect(screen.getByText("Export cancelled.")).toBeTruthy();
    expect((report as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports native save errors and permits retry without discarding analytics",async()=>{
    native.invoke.mockRejectedValueOnce("Permission denied").mockResolvedValue({saved:true,cancelled:false});
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Export report"}));
    expect((await screen.findByRole("alert")).textContent).toBe("Export failed: Permission denied");
    expect(screen.getByRole("button",{name:/Contacts in view 4/})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Export report"}));
    await screen.findByText("Export saved.");expect(screen.queryByRole("alert")).toBeNull();
  });
  it("retains downloads for browser previews only",async()=>{
    vi.useFakeTimers();
    native.isTauri.mockReturnValue(false);
    const create=vi.fn(()=>"blob:analytics-preview"),revoke=vi.fn();
    vi.stubGlobal("URL",{createObjectURL:create,revokeObjectURL:revoke});
    const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
    expect(await saveAnalyticsFile("preview.csv","header\r\nvalue","text/csv")).toBe("Download requested.");
    expect(create).toHaveBeenCalledOnce();expect(click).toHaveBeenCalledOnce();expect(native.invoke).not.toHaveBeenCalled();
    vi.runAllTimers();expect(revoke).toHaveBeenCalledWith("blob:analytics-preview");
  });
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
  it("keeps UTC controls available when an initial distant timestamp exceeds the timeline limit",async()=>{
    const distant={meta:{...snapshot.meta,total:5},rows:[...snapshot.rows,{...snapshot.rows[0],id:"distant",utc:"2020-10-25 12:00:00"}]};
    render(<ContestAnalyticsWindow initialSnapshot={distant}/>);
    expect((await screen.findByRole("alert")).textContent).toContain("4,096");
    fireEvent.click(screen.getByRole("button",{name:"UTC range"}));
    fireEvent.change(screen.getByLabelText("Analytics UTC start"),{target:{value:"2026-10-24T00:00"}});
    expect(await screen.findByRole("button",{name:/Contacts in view 4/})).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("ignores a rejected old snapshot check after a manual refresh installs a new snapshot",async()=>{
    let tick:(()=>Promise<void>)|undefined,rejectCheck!:(error:Error)=>void;
    const pendingCheck=new Promise((_,reject)=>{rejectCheck=reject;});
    const originalInterval=globalThis.setInterval;
    vi.spyOn(globalThis,"setInterval").mockImplementation(((handler:TimerHandler,delay?:number,...args:unknown[])=>{
      if(delay===15000){tick=handler as ()=>Promise<void>;return originalInterval(handler,1_000_000,...args);}
      return originalInterval(handler,delay,...args);
    }) as typeof setInterval);
    const oldMeta={...snapshot.meta,snapshotID:"old-snapshot"},newMeta={...snapshot.meta,snapshotID:"new-snapshot",total:3};
    let prepares=0,oldChecks=0;
    const read=vi.fn(async(params:Record<string,unknown>)=>{
      const meta=params.snapshotID===newMeta.snapshotID?newMeta:oldMeta;
      if(params.action==="prepare")return ++prepares===1?oldMeta:newMeta;
      if(params.action==="page")return {snapshotID:meta.snapshotID,identity:meta.identity,offset:0,total:meta.total,rows:snapshot.rows.slice(0,meta.total)};
      if(params.action==="check"){
        if(meta===oldMeta&&++oldChecks===2)return pendingCheck;
        return {current:true,identity:meta.identity};
      }
      return {released:true};
    });
    render(<ContestAnalyticsWindow read={read}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    expect(tick).toBeTypeOf("function");
    let checking!:Promise<void>;
    act(()=>{checking=tick!();});
    fireEvent.click(screen.getByRole("button",{name:"Refresh"}));
    await screen.findByRole("button",{name:/Contacts in view 3/});
    await act(async()=>{rejectCheck(new Error("Old snapshot expired"));await checking;});
    expect(screen.getByRole("button",{name:/Contacts in view 3/})).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("contains invalid UTC ranges while a comparison report is loaded and permits reset",async()=>{
    render(<ContestAnalyticsWindow initialSnapshot={snapshot}/>);
    await screen.findByRole("button",{name:/Contacts in view 4/});
    fireEvent.click(screen.getByRole("button",{name:"Compare"}));
    const report=JSON.stringify(analyticsReport(prepareAnalytics({...snapshot.meta,name:"Previous effort fixture"},snapshot.rows),defaultAnalyticsFilters));
    fireEvent.change(screen.getByLabelText("Reference analytics report"),{target:{files:[{size:report.length,text:async()=>report}]}});
    await screen.findByText(/OM0RX · Previous effort fixture/);
    fireEvent.click(screen.getByRole("button",{name:"UTC range"}));
    fireEvent.change(screen.getByLabelText("Analytics UTC start"),{target:{value:"2026-10-26T00:00"}});
    await waitFor(()=>expect((screen.getByRole("button",{name:"Reset"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Analytics UTC end"),{target:{value:"2026-10-25T00:00"}});
    await waitFor(()=>expect(screen.getAllByRole("alert").some(alert=>alert.textContent?.includes("valid UTC interval"))).toBe(true));
    await waitFor(()=>expect((screen.getByRole("button",{name:"Reset"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button",{name:"Reset"}));
    expect(await screen.findByRole("button",{name:/Contacts in view 4/})).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
