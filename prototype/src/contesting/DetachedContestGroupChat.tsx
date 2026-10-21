import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { contestChatMentionsOperator, contestGroupChatContextFromSearch, maxContestChatBytes,
  readContestGroupChat, sendContestGroupChat, type ContestGroupChatSnapshot } from "./contestGroupChat";
import "./DetachedContestGroupChat.css";

export function DetachedContestGroupChat() {
  const context = useMemo(() => contestGroupChatContextFromSearch(window.location.search), []);
  const [snapshot, setSnapshot] = useState<ContestGroupChatSnapshot | null>(null), [draft, setDraft] = useState("");
  const [error, setError] = useState(""), [sending, setSending] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const value = await readContestGroupChat(context); if (active) { setSnapshot(value); setError(""); } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Group Chat is unavailable."); }
      finally { if (active) timer = setTimeout(() => void refresh(), 250); }
    };
    void refresh(); return () => { active = false; clearTimeout(timer); };
  }, [context]);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [snapshot?.messages.at(-1)?.sequence]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!snapshot || snapshot.status !== "connected" || sending) return;
    setSending(true); setError("");
    try { await sendContestGroupChat(context, draft); setDraft(""); }
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
    <div className="contest-chat-history" ref={history} role="log" aria-live="polite" aria-label="Chat history">
      {snapshot?.messages.length ? snapshot.messages.map(item => <p key={item.sequence}
        className={contestChatMentionsOperator(item.message, snapshot.operator) ? "mentions-operator" : undefined}>
        <strong>{item.sender}:</strong>{" "}{item.message}</p>) : <p className="contest-chat-empty">No chat messages received.</p>}
    </div>
    <form onSubmit={submit}><label><span className="sr-only">Message</span><input autoFocus aria-label="Message" value={draft}
      disabled={snapshot?.status !== "connected" || sending} onChange={event => setDraft(event.target.value)}
      maxLength={maxContestChatBytes} /></label><button type="submit" disabled={snapshot?.status !== "connected" || sending}>Send</button></form>
    {error && <p className="contest-chat-error" role="alert">{error}</p>}
  </main>;
}
