import { useEffect, useState, useSyncExternalStore } from "react";
import { readLayoutJournal, WorkspaceLayoutSession, type WorkspaceLayoutScope } from "./workspaceLayoutSession";
import { connectWorkspaceLayout, requestWorkspaceLayout } from "./workspaceLayoutTransport";
export type WorkspaceLayoutSurface = "main" | "settings" | "contest";
// Main retains sole ownership of the legacy key so an upgrade preserves its
// pending intent without loading the same operation into two independent owners.
export const workspaceLayoutJournalKey = (surface: WorkspaceLayoutSurface) => surface === "main"
  ? "xlog.workspace.layout.pending.v1" : `xlog.workspace.layout.pending.${surface}.v1`;
type LayoutRequest = ConstructorParameters<typeof WorkspaceLayoutSession>[0];
export function useWorkspaceLayout(enabled: boolean, surface: WorkspaceLayoutSurface = "main",
  request: LayoutRequest = requestWorkspaceLayout, scope: WorkspaceLayoutScope = surface === "contest" ? "contesting" : "normal_logging") {
  const [session] = useState(() => {
    const journalKey = workspaceLayoutJournalKey(surface);
    let journal = null;
    try { journal = readLayoutJournal(localStorage.getItem(journalKey)); } catch { /* Reads may be restricted; writes still fail explicitly. */ }
    return new WorkspaceLayoutSession(request, value => value
      ? localStorage.setItem(journalKey, JSON.stringify(value)) : localStorage.removeItem(journalKey), journal, scope);
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
