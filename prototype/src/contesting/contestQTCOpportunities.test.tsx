// @vitest-environment jsdom
import {act,cleanup,renderHook} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {qtcOpportunityFor,qtcOpportunityLabel,useQTCOpportunities,validQTCOpportunities,type QTCOpportunity} from "./contestQTCOpportunities";
const row:QTCOpportunity={eligibility:"eligible",reason:null,direction:"receive",remaining:7,confirmed:2,reserved:3,availableSources:null,
  observation:{status:"later",observedUTC:"2026-11-04T10:00:00Z"},opportunity:true};
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("server-owned QTC map opportunities",()=>{
  it("keeps journal allowance and local observations distinct without deriving scoring",()=>{
    const value={schema:1 as const,revision:42,opportunities:{K1ABC:row}};
    expect(validQTCOpportunities(value)).toBe(true);expect(qtcOpportunityFor(value," k1abc ")).toBe(row);
    expect(qtcOpportunityLabel(row)).toContain("7 remaining · 2 confirmed · 3 reserved");
    expect(qtcOpportunityLabel(row)).toContain("local later at 2026-11-04T10:00:00Z");
    expect(qtcOpportunityLabel(undefined)).toContain("unknown");
    expect(validQTCOpportunities({...value,opportunities:{K1ABC:{...row,opportunity:"yes"}}})).toBe(false);
    expect(validQTCOpportunities({...value,opportunities:{"invalid\ncall":row}})).toBe(false);
  });
  it("batches unique calls through the existing read owner and never sends or creates QTCs",async()=>{
    vi.useFakeTimers();const request=vi.fn().mockImplementation(async(_method,params)=>({ok:true,result:{opportunities:Object.fromEntries(params.counterparts.map((call:string)=>[call,row]))}}));
    const scope={sessionID:"wae",workspaceGeneration:"workspace",revision:42,pluginID:"wae_cw"};
    const spots=Array.from({length:201},(_,index)=>({callsign:`K${index}ABC`}));spots.push(spots[0]);
    const {result}=renderHook(()=>useQTCOpportunities(scope,spots,request));
    await act(()=>vi.advanceTimersByTimeAsync(210));
    expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls.every(([method,params])=>method==="contest_strategy"&&params.section==="qtc"&&params.counterparts.length<=200)).toBe(true);
    expect(Object.keys(result.current!.opportunities)).toHaveLength(201);
  });
  it("retires old session/revision results and leaves non-WAE maps unchanged",async()=>{
    vi.useFakeTimers();let finish!:(value:unknown)=>void;const request=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const first={sessionID:"one",workspaceGeneration:"workspace",revision:1,pluginID:"wae_cw"};
    const {result,rerender}=renderHook(({scope})=>useQTCOpportunities(scope,[{callsign:"K1ABC"}],request as any),{initialProps:{scope:first}});
    await act(()=>vi.advanceTimersByTimeAsync(210));rerender({scope:{...first,sessionID:"two",revision:2}});
    await act(async()=>finish({ok:true,result:{opportunities:{K1ABC:row}}}));expect(result.current?.opportunities).toEqual({});
    rerender({scope:{...first,pluginID:"cq_ww_cw"}});expect(result.current).toBeUndefined();
  });
});
