import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ContestCallHistoryPanel } from "./ContestCallHistoryPanel";
import type { ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Context = { operatingContext: string; sessionID: string; workspaceGeneration: string };

function contextFromSearch(search: string): Context {
  const query = new URLSearchParams(search);
  const one = (key: string) => query.getAll(key).length === 1 ? query.get(key) : null;
  const context = { operatingContext: one("operatingContext"), sessionID: one("sessionID"),
    workspaceGeneration: one("workspaceGeneration") };
  if (one("scope") !== "contesting" || one("view") !== "call-history" ||
      !uuid.test(context.operatingContext ?? "") || !uuid.test(context.sessionID ?? "") ||
      !uuid.test(context.workspaceGeneration ?? ""))
    throw new Error("This Call History window context could not be verified.");
  return context as Context;
}

export function DetachedContestCallHistorySurface() {
  const context = useMemo(() => contextFromSearch(window.location.search), []);
  const request = useCallback(async (method: string, params: Record<string, unknown> = {}) =>
    invoke("contest_history_manager_request", { ...context, method, params }),
    [context.operatingContext, context.sessionID, context.workspaceGeneration]) as ContestRequest;
  const importDataset = useCallback(() => invoke("contest_history_preview", context),
    [context.operatingContext, context.sessionID, context.workspaceGeneration]);
  const session = useMemo(() => ({
    sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration, revision: 0,
    referenceDataVersion: "not1mm-python", rule: { identity: { id: "not1mm-python", version: "1",
      edition: "not1mm-python", sourceRevision: "managed" } },
  }) as unknown as ContestSessionSummary, [context.sessionID, context.workspaceGeneration]);
  const draft = useMemo(() => ({ draftID: context.sessionID, revision: 0,
    fields: { callsign: "" } }) as unknown as ContestDraftSnapshot, [context.sessionID]);

  return <main className="contest-workspace contest-history-window">
    <header className="contest-header"><div><h1>Call History</h1>
      <p>Not1MM-compatible local history · active contest session · xLog private storage</p></div></header>
    <ContestCallHistoryPanel request={request} ownerLeaseID={0} session={session} draft={draft} managerOnly
      importDataset={importDataset} ready onApply={async () => { throw new Error("Call History management does not edit the active entry fields."); }}/>
  </main>;
}
