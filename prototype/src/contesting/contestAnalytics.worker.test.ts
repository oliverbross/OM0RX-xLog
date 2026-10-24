import { afterEach,describe,expect,it,vi } from "vitest";
import { defaultAnalyticsFilters } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe("analytics worker recovery",()=>{
  it("returns the copied dataset after a timeline error and analyzes a narrower range without rereading",async()=>{
    const scope={postMessage:vi.fn(),onmessage:null as null|((event:MessageEvent)=>void)};
    vi.stubGlobal("self",scope);
    await import("./contestAnalytics.worker");
    const snapshot={meta:{...analyticsFixtureMeta,total:5},rows:[...analyticsFixtureRows,
      {...analyticsFixtureRows[0],id:"distant",utc:"2020-10-25 12:00:00"}]};
    const now=Date.parse("2026-10-25T03:00:00Z");
    scope.onmessage!({data:{id:1,snapshot,filters:defaultAnalyticsFilters,now}} as MessageEvent);
    const failed=scope.postMessage.mock.calls[0][0];
    expect(failed.error).toContain("4,096");
    expect(failed.dataset.contacts).toHaveLength(5);
    scope.onmessage!({data:{id:2,filters:{...defaultAnalyticsFilters,from:"2026-10-24T00:00"},now}} as MessageEvent);
    const recovered=scope.postMessage.mock.calls[1][0];
    expect(recovered.id).toBe(2);expect(recovered.error).toBeUndefined();expect(recovered.result.summary.qsos).toBe(4);
  });
});
