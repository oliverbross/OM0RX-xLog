import { useEffect, useState, useSyncExternalStore } from "react";
import { readLayoutJournal, WorkspaceLayoutSession } from "./workspaceLayoutSession";
import { connectWorkspaceLayout, requestWorkspaceLayout } from "./workspaceLayoutTransport";
export type WorkspaceLayoutSurface = "main" | "settings";
// Main retains sole ownership of the legacy key so an upgrade preserves its
// pending intent without loading the same operation into two independent owners.
export const workspaceLayoutJournalKey = (surface: WorkspaceLayoutSurface) => surface === "main"
  ? "xlog.workspace.layout.pending.v1" : "xlog.workspace.layout.pending.settings.v1";
export function useWorkspaceLayout(enabled: boolean, surface: WorkspaceLayoutSurface = "main") {
  const [session] = useState(() => {
    const journalKey = workspaceLayoutJournalKey(surface);
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
