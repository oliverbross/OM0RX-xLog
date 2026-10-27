import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import type { StrategyMutation, StrategyScope } from "./ContestReminders";
import type { ContestTransverterMapping } from "./contestStationControl";
import { maidenheadGrid } from "../MapGrid";

type Site={id:string;name:string;locator:string;atUTC:string;note:string;contacts:number;coordinate:[number,number]|null};
type Beacon={id:string;callsign:string;locator:string;frequencyHz:number;source:string;observedUTC:string;ageSeconds:number;status:string;worked:false;coordinate:[number,number]|null;distanceKm:number|null;headingDegrees:number|null};
type Evidence={available:boolean;sites:Site[];currentSiteID:string|null;stationLocator:string;locatorBasis:string;coordinate:[number,number]|null;beacons:Beacon[];
  mappings?:Record<string,{mapping:ContestTransverterMapping;binding:unknown;bindingVersion:number}>};
export type VHFScope=StrategyScope&{frequencyHz:number;band:number;bandLabel?:string;selectedLaneID?:string;bindingVersion?:number};

export function ContestVHFDesk({scope,request,disabled,onMutate,onTune,canMapTune}:{scope:VHFScope;request:ContestRequest;disabled:boolean;onMutate:StrategyMutation;
  onTune(mapping:ContestTransverterMapping,origin:VHFScope):Promise<unknown>;canMapTune:boolean}){
  const [data,setData]=useState<Evidence|null>(null),[error,setError]=useState(""),[working,setWorking]=useState(false);
  const [name,setName]=useState(""),[locator,setLocator]=useState(""),[note,setNote]=useState(""),[at,setAt]=useState(()=>new Date().toISOString());
  const [beacon,setBeacon]=useState({callsign:"",locator:"",frequencyHz:"",source:"",observedUTC:new Date().toISOString()});
  const [lo,setLo]=useState(""),[low,setLow]=useState("140000000"),[high,setHigh]=useState("148000000"),[inverted,setInverted]=useState(false);
  const ticket=useRef(0),identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  useEffect(()=>{setData(null);setError("");setName("");setLocator("");setNote("");setLo("");},[identity]);
  useEffect(()=>{const id=++ticket.current;void request<Evidence>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,section:"vhf"})
    .then(frame=>{if(ticket.current!==id)return;if(!frame.ok)throw Error(frame.error.message);setData(frame.result);})
    .catch(cause=>{if(ticket.current===id)setError(cause instanceof Error?cause.message:String(cause));});return()=>{ticket.current++;};},[identity,scope.revision,request]);
  const run=async(task:()=>Promise<unknown>)=>{if(disabled||working)return;setWorking(true);setError("");try{await task();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setWorking(false);}};
  const locked=disabled||working,center=data?.coordinate;
  const bounds=center?{west:Math.max(-180,center[0]-4),east:Math.min(180,center[0]+4),south:Math.max(-85,center[1]-2),north:Math.min(85,center[1]+2)}:null;
  const grid=bounds?maidenheadGrid(bounds,6,60):null;
  const position=(point:[number,number])=>bounds?[(point[0]-bounds.west)/(bounds.east-bounds.west)*600,(bounds.north-point[1])/(bounds.north-bounds.south)*240]:[0,0];
  const saved=data?.mappings?.[scope.selectedLaneID??"laneA"],mapping:ContestTransverterMapping={band:String(scope.band),loHz:Number(lo),inverted,ifLowHz:Number(low),ifHighHz:Number(high)};
  const savedIF=saved?(saved.mapping.inverted?saved.mapping.loHz-scope.frequencyHz:scope.frequencyHz-saved.mapping.loHz):null;
  return <section className="contest-productivity-section" aria-label="VHF sites and transverters"><h2>VHF sites & transverters</h2>
    {error&&<p role="alert">{error}</p>}
    {!data?.available?<p>Site operation requires a supported grid contest definition. No station settings have changed.</p>:<>
      <p>Current station {data.stationLocator} · {data.locatorBasis}. Historical contacts retain the site actually recorded with them.</p>
      {grid&&bounds&&<svg role="img" aria-label="Station locator grid and unverified beacon overlay" viewBox="0 0 600 240" style={{display:"block",width:"100%",maxWidth:900,background:"var(--panel,#101c2c)"}}>
        {grid.lines.map((line,index)=><polyline key={index} points={line.map(point=>position(point).join(",")).join(" ")} fill="none" stroke="var(--border,#3c536a)" strokeWidth={1}/>)}
        {grid.labels.map(label=>{const [x,y]=position(label.coordinate);return <text key={label.key} x={x} y={y} fill="currentColor" fontSize={11} textAnchor="middle">{label.locator}</text>;})}
        {center&&<circle cx={position(center)[0]} cy={position(center)[1]} r={5} fill="#44d7bf"><title>Explicit station locator {data.stationLocator}</title></circle>}
        {data.beacons.filter(item=>item.coordinate&&item.coordinate[0]>=bounds.west&&item.coordinate[0]<=bounds.east&&item.coordinate[1]>=bounds.south&&item.coordinate[1]<=bounds.north).map(item=><g key={item.id}><circle cx={position(item.coordinate!)[0]} cy={position(item.coordinate!)[1]} r={4} fill="#e4b864"/><title>{item.callsign} · {item.status} · {item.source} · {item.observedUTC}</title></g>)}
      </svg>}
      <p>Grid labels are coordinate suggestions, not a rover's confirmed position. Beacon dots are dated observations, never worked contacts.</p>
      <form onSubmit={event=>{event.preventDefault();void run(()=>onMutate("site_activate",{siteID:crypto.randomUUID(),name,locator,note,atUTC:at}));}}>
        <h3>New timestamped site visit</h3><div className="contest-productivity-actions">
          <label>Site name<input aria-label="Site name" disabled={locked} maxLength={128} value={name} onChange={event=>setName(event.target.value)}/></label>
          <label>Station locator<input aria-label="Station site locator" disabled={locked} maxLength={6} value={locator} onChange={event=>setLocator(event.target.value.toUpperCase())}/></label>
          <label>Site UTC<input aria-label="Station site UTC" disabled={locked} value={at} onChange={event=>setAt(event.target.value)}/></label></div>
        <label>Band/site note<textarea aria-label="Band and site note" disabled={locked} maxLength={4096} value={note} onChange={event=>setNote(event.target.value)}/></label>
        <button disabled={locked||!locator}>Activate explicit site for future contacts</button><p>All lane drafts must be empty. This does not tune equipment, rescore old contacts or allocate a serial.</p>
      </form>
      <ul aria-label="Historical station sites">{data.sites.map(site=><li key={site.id}><strong>{site.name||site.id.slice(0,8)} · {site.locator}</strong> · {site.atUTC} · {site.contacts} contacts<p>{site.note}</p></li>)}</ul>
      <details><summary>Dated beacon evidence</summary><form onSubmit={event=>{event.preventDefault();void run(()=>onMutate("beacon_add",{beacon:{...beacon,id:crypto.randomUUID(),frequencyHz:Number(beacon.frequencyHz)}}));}}>
        {([['callsign','Beacon call'],['locator','Beacon locator (empty = unknown)'],['frequencyHz','Beacon RF (Hz)'],['source','Beacon source'],['observedUTC','Beacon source date UTC']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} disabled={locked} value={beacon[key]} onChange={event=>setBeacon({...beacon,[key]:key==='callsign'||key==='locator'?event.target.value.toUpperCase():event.target.value})}/></label>)}
        <button disabled={locked}>Retain beacon evidence</button></form>
        <ul>{data.beacons.map(item=><li key={item.id}>{item.callsign} · {item.locator||"locator unknown"} · {item.status} · {Math.floor(item.ageSeconds/3600)} h old · {item.source} · {item.observedUTC} · {item.distanceKm===null?"distance unknown":`${item.distanceKm} km / ${item.headingDegrees}° from station site`}</li>)}</ul>
      </details>
      <h3>Declared RF / provider IF mapping</h3><p>Entry RF {scope.frequencyHz} Hz · {scope.bandLabel??`${scope.band} MHz`}. Physical transverter routes remain unqualified. Marked fake routes support a bounded IF command; inversion and split programming are unavailable.</p>
      <form onSubmit={event=>{event.preventDefault();void run(()=>onMutate("transverter_save",{mapping,draftID:scope.draftID,laneID:scope.selectedLaneID,bindingVersion:scope.bindingVersion}));}}>
        <div className="contest-productivity-actions">{([['LO / offset (Hz)',lo,setLo],['Provider IF minimum (Hz)',low,setLow],['Provider IF maximum (Hz)',high,setHigh]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" min={0} step={1} disabled={locked} value={value} onChange={event=>set(event.target.value)}/></label>)}
          <label><input type="checkbox" disabled={locked} checked={inverted} onChange={event=>setInverted(event.target.checked)}/> High-side injection / inverted spectrum</label></div>
        <button disabled={locked||!scope.selectedLaneID||!lo}>Save lane-bound mapping</button>
      </form>
      {saved&&<><p>Saved {saved.mapping.band} mapping · RF {scope.frequencyHz} Hz · provider IF {savedIF} Hz · LO {saved.mapping.loHz} Hz · {saved.mapping.inverted?"inverted (unsupported route)":"noninverted"}. Saved binding version {saved.bindingVersion}.</p>
        <button disabled={locked||!canMapTune||saved.mapping.inverted} onClick={()=>void run(()=>onTune(saved.mapping,scope))}>Tune reviewed IF on explicit fake lane</button></>}
    </>}
  </section>;
}
