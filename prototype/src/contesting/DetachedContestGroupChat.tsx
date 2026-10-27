import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch, maxContestChatBytes,
  readContestGroupChat, sendContestGroupChat, requestContestGroupAuthority, type ContestGroupCoordination, type ContestGroupChatSnapshot } from "./contestGroupChat";
import "./DetachedContestGroupChat.css";

export function DetachedContestGroupChat() {
  const context = useMemo(() => contestGroupChatContextFromSearch(window.location.search), []);
  const [snapshot, setSnapshot] = useState<ContestGroupChatSnapshot | null>(null), [draft, setDraft] = useState("");
  const [error, setError] = useState(""), [sending, setSending] = useState(false);
  const [coordination,setCoordination]=useState<ContestGroupCoordination|null>(null),[target,setTarget]=useState(""),[kind,setKind]=useState("talk"),[lane,setLane]=useState("laneA"),[call,setCall]=useState("");
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
    try { if(target){await requestContestGroupAuthority(context,"coordination",{action:"send",message:{target,kind,body:draft,call:call.toUpperCase(),frequencyHz:0,mode:"",laneID:lane}});await refreshCoordination();}
      else await sendContestGroupChat(context, draft); setDraft(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Chat message could not be sent."); }
    finally { setSending(false); }
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
    <section aria-label="Directed passes and helper proposals"><h2>Directed Talk / Pass / Helper</h2><p>Proposals require acknowledgement. They never edit the runner’s draft, tune, transmit or become public spots.</p>
      {coordination?.directed.map(item=><p key={item.id}><strong>{item.sender} → {item.target} / {item.laneID} · {item.kind}</strong> {item.call} {item.body} · {item.acknowledgedUTC?"Acknowledged":"Awaiting acknowledgement"}
        {!item.acknowledgedUTC&&item.target===coordination.senderStation&&<button type="button" onClick={()=>void requestContestGroupAuthority(context,"coordination",{action:"acknowledge",messageID:item.id}).then(refreshCoordination).catch(cause=>setError(String(cause)))}>Acknowledge {item.call||"message"}</button>}</p>)}
    </section>
    <div className="contest-chat-history" ref={history} role="log" aria-live="polite" aria-label="Chat history">
      {snapshot?.messages.length ? snapshot.messages.map(item => <p key={item.sequence}
        className={contestChatMentionsOperator(item.message, snapshot.operator) ? "mentions-operator" : undefined}>
        <strong>{item.sender}:</strong>{" "}{item.message}</p>) : <p className="contest-chat-empty">No chat messages received.</p>}
    </div>
    <form onSubmit={submit}><label>Target<select aria-label="Message target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Public group chat</option>{coordination?.peers.filter(peer=>peer.station!==coordination.senderStation).map(peer=><option key={peer.station}>{peer.station}</option>)}</select></label>
      {target&&<><label>Kind<select value={kind} onChange={e=>setKind(e.target.value)}><option value="talk">Talk</option><option value="pass">Pass</option><option value="helper">Helper proposal</option></select></label><label>Lane<select value={lane} onChange={e=>setLane(e.target.value)}><option>laneA</option><option>laneB</option></select></label><label>Call<input value={call} onChange={e=>setCall(e.target.value)} maxLength={32}/></label></>}
      <label><span className="sr-only">Message</span><input autoFocus aria-label="Message" value={draft}
      disabled={snapshot?.status !== "connected" || sending} onChange={event => setDraft(event.target.value)}
      maxLength={maxContestChatBytes} /></label><button type="submit" disabled={snapshot?.status !== "connected" || sending}>Send</button></form>
    {error && <p className="contest-chat-error" role="alert">{error}</p>}
  </main>;
}
