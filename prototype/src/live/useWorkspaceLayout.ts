import { useEffect, useState, useSyncExternalStore } from "react";
import { readLayoutJournal, WorkspaceLayoutSession } from "./workspaceLayoutSession";
import { connectWorkspaceLayout, requestWorkspaceLayout } from "./workspaceLayoutTransport";
const defaultKey = "xlog.workspace.layout.pending.v1";
export function useWorkspaceLayout(enabled: boolean, journalKey = defaultKey) {
  const [session] = useState(() => {
    let journal = null;
    try { journal = readLayoutJournal(localStorage.getItem(journalKey)); } catch { /* Reads may be restricted; writes still fail explicitly. */ }
    return new WorkspaceLayoutSession(requestWorkspaceLayout, value => value
      ? localStorage.setItem(journalKey, JSON.stringify(value)) : localStorage.removeItem(journalKey), journal);
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [subscriptionError, setSubscriptionError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    void session.refresh();
    return connectWorkspaceLayout(() => { setSubscriptionError(""); void session.refresh(); }, setSubscriptionError);
  }, [enabled, session]);
  return { session, state, subscriptionError };
}
