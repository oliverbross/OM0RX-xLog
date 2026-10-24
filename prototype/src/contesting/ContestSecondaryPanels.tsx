import { useEffect, useMemo, useRef, useState } from "react";
import type { ContestRatesSurfaceProjection, ContestMatrixSurfaceProjection, ContestMatrixSurfaceProjectionV4 } from "./contestSurfaceProtocol";
import { contestBandMapSpotColor } from "../live/BandMaps";
import { readPanelNumber } from "./contestPanelPreferences";

const twoDigit=(value:number)=>String(value).padStart(2,"0");
const clockText=(date:Date,utc:boolean)=>utc
  ?`${twoDigit(date.getUTCHours())}:${twoDigit(date.getUTCMinutes())}:${twoDigit(date.getUTCSeconds())}`
  :`${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`;
function RatesClock({lastQsoAt}:{lastQsoAt?:string|null}) {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1_000);return()=>window.clearInterval(timer);},[]);
  const utc=clockText(now,true),local=clockText(now,false),last=lastQsoAt?Date.parse(lastQsoAt):NaN,
    elapsed=Number.isFinite(last)?Math.max(0,Math.floor((now.getTime()-last)/1000)):null;
  return <div className="contest-surface-rate-clocks" aria-label="Current time">
    <time className="contest-surface-rate-clock-utc" dateTime={now.toISOString()} aria-label={`UTC time ${utc}`}><strong>{utc}</strong><span>UTC</span></time>
    <time className="contest-surface-rate-clock-local" dateTime={now.toISOString()} aria-label={`Local time ${local}`}><strong>{local}</strong><span>Local</span></time>
    <output className="contest-surface-last-qso" aria-label="Time since last QSO"><strong>{elapsed===null?"—":`${twoDigit(Math.floor(elapsed/3600))}:${twoDigit(Math.floor(elapsed/60)%60)}:${twoDigit(elapsed%60)}`}</strong><span>Since last QSO</span></output>
  </div>;
}
export function Rates({ projection,preferenceScope="default" }: { projection: ContestRatesSurfaceProjection;preferenceScope?:string }) {
  const hourly=projection.hourly?.slice(-24)??[],goalKey=`xlog.contesting.hourly-goal.v1/${preferenceScope}`,
    [goal,setGoal]=useState(()=>readPanelNumber(goalKey,0,0,1000)),maximum=Math.max(1,goal,...hourly.map(hour=>hour.qsos));
  useEffect(()=>{try{localStorage.setItem(goalKey,String(goal));}catch{/* Goals remain usable without storage. */}},[goal,goalKey]);
  const rates = [["Last 60 min logged", projection.lastHourQsoPerHour,"current"], ["10-contact pace", projection.last10QsoPerHour,"ten"],
    ["100-contact pace", projection.last100QsoPerHour,"hundred"]] as const;
  const sinceLabel = `Since ${String(projection.sinceHourUTC).padStart(2, "0")}:00:00z`;
  return <section aria-label="Contest Rates" aria-busy={projection.busy} className="contest-surface-rates"><h1>Rates</h1>
    <p className="contest-surface-rate-scope" title="Last 60 min uses a fixed 60-minute denominator. Contact pace uses N contacts across N−1 intercontact intervals. Invalid timestamps are excluded; missing style is unclassified.">All bands · All modes · Fixed 60-min window</p><RatesClock lastQsoAt={projection.lastQsoAt}/><dl>{rates.map(([label, value,kind]) => <div key={label} className={`contest-surface-rate-${kind}`}><dt>{label}:</dt><dd>{value === null ? <span aria-label="Not enough contacts">—</span> : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>Q/h</small></dd></div>)}
      <div className="contest-surface-rate-since"><dt>{sinceLabel}:</dt><dd>{projection.sinceHourQso.toLocaleString()} <small>QSO</small></dd></div></dl>
    <table aria-label="Run and Search & Pounce QSOs"><tbody>{[["Run QSO",projection.runQso],["S&P QSO",projection.searchAndPounceQso],
      ["Hour Run QSO",projection.hourRunQso],["Hour S&P QSO",projection.hourSearchAndPounceQso]].map(([label,value])=><tr key={label} className={String(label).includes("S&P")?"contest-surface-rate-search":"contest-surface-rate-run"}><th scope="row">{label}:</th><td>{value.toLocaleString()}</td></tr>)}</tbody></table>
    <label className="contest-surface-rate-goal">Hourly goal <input type="number" aria-label="Hourly QSO goal" min={0} max={1000} step={10} value={goal||""} placeholder="Off"
      onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))setGoal(Math.max(0,Math.min(1000,Math.round(value))));}}/>
      {goal>0&&<output aria-label="Current hour goal progress">{projection.sinceHourQso} / {goal}</output>}</label>
    {hourly.length>0&&<figure className="contest-surface-hourly"><figcaption>QSOs by UTC hour · last {hourly.length} hours</figcaption>
      <svg viewBox={`0 0 ${hourly.length*24} 100`} role="img" aria-label="Hourly QSO graph" preserveAspectRatio="none">
        {goal>0&&<line x1={0} x2={hourly.length*24} y1={80-goal/maximum*70} y2={80-goal/maximum*70} className="contest-surface-goal-line"/>}
        {hourly.map((hour,index)=><g key={hour.hourUTC}><rect x={index*24+3} y={80-hour.qsos/maximum*70} width={18} height={hour.qsos/maximum*70}>
          <title>{hour.hourUTC}: {hour.qsos} QSOs</title></rect><text x={index*24+12} y={96} textAnchor="middle">{hour.hourUTC.slice(11,13)}</text></g>)}
      </svg></figure>}
  </section>;
}
type MatrixRow=ContestMatrixSurfaceProjectionV4["rows"][number];
export function Matrix({ projection,preferenceScope,onSelectSpot }: { projection: ContestMatrixSurfaceProjection;preferenceScope:string;onSelectSpot?:(spotID:string)=>void }) {
  const rich = projection.schemaVersion === 4 ? projection : null;
  const preferenceKey=`xlog.contesting.matrix-view.v1/${preferenceScope}/${rich?.tracker??projection.title.toLocaleLowerCase()}`;
  const restored=()=>{try{return JSON.parse(localStorage.getItem(preferenceKey)??"null") as {bandScope?:string;rowFilter?:string;continent?:string}|null;}catch{return null;}},
    initial=restored();
  const [bandScope,setBandScope]=useState<"configured"|"current"|"all">(()=>(["configured","current","all"].includes(initial?.bandScope??"")?initial!.bandScope:"configured") as "configured"|"current"|"all"),
    [rowFilter,setRowFilter]=useState<"needed"|"spotted-needed"|"worked"|"all">(()=>(["needed","spotted-needed","worked","all"].includes(initial?.rowFilter??"")?initial!.rowFilter:(rich?.tracker==="dxcc"||projection.title==="DXCC"?"worked":"all")) as "needed"|"spotted-needed"|"worked"|"all"),
    [continent,setContinent]=useState(()=>["AF","AN","AS","EU","NA","OC","SA"].includes(initial?.continent??"")?initial!.continent!:"all");
  const [viewportWidth,setViewportWidth]=useState(()=>window.innerWidth);
  const rows = useRef(new Map<string, HTMLTableRowElement>()),lastFollowed=useRef("");
  const selectedLabel = rich?.tracker === "dxcc" ? rich.current.dxcc : rich?.tracker === "zone"
    ? String(rich.zoneSystem === "itu" ? rich.current.ituZone ?? "" : rich.current.cqZone ?? "") : null;
  const selectedKey = selectedLabel?.trim().toLocaleUpperCase() ?? "";
  const configured=rich?.configuredBands?.length?rich.configuredBands:projection.bands;
  const visibleBands=bandScope==="all"?projection.bands:bandScope==="current"&&rich?.currentBand?[rich.currentBand]:configured;
  const matrixRows=projection.rows as MatrixRow[],continents=[...new Set(matrixRows.map(row=>row.continent).filter((value):value is string=>!!value))].sort();
  const projectedRows=useMemo(()=>{const dxcc=rich?.tracker==="dxcc"||projection.title==="DXCC",
    source=[...matrixRows];
    if(!dxcc&&selectedKey&&!source.some(row=>row.label.trim().toLocaleUpperCase()===selectedKey))source.push({label:selectedLabel!,counts:Object.fromEntries(projection.bands.map(band=>[band,0])),total:0});
    return source.filter(row=>{if(continent!=="all"&&row.continent!==continent)return false;const worked=visibleBands.some(band=>(row.counts[band]??0)>0);
      const needed=visibleBands.some(band=>(row.counts[band]??0)===0);
      const spottedNeeded=visibleBands.some(band=>(row.counts[band]??0)===0&&row.availableSpots?.[band]?.some(spot=>spot.contestDupe===false));
      return rowFilter==="all"?true:rowFilter==="worked"?worked:rowFilter==="spotted-needed"?spottedNeeded:needed;});
  },[projection.rows,projection.bands,projection.title,rich?.tracker,selectedKey,selectedLabel,visibleBands.join("\u001f"),rowFilter,continent]);
  useEffect(()=>{try{localStorage.setItem(preferenceKey,JSON.stringify({bandScope,rowFilter,continent}));}catch{/* Display preferences remain optional. */}},[preferenceKey,bandScope,rowFilter,continent]);
  useEffect(()=>{const resized=()=>setViewportWidth(window.innerWidth);window.addEventListener("resize",resized);return()=>window.removeEventListener("resize",resized);},[]);
  useEffect(() => { if(selectedKey&&lastFollowed.current!==selectedKey)rows.current.get(selectedKey)?.scrollIntoView?.({ block: "center", inline: "nearest" });
    lastFollowed.current=selectedKey;}, [selectedKey]);
  const workedInView=projection.rows.filter(row=>visibleBands.some(band=>(row.counts[band]??0)>0)).length;
  const blockMinWidth=Math.max(240,128+visibleBands.length*46),requestedBlocks=Math.max(1,Math.floor((viewportWidth-16)/blockMinWidth)),
    blockCount=Math.max(1,Math.min(requestedBlocks,projectedRows.length||1)),
    rowsPerBlock=Math.ceil(projectedRows.length/blockCount),blocks=Array.from({length:blockCount},(_,index)=>projectedRows.slice(index*rowsPerBlock,(index+1)*rowsPerBlock));
  return <section aria-label={`Contest ${projection.title}`} aria-busy={projection.busy} className="contest-surface-matrix"><header className="contest-surface-matrix-toolbar"><h1>{projection.title}</h1>
    {rich&&<><label>Band<select aria-label="Multiplier band scope" value={bandScope} onChange={event=>setBandScope(event.target.value as typeof bandScope)}>
      <option value="configured">Configured</option><option value="current" disabled={!rich.currentBand}>Current</option><option value="all">All</option></select></label>
      <label>Show<select aria-label="Multiplier row filter" value={rowFilter} onChange={event=>setRowFilter(event.target.value as typeof rowFilter)}>
         <option value="worked">Worked</option><option value="needed">Needed</option><option value="spotted-needed">Spotted-needed</option><option value="all">All</option></select></label>
       {continents.length>0&&<label>Continent<select aria-label="Multiplier continent" value={continent} onChange={event=>setContinent(event.target.value)}>
         <option value="all">All</option>{continents.map(value=><option key={value}>{value}</option>)}</select></label>}</>}
    <span className="contest-surface-matrix-summary"><span>{rich&&`${projectedRows.length.toLocaleString()} shown · `}{workedInView.toLocaleString()} worked in view</span>
      {workedInView!==projection.total&&<span>{projection.total.toLocaleString()} unique total</span>}</span></header>
      <div className="contest-surface-matrix-scroll"><div className="contest-surface-matrix-blocks" style={{gridTemplateColumns:`repeat(${blockCount},minmax(${blockMinWidth}px,1fr))`}}>{blocks.map((block,blockIndex)=><table
        key={blockIndex} aria-label={blockIndex===0?`${projection.title} by band`:`${projection.title} by band continuation ${blockIndex+1}`}><thead><tr><th scope="col">{projection.title === "DXCC" ? "DXCC" : "Zone"}</th>
        {visibleBands.map(band => <th key={band} scope="col">{band}</th>)}<th scope="col">Total</th></tr></thead><tbody>
        {block.map(row => { const key = row.label.trim().toLocaleUpperCase(), current = !!selectedKey && key === selectedKey,
          visibleTotal=visibleBands.reduce((sum,band)=>sum+(row.counts[band]??0),0); return <tr key={row.label}
          ref={element => { if (element) rows.current.set(key, element); else rows.current.delete(key); }} aria-current={current ? "true" : undefined}>
          <th scope="row">{row.label}</th>{visibleBands.map(band => <td key={band} className={row.counts[band] > 0 ? "contest-surface-worked" : undefined}>
           {(row.counts[band]??0).toLocaleString()}<span className="contest-matrix-spots">{(row.availableSpots?.[band]??[]).map(spot=><button type="button" key={spot.spotID}
             disabled={projection.busy||!onSelectSpot} style={{color:contestBandMapSpotColor(spot)}} title={`${spot.callsign} · ${(spot.frequencyKHz/1000).toFixed(6)} MHz · ${spot.mode}`}
             aria-label={`Select ${spot.callsign} for ${row.label} on ${band}`} onClick={()=>onSelectSpot?.(spot.spotID)}>{spot.callsign}</button>)}</span></td>)}<td>{visibleTotal.toLocaleString()}</td></tr>; })}
      </tbody></table>)}</div></div>
  </section>;
}
