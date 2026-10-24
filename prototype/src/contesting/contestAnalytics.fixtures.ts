import type { AnalyticsMeta, AnalyticsRow } from "./contestAnalytics";
/** Synthetic contacts used exclusively by tests and the temporary browser rehearsal. */
export const analyticsFixtureMeta:AnalyticsMeta={sessionID:"session",workspaceGeneration:"workspace",snapshotID:"snapshot",identity:"log-id",revision:4,total:4,pluginID:"cq_ww_ssb",name:"CQ WW SSB",stationCall:"OM0RX",settings:{BandCategory:"ALL",ModeCategory:"SSB",PowerCategory:"LOW"},referenceID:"cty-test",sourceRevision:"source-test",capturedAt:"2026-10-25T03:00:00Z",cqWW:true,dupeType:2,score:{qsos:4,points:6,multipliers:5,total:30}};
export const analyticsFixtureRows:AnalyticsRow[]=[
  {id:"a",call:"K1ABC",utc:"2026-10-24 23:00:00",band:"20m",frequencyKHz:14200,mode:"SSB",operator:"OM0RX",style:"Run",country:"K",countryName:"United States",continent:"NA",zone:"5",prefix:"K1",points:3,inCategory:true,multiplierEligible:true},
  {id:"b",call:"OM0A",utc:"2026-10-25 00:00:00",band:"20m",frequencyKHz:14200,mode:"SSB",operator:"OM0RX",style:"S&P",country:"OM",countryName:"Slovakia",continent:"EU",zone:"15",prefix:"OM0",points:0,inCategory:true,multiplierEligible:true},
  {id:"c",call:"K1ABC",utc:"2026-10-25 00:01:00",band:"20m",frequencyKHz:14200,mode:"SSB",operator:"OM0RX",style:"Unknown",country:"K",countryName:"United States",continent:"NA",zone:"5",prefix:"K1",points:0,inCategory:true,multiplierEligible:false},
  {id:"d",call:"K2ABC",utc:"2026-10-25 02:00:00",band:"20m",frequencyKHz:14200,mode:"SSB",operator:"Unknown",style:"Run",country:"K",countryName:"United States",continent:"NA",zone:"4",prefix:"K2",points:3,inCategory:true,multiplierEligible:true},
].map((row,index)=>({...row,sourceOrder:index+1}));
