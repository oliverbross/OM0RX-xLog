// Memory-only visual fixture. Every native IPC is mocked; no worker, logbook or radio access.
import React from "react";
import {createRoot} from "react-dom/client";
import {mockIPC} from "@tauri-apps/api/mocks";
import {DetachedContestSurface} from "../../src/contesting/DetachedContestSurface";
import {Rates,Matrix} from "../../src/contesting/ContestSecondaryPanels";
import "../../src/style.css";
import "../../src/live/live.css";
const params=new URLSearchParams(location.search),panel=params.get("panel")??"rates";
const identity="11111111-1111-4111-8111-111111111111";
const row={qsoID:"fixture-1",workedAt:"2026-10-25T12:00:00.000Z",callsign:"SX5P",band:"40m",mode:"SSB",sentExchange:"59",receivedExchange:"20",points:2,multiplierLabels:[]};
const columns=["Time","Call","Freq","SNT","RCV","CQ Zone","DXCC","PTS"];
const pluginRows=Array.from({length:12},(_,i)=>({qsoID:`fixture-${i}`,values:[`12:${String(i).padStart(2,"0")}`,i%2?"DL1ABC":"SX5P","7150.000","59","59",i%2?"14":"20",i%2?"DL":"SV5",String(i%3+1)],inlineEdits:columns.map(()=>null)}));
const log:any={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,canExportAdif:true,exchangeLayout:"plugin",pluginColumns:columns,
  pluginRows,pluginPartialRows:pluginRows.slice(0,2),page:{offset:0,limit:12,total:12,rows:pluginRows.map((r,i)=>({...row,qsoID:r.qsoID,callsign:r.values[1],points:i%3+1}))},editing:null,busy:false};
const rates:any={schemaVersion:1,status:"ready",lastHourQsoPerHour:42,last10QsoPerHour:64,last100QsoPerHour:56,sinceHourUTC:12,sinceHourQso:14,
  runQso:120,searchAndPounceQso:78,hourRunQso:10,hourSearchAndPounceQso:4,busy:false,lastQsoAt:new Date(Date.now()-124000).toISOString(),
  hourly:Array.from({length:12},(_,i)=>({hourUTC:`2026-10-25T${String(i+1).padStart(2,"0")}:00:00Z`,qsos:[12,25,35,18,47,52,44,39,32,26,42,14][i]}))};
const matrix:any={schemaVersion:4,status:"ready",title:"DXCC",tracker:"dxcc",zoneSystem:null,current:{dxcc:"Germany",cqZone:14,ituZone:28},
  bands:["160m","80m","40m","20m","15m","10m"],configuredBands:["40m","20m"],currentBand:"40m",total:2,busy:false,
  rows:[{label:"Germany",continent:"EU",counts:{"40m":1,"20m":3},total:4},{label:"Australia",continent:"OC",counts:{"40m":0,"20m":0},total:0,
    availableSpots:{"40m":[{spotID:"vk",callsign:"VK2ABC",frequencyKHz:7125,mode:"SSB",contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true}]}},
    {label:"Japan",continent:"AS",counts:{"40m":0,"20m":1},total:1}]};
if(panel==="logbook"){
  history.replaceState({},"",`${location.pathname}?panel=logbook&view=logbook&scope=contesting&operatingContext=${identity}&sessionID=${identity}&workspaceGeneration=${identity}`);
  mockIPC((command,args:any)=>{
    if(command==="contest_surface_snapshot")return{operatingContext:identity,scope:"contesting",sessionID:identity,workspaceGeneration:identity,panelID:"logbook",projectionRevision:1,projection:log,receipts:[]};
    if(command==="contest_surface_action")return{requestID:args.envelope?.requestID??args.requestID,status:"applied"};
    if(command==="plugin:event|listen")return 1;
    return null;
  });
}
createRoot(document.getElementById("root")!).render(panel==="logbook"?<DetachedContestSurface/>:
  <div className="app live contest-detached-surface"><main>{panel==="matrix"?<Matrix projection={matrix} preferenceScope="visual-only" onSelectSpot={()=>{}}/>:
    <Rates projection={rates} preferenceScope="visual-only"/>}</main></div>);
