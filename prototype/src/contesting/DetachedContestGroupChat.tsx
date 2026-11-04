import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch, maxContestChatBytes,
  readContestGroupChat, sendContestGroupChat, requestContestGroupAuthority, type ContestGroupCoordination, type ContestGroupChatSnapshot } from "./contestGroupChat";
import { readContestSurfaceSnapshot, submitContestSurfaceAction } from "./contestSurfaceNative";
import { directedPassComplete } from "./contestDirectedPass";
import type { ContestEntrySurfaceProjection, ContestEntrySurfaceProjectionV2 } from "./contestSurfaceProtocol";
import type { ContestDirectedProposal } from "./contestGroupChat";
import "./DetachedContestGroupChat.css";

export function DetachedContestGroupChat() {
  const context = useMemo(() => contestGroupChatContextFromSearch(window.location.search), []);
  const [snapshot, setSnapshot] = useState<ContestGroupChatSnapshot | null>(null), [draft, setDraft] = useState("");
  const [error, setError] = useState(""), [sending, setSending] = useState(false);
  const [coordination,setCoordination]=useState<ContestGroupCoordination|null>(null),[target,setTarget]=useState(""),[kind,setKind]=useState("talk"),[lane,setLane]=useState("laneA"),[call,setCall]=useState("");
  const [frequency,setFrequency]=useState(""),[mode,setMode]=useState("CW"),[observedUTC,setObservedUTC]=useState(""),[source,setSource]=useState("operator");
  const refreshCoordination=async()=>setCoordination(await requestContestGroupAuthority(context,"coordination",{action:"read"}) as ContestGroupCoordination);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const value = await readContestGroupChat(context); if (active) { setSnapshot(value); setError("");
        if(value.authority.status==="connected"||value.authority.role==="master"){const group=await requestContestGroupAuthority(context,"coordination",{action:"read"});if(active)setCoordination(group as ContestGroupCoordination);} } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Group Chat is unavailable."); }
      finally { if (active) timer = setTimeout(() => void refresh(), 2000); }
    };
    void refresh(); return () => { active = false; clearTimeout(timer); };
  }, [context]);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [snapshot?.messages.at(-1)?.sequence]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!snapshot || snapshot.status !== "connected" || sending) return;
    setSending(true); setError("");
    try { if(target){
      if(kind!=="talk"&&(!/^\d+$/.test(frequency)||!observedUTC||!coordination))throw new Error("Capture or enter a receive frequency, mode and observation UTC before sending a pass.");
      await requestContestGroupAuthority(context,"coordination",{action:"send",message:{target,kind,body:draft,call:call.toUpperCase(),frequencyHz:kind==="talk"?0:Number(frequency),mode:kind==="talk"?"":mode,laneID:lane,
        ...(kind==="talk"?{}:{schema:2,version:1,sessionID:coordination!.authority.sessionID,workspaceGeneration:coordination!.authority.workspaceGeneration,
          frequencyMeaning:"rx",observedUTC,source,supersedesID:null})}});await refreshCoordination();}
      else await sendContestGroupChat(context, draft); setDraft(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Chat message could not be sent."); }
    finally { setSending(false); }
  };
  const captureEntry = async () => {
    try {
      const value=await readContestSurfaceSnapshot(context),entry=value.projection as ContestEntrySurfaceProjection|ContestEntrySurfaceProjectionV2;
      if(entry.status!=="ready"||!entry.draft?.frequencyHz)throw new Error("Current contest Entry has no captured frequency.");
      setCall(entry.draft.callsign);setFrequency(String(entry.draft.frequencyHz));setMode(entry.draft.mode);setObservedUTC(new Date().toISOString());setSource("active-lane");setError("");
    }catch(cause){setError(String(cause instanceof Error?cause.message:cause));}
  };
  const actOnPass = async (item:ContestDirectedProposal,operation:"load"|"tune"|"park") => {
    setError("");setSending(true);
    try {
      const value=await readContestSurfaceSnapshot(context),entry=value.projection as ContestEntrySurfaceProjection|ContestEntrySurfaceProjectionV2;
      if(entry.status!=="ready"||!entry.draft)throw new Error("Contest Entry is unavailable.");
      const laneContext=entry.session.laneContext;
      if((laneContext?.laneID??"laneA")!==item.laneID)throw new Error(`Select the addressed ${item.laneID} in Entry, then review this pass again.`);
      if(operation==="load"&&entry.draft.callsign.trim())throw new Error("Entry is occupied. Use the explicit Park current entry and load action to preserve it.");
      await submitContestSurfaceAction({...context,scope:"contesting",panelID:"active-qso",projectionRevision:value.projectionRevision,requestID:crypto.randomUUID(),action:"entry_group_pass",
        params:{draftID:entry.draft.draftID,expectedDraftRevision:entry.draft.revision,messageID:item.id,messageVersion:1,operation,
          targetLaneID:item.laneID as "laneA"|"laneB",bindingVersion:laneContext?.bindingVersion??null,
          connectionGeneration:laneContext?.binding?.generation??null,reviewedUTC:new Date().toISOString()}});
      setError(`${operation==="load"?"Load":operation==="park"?"Park and load":"Tune"} requested. Review the owner receipt; command acceptance does not prove observed tuning.`);
      await refreshCoordination();
    }catch(cause){setError(String(cause instanceof Error?cause.message:cause));}
    finally{setSending(false);}
  };
  const status = snapshot?.status === "connected" ? `Connected · ${snapshot.multicastGroup}:${snapshot.multicastPort}` :
    snapshot?.status === "disabled" ? "Group networking is disabled in Contest Setup." : snapshot?.error || "Connecting to Group Chat…";
  const authority = snapshot?.authority;
  const authorityStatus = authority?.role === "master" ? `Trusted-LAN authority master · ${authority.status}` :
    authority?.role === "client" ? `${authority.masterStation ? `Trusted-LAN authority ${authority.masterStation}` : "Trusted-LAN authority client"} · ${authority.status}` : "Authority disabled";
  return <main className="contest-group-chat" aria-label="Group Chat">
    <header><div><p>NOT1MM GROUP</p><h1>Group Chat</h1></div><div><span data-state={snapshot?.status ?? "loading"}>{status}</span><span data-state={authority?.status ?? "disabled"}>{authorityStatus}</span></div></header>
    <section aria-label="Station dashboard"><h2>Station dashboard</h2><p>Trusted LAN only. Stale/silent peers do not grant offline serials or output. Operator handover uses Contest Setup → Operator; credentials and arming stay separate.</p>
      <div style={{overflowX:"auto"}}><table><thead><tr><th>Station / operator</th><th>Role / lane</th><th>Band / mode</th><th>Freshness</th><th>Confirmed revision / lag / queue</th></tr></thead><tbody>{coordination?.peers.map(peer=>{
        const age=Date.parse(coordination.observedUTC)-Date.parse(peer.confirmedUTC),lag=Math.max(0,Number(coordination.revision)-peer.cursor);
        return <tr key={peer.station}><td>{peer.station} / {peer.operator||"Unknown"}</td><td>{peer.role} / {peer.laneID}</td><td>{peer.band||"Unknown"} / {peer.mode||"Unknown"}</td><td>{age>15000?"Silent":age>7000?"Stale":"Fresh"} · {Math.max(0,Math.floor(age/1000))}s</td><td>{peer.cursor} / {lag} / {peer.queue}</td></tr>;})}</tbody></table></div>
      {!coordination?.peers.length&&<p>No confirmed station presence. Authority availability does not prove peer freshness.</p>}<p>Category operating counters: unverified by this dashboard; use the existing rule-aware Info/time view.</p>
    </section>
    <section aria-label="Directed passes and helper proposals"><h2>Directed Talk / Pass / Helper</h2><p>Arrival and acknowledgment keep Entry and radios unchanged. Load and Tune are separate deliberate actions. Pass frequency means receive; split transmit frequency is unknown.</p>
      {coordination?.directed.map(item=><article key={item.id}><p><strong>{item.sender} → {item.target} / {item.laneID} · {item.kind}</strong> {item.call} {item.body} · {item.acknowledgedUTC?"Acknowledged":"Awaiting acknowledgement"}</p>
        {item.kind!=="talk"&&<p>{directedPassComplete(item)?`${item.frequencyHz} Hz RX · ${item.mode} · captured ${item.observedUTC}`:"Incomplete, superseded or declined pass; loading/tuning unavailable."}
          {item.observedUTC&&Date.parse(coordination.observedUTC)-Date.parse(item.observedUTC)>60_000&&" · Old frequency suggestion: review age before Tune."}</p>}
        {item.target===coordination.senderStation&&<div>
          {!item.acknowledgedUTC&&<button type="button" disabled={sending} onClick={()=>void requestContestGroupAuthority(context,"coordination",{action:"acknowledge",messageID:item.id}).then(refreshCoordination).catch(cause=>setError(String(cause)))}>Acknowledge {item.call||"message"}</button>}
          {directedPassComplete(item)&&<><button type="button" disabled={sending} onClick={()=>void actOnPass(item,"load")}>Load {item.call} into {item.laneID}</button>
            <button type="button" disabled={sending} onClick={()=>void actOnPass(item,"park")}>Park current entry and load {item.call}</button>
            <button type="button" disabled={sending} onClick={()=>void actOnPass(item,"tune")}>Review and tune {item.call}</button></>}
          <button type="button" disabled={sending||item.recipientActions?.some(action=>action.event==="declined")} onClick={()=>void requestContestGroupAuthority(context,"coordination",{action:"decline",messageID:item.id,messageVersion:item.version??0}).then(refreshCoordination).catch(cause=>setError(String(cause)))}>Decline {item.call||"message"}</button>
        </div>}
        {!!item.recipientActions?.length&&<ul aria-label={`Action receipts ${item.call}`}>{item.recipientActions.map((action,index)=><li key={`${action.operationID}/${index}`}>{action.event.replaceAll("_"," ")} · {action.atUTC} {action.detail}</li>)}</ul>}
      </article>)}
    </section>
    <div className="contest-chat-history" ref={history} role="log" aria-live="polite" aria-label="Chat history">
      {snapshot?.messages.length ? snapshot.messages.map(item => <p key={item.sequence}
        className={contestChatMentionsOperator(item.message, snapshot.operator) ? "mentions-operator" : undefined}>
        <strong>{item.sender}:</strong>{" "}{item.message}</p>) : <p className="contest-chat-empty">No chat messages received.</p>}
    </div>
    <form onSubmit={submit}><label>Target<select aria-label="Message target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Public group chat</option>{coordination?.peers.filter(peer=>peer.station!==coordination.senderStation).map(peer=><option key={peer.station}>{peer.station}</option>)}</select></label>
      {target&&<><label>Kind<select value={kind} onChange={e=>setKind(e.target.value)}><option value="talk">Talk</option><option value="pass">Pass</option><option value="helper">Helper proposal</option></select></label><label>Lane<select value={lane} onChange={e=>setLane(e.target.value)}><option>laneA</option><option>laneB</option></select></label><label>Call<input value={call} onChange={e=>setCall(e.target.value)} maxLength={32}/></label></>}
      {target&&kind!=="talk"&&<fieldset><legend>Captured receive proposal</legend><button type="button" onClick={()=>void captureEntry()}>Capture current Entry call / frequency / mode</button>
        <label>Receive frequency Hz<input aria-label="Pass receive frequency Hz" inputMode="numeric" value={frequency} onChange={e=>{setFrequency(e.target.value);setSource("operator");setObservedUTC(new Date().toISOString());}}/></label>
        <label>Mode<select aria-label="Pass mode" value={mode} onChange={e=>{setMode(e.target.value);setSource("operator");setObservedUTC(new Date().toISOString());}}><option>CW</option><option>SSB</option><option>RTTY</option></select></label>
        <label>Observation UTC<input aria-label="Pass observation UTC" value={observedUTC} onChange={e=>{setObservedUTC(e.target.value);setSource("operator");}}/></label>
        <p>{frequency||"Unknown"} Hz RX · {mode} · {observedUTC||"Unknown observation time"} · {source}. TX/split is unknown.</p></fieldset>}
      <label><span className="sr-only">Message</span><input autoFocus aria-label="Message" value={draft}
      disabled={snapshot?.status !== "connected" || sending} onChange={event => setDraft(event.target.value)}
      maxLength={maxContestChatBytes} /></label><button type="submit" disabled={snapshot?.status !== "connected" || sending}>Send</button></form>
    {error && <p className="contest-chat-error" role="alert">{error}</p>}
  </main>;
}
