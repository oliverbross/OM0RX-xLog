import { analyzeAnalytics, prepareAnalytics, type AnalyticsDataset, type AnalyticsFilters } from "./contestAnalytics";
import type { AnalyticsSnapshot } from "./contestAnalyticsService";
let dataset:AnalyticsDataset|null=null;
self.onmessage=(event:MessageEvent<{id:number;snapshot?:AnalyticsSnapshot;filters:AnalyticsFilters;now:number}>)=>{
  const {id,snapshot,filters,now}=event.data;
  if(snapshot)dataset=null;
  try{
    if(snapshot)dataset=prepareAnalytics(snapshot.meta,snapshot.rows);
    if(!dataset)throw new Error("Load a contest snapshot first.");
    self.postMessage({id,result:analyzeAnalytics(dataset,filters,now),...(snapshot?{dataset}:{})});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:"Analysis failed. Refresh to retry.",
    ...(snapshot&&dataset?{dataset}:{})});}
};
